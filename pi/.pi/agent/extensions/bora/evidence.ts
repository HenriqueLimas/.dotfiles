import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Evidence the parent reviewer can trust without re-deriving it: the working-tree
 * delta produced by one Luna turn and the verified outcome of the validation
 * commands Luna claims it ran. Collecting this once, outside the parent model,
 * avoids the parent spending many large-context turns on `git diff`, `rg`, and
 * repeated test runs.
 */

export const MAX_INLINE_DIFF_CHARS = 8_000;
const MAX_FAILURE_TAIL_CHARS = 600;
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

export interface GitResult {
	stdout: string;
	code: number;
}

export type GitRunner = (args: string[], options: { cwd: string; env?: Record<string, string> }) => Promise<GitResult>;

export const runGit: GitRunner = (args, options) =>
	new Promise((resolve) => {
		execFile(
			"git",
			args,
			{
				cwd: options.cwd,
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", ...options.env },
				timeout: GIT_TIMEOUT_MS,
				maxBuffer: GIT_MAX_BUFFER,
				encoding: "utf8",
			},
			(error, stdout) => {
				const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
				resolve({ stdout: stdout ?? "", code });
			},
		);
	});

export interface WorktreeSnapshot {
	root: string;
	tree: string;
}

async function gitOk(git: GitRunner, args: string[], cwd: string, env?: Record<string, string>): Promise<string> {
	const result = await git(args, { cwd, env });
	if (result.code !== 0) throw new Error(`git ${args.join(" ")} exited with code ${result.code}`);
	return result.stdout.trim();
}

/**
 * Record the full working tree, including untracked non-ignored files, as a git
 * tree object. A temporary index keeps the user's index, stash, and working tree
 * untouched; the only side effect is unreferenced objects that `git gc` prunes.
 */
export async function snapshotWorktree(cwd: string, git: GitRunner = runGit): Promise<WorktreeSnapshot> {
	const root = await gitOk(git, ["rev-parse", "--show-toplevel"], cwd);
	const indexPath = await gitOk(git, ["rev-parse", "--git-path", "index"], root);
	const realIndex = isAbsolute(indexPath) ? indexPath : join(root, indexPath);
	const dir = await mkdtemp(join(tmpdir(), "bora-index-"));
	const tempIndex = join(dir, "index");
	try {
		// Seeding from the real index reuses its stat cache so unchanged files are not rehashed.
		await copyFile(realIndex, tempIndex).catch(() => {});
		const env = { GIT_INDEX_FILE: tempIndex };
		await gitOk(git, ["add", "--all", "--", "."], root, env);
		const tree = await gitOk(git, ["write-tree"], root, env);
		return { root, tree };
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

export interface WorktreeChanges {
	stat: string;
	diff?: string;
	diffChars: number;
}

export async function diffSnapshots(
	before: WorktreeSnapshot,
	after: WorktreeSnapshot,
	git: GitRunner = runGit,
	maxInlineChars = MAX_INLINE_DIFF_CHARS,
): Promise<WorktreeChanges> {
	if (before.tree === after.tree) return { stat: "", diffChars: 0 };
	const diffArgs = ["-c", "core.quotepath=false", "diff", "--no-color", "--no-ext-diff", "--find-renames"];
	const statResult = await git([...diffArgs, "--stat=120", before.tree, after.tree], { cwd: before.root });
	if (statResult.code !== 0) throw new Error(`git diff --stat exited with code ${statResult.code}`);
	// trimEnd keeps the leading alignment space on the first stat line.
	const stat = statResult.stdout.trimEnd();
	const patch = await git([...diffArgs, before.tree, after.tree], { cwd: before.root });
	// A patch larger than the buffer fails; the stat alone is still useful evidence.
	const diff = patch.code === 0 ? patch.stdout.trimEnd() : undefined;
	const diffChars = diff?.length ?? 0;
	return { stat, diff: diff && diffChars <= maxInlineChars ? diff : undefined, diffChars };
}

export interface ValidationCheck {
	command: string;
	status: "passed" | "failed" | "not-run";
	/** A file-editing tool call happened after the matching run, so the result may be stale. */
	stale: boolean;
	failureTail?: string;
}

export interface ValidationEvidence {
	checks: ValidationCheck[];
	/** Failed bash calls that do not match any reported validation command. */
	unreportedFailures: number;
}

/** Section names requested by BORA_SYSTEM_PROMPT; the parser must stay in sync with that format. */
const REPORT_HEADINGS = /^(changed files|validation|deviations(?: from the handoff)?|risks(?: and open questions)?)$/i;

function headingText(line: string): string | undefined {
	const match = /^\s*(?:#{1,6}\s*)?(?:\*\*)?([A-Za-z][A-Za-z ]*?)(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$/.exec(line);
	const name = match?.[1]?.trim();
	return name && REPORT_HEADINGS.test(name) ? name : undefined;
}

/** Commands from the `Validation` section of Luna's report, one inline-code command per bullet. */
export function parseReportedValidation(report: string): string[] {
	const commands: string[] = [];
	let inSection = false;
	for (const line of report.split("\n")) {
		const heading = headingText(line);
		if (heading) {
			inSection = /^validation$/i.test(heading);
			continue;
		}
		if (!inSection || !/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) continue;
		const code = /`([^`]+)`/.exec(line);
		if (code?.[1]?.trim()) commands.push(code[1].trim());
	}
	return [...new Set(commands)];
}

interface BashRun {
	command: string;
	isError: boolean;
	output: string;
	position: number;
}

function normalize(command: string): string {
	return command.replace(/\s+/g, " ").trim();
}

function collectBashRuns(messages: readonly AgentMessage[]): { runs: BashRun[]; lastEditPosition: number } {
	const commands = new Map<string, { command: string; position: number }>();
	const runs: BashRun[] = [];
	let lastEditPosition = -1;
	messages.forEach((message, position) => {
		if (message.role === "assistant") {
			for (const part of message.content) {
				if (part.type !== "toolCall") continue;
				if (part.name === "edit" || part.name === "write") lastEditPosition = position;
				if (part.name === "bash" && typeof part.arguments?.command === "string") {
					commands.set(part.id, { command: part.arguments.command, position });
				}
			}
		} else if (message.role === "toolResult" && message.toolName === "bash") {
			const call = commands.get(message.toolCallId);
			if (!call) return;
			const output = message.content
				.map((part) => (part.type === "text" ? part.text : ""))
				.join("\n");
			runs.push({ command: call.command, isError: message.isError, output, position: call.position });
		}
	});
	return { runs, lastEditPosition };
}

/**
 * Verify each reported command against the transcript. Matching is by
 * containment after whitespace normalization so `cd pkg && npm test` satisfies a
 * reported `npm test`; the latest matching run wins because it is the final state.
 */
export function verifyValidation(report: string, messages: readonly AgentMessage[]): ValidationEvidence {
	const reported = parseReportedValidation(report);
	const { runs, lastEditPosition } = collectBashRuns(messages);
	const matched = new Set<BashRun>();
	const checks = reported.map((command): ValidationCheck => {
		const wanted = normalize(command);
		const matches = runs.filter((run) => normalize(run.command).includes(wanted));
		matches.forEach((run) => matched.add(run));
		const latest = matches.at(-1);
		if (!latest) return { command, status: "not-run", stale: false };
		return {
			command,
			status: latest.isError ? "failed" : "passed",
			stale: lastEditPosition > latest.position,
			...(latest.isError ? { failureTail: latest.output.trimEnd().slice(-MAX_FAILURE_TAIL_CHARS) } : {}),
		};
	});
	const unreportedFailures = runs.filter((run) => run.isError && !matched.has(run)).length;
	return { checks, unreportedFailures };
}

export type TurnEvidence =
	| { kind: "unavailable"; reason: string; validation: ValidationEvidence }
	| { kind: "available"; changes: WorktreeChanges; validation: ValidationEvidence };

export type TurnBaseline = { snapshot: WorktreeSnapshot } | { error: string };

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Never throws: a non-git cwd or git failure degrades to "inspect the repository directly". */
export async function captureTurnBaseline(cwd: string, git: GitRunner = runGit): Promise<TurnBaseline> {
	try {
		return { snapshot: await snapshotWorktree(cwd, git) };
	} catch (error) {
		return { error: reason(error) };
	}
}

export async function collectTurnEvidence(
	baseline: TurnBaseline | undefined,
	turnMessages: readonly AgentMessage[],
	report: string,
	git: GitRunner = runGit,
): Promise<TurnEvidence> {
	const validation = verifyValidation(report, turnMessages);
	if (!baseline) return { kind: "unavailable", reason: "no baseline was captured", validation };
	if ("error" in baseline) return { kind: "unavailable", reason: baseline.error, validation };
	try {
		const after = await snapshotWorktree(baseline.snapshot.root, git);
		return { kind: "available", changes: await diffSnapshots(baseline.snapshot, after, git), validation };
	} catch (error) {
		return { kind: "unavailable", reason: reason(error), validation };
	}
}

function renderValidation(validation: ValidationEvidence): string {
	const lines = ["Validation reported by Luna, verified against the child transcript:"];
	if (validation.checks.length === 0) lines.push("- (none reported)");
	for (const check of validation.checks) {
		const state =
			check.status === "not-run"
				? "NOT FOUND in transcript"
				: `${check.status}${check.stale ? " (files were edited afterwards, may be stale)" : ""}`;
		lines.push(`- \`${check.command}\`: ${state}`);
		if (check.failureTail) lines.push("  Output tail:", ...check.failureTail.split("\n").map((line) => `  ${line}`));
	}
	if (validation.unreportedFailures > 0) {
		lines.push(
			`- ${validation.unreportedFailures} other failed bash call(s) were not reported as validation; use /bora status to inspect them if relevant.`,
		);
	}
	return lines.join("\n");
}

export function renderTurnEvidence(evidence: TurnEvidence | undefined): string {
	if (!evidence) return "Evidence: not collected. Inspect the repository directly.";
	const sections: string[] = [];
	if (evidence.kind === "unavailable") {
		sections.push(`Working-tree changes: unavailable (${evidence.reason}). Inspect the repository directly.`);
	} else if (!evidence.changes.stat) {
		sections.push("Working-tree changes during this turn: none.");
	} else {
		sections.push(`Working-tree changes during this turn (git diff --stat):\n${evidence.changes.stat}`);
		sections.push(
			evidence.changes.diff !== undefined
				? `Diff:\n\`\`\`diff\n${evidence.changes.diff}\n\`\`\``
				: `Diff omitted (${evidence.changes.diffChars || "unknown"} chars, above the ${MAX_INLINE_DIFF_CHARS}-char inline limit). Read only the files you need to judge.`,
		);
	}
	sections.push(renderValidation(evidence.validation));
	return sections.join("\n\n");
}
