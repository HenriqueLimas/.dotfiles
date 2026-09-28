import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	captureTurnBaseline,
	collectTurnEvidence,
	parseReportedValidation,
	renderTurnEvidence,
	verifyValidation,
} from "./evidence.ts";

const REPORT = `## Changed files
- \`src/a.ts\`: added a guard

## Validation
- \`npm test\`: passed
- \`npm run lint\`: passed
- \`npm run typecheck\`: passed

## Deviations from the handoff
- None

## Risks and open questions
- Uses \`fs.watch\`, which is not a validation command`;

let callId = 0;
function assistant(...calls: Array<{ name: string; arguments: Record<string, unknown> }>): { message: AgentMessage; ids: string[] } {
	const ids = calls.map(() => `call-${++callId}`);
	const message = {
		role: "assistant",
		content: calls.map((call, index) => ({ type: "toolCall", id: ids[index], name: call.name, arguments: call.arguments })),
		stopReason: "toolUse",
	} as unknown as AgentMessage;
	return { message, ids };
}

function bashResult(id: string, isError: boolean, text: string): AgentMessage {
	return { role: "toolResult", toolCallId: id, toolName: "bash", isError, content: [{ type: "text", text }] } as unknown as AgentMessage;
}

function bash(command: string, isError: boolean, output = ""): AgentMessage[] {
	const { message, ids } = assistant({ name: "bash", arguments: { command } });
	return [message, bashResult(ids[0]!, isError, output)];
}

test("parses only inline-code commands from the Validation section", () => {
	assert.deepEqual(parseReportedValidation(REPORT), ["npm test", "npm run lint", "npm run typecheck"]);
	assert.deepEqual(parseReportedValidation("**Validation:**\n1. `pnpm vitest run` passed\n- prose only\n"), ["pnpm vitest run"]);
	assert.deepEqual(parseReportedValidation("Validation passed after `npm test`"), []);
});

test("verifies reported validation against the transcript", () => {
	const edit = assistant({ name: "edit", arguments: { path: "src/a.ts" } }).message;
	const messages = [
		...bash("npm run lint", false),
		...bash("cd packages/app && npm test", true, "FAIL one\nCommand exited with code 1"),
		...bash("cd packages/app && npm test", false),
		edit,
		// Rerun after the edit, so npm test is fresh and lint is stale.
		...bash("npm  test", false),
		...bash("rg missing", true),
	];

	const evidence = verifyValidation(REPORT, messages);
	assert.deepEqual(evidence.checks, [
		{ command: "npm test", status: "passed", stale: false },
		{ command: "npm run lint", status: "passed", stale: true },
		{ command: "npm run typecheck", status: "not-run", stale: false },
	]);
	assert.equal(evidence.unreportedFailures, 1);
});

test("keeps the tail of the final failing validation run", () => {
	const evidence = verifyValidation("## Validation\n- `npm test`: failed", bash("npm test", true, "x".repeat(900) + "\nCommand exited with code 1"));
	assert.equal(evidence.checks[0]?.status, "failed");
	assert.ok(evidence.checks[0]?.failureTail?.endsWith("Command exited with code 1"));
	assert.ok((evidence.checks[0]?.failureTail?.length ?? 0) <= 600);
});

test("renders unavailable evidence as a direct-inspection fallback", () => {
	const text = renderTurnEvidence({ kind: "unavailable", reason: "not a git repository", validation: { checks: [], unreportedFailures: 0 } });
	assert.match(text, /Working-tree changes: unavailable \(not a git repository\)\. Inspect the repository directly\./);
	assert.match(text, /- \(none reported\)/);
	assert.match(renderTurnEvidence(undefined), /not collected/);
});

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" });
}

test("diffs only this turn's changes, including untracked files, without touching the user's index", async () => {
	const repo = await mkdtemp(join(tmpdir(), "bora-evidence-"));
	try {
		git(repo, "init", "-q");
		git(repo, "config", "user.email", "bora@example.com");
		git(repo, "config", "user.name", "Bora");
		git(repo, "config", "commit.gpgsign", "false");
		await writeFile(join(repo, "tracked.txt"), "one\n");
		git(repo, "add", "tracked.txt");
		git(repo, "commit", "-q", "-m", "init");
		// Pre-existing user work that must not be attributed to Luna.
		await writeFile(join(repo, "user-draft.txt"), "user\n");
		await writeFile(join(repo, "tracked.txt"), "one\nuser staged\n");
		git(repo, "add", "tracked.txt");
		const statusBefore = git(repo, "status", "--porcelain");

		const baseline = await captureTurnBaseline(repo);
		assert.ok("snapshot" in baseline);

		await writeFile(join(repo, "tracked.txt"), "one\nuser staged\nluna\n");
		await writeFile(join(repo, "new-file.ts"), "export const x = 1;\n");

		const evidence = await collectTurnEvidence(baseline, [], "");
		assert.equal(evidence.kind, "available");
		if (evidence.kind !== "available") return;
		assert.match(evidence.changes.stat, /tracked\.txt/);
		assert.match(evidence.changes.stat, /new-file\.ts/);
		assert.doesNotMatch(evidence.changes.stat, /user-draft\.txt/);
		assert.match(evidence.changes.diff ?? "", /\+luna/);
		assert.doesNotMatch(evidence.changes.diff ?? "", /\+user staged/);

		// The user's staged/unstaged split is unchanged apart from Luna's own edits.
		assert.equal(git(repo, "diff", "--cached", "--name-only"), "tracked.txt\n");
		assert.match(statusBefore, /\?\? user-draft\.txt/);
		assert.match(git(repo, "status", "--porcelain"), /\?\? new-file\.ts/);

		const rendered = renderTurnEvidence(evidence);
		assert.match(rendered, /Working-tree changes during this turn \(git diff --stat\):/);
		assert.match(rendered, /```diff\n/);
	} finally {
		await rm(repo, { recursive: true, force: true });
	}
});

test("omits a large diff but keeps the stat", async () => {
	const repo = await mkdtemp(join(tmpdir(), "bora-evidence-"));
	try {
		git(repo, "init", "-q");
		const baseline = await captureTurnBaseline(repo);
		await writeFile(join(repo, "big.txt"), "line\n".repeat(5_000));
		const evidence = await collectTurnEvidence(baseline, [], "");
		assert.equal(evidence.kind, "available");
		if (evidence.kind !== "available") return;
		assert.equal(evidence.changes.diff, undefined);
		assert.ok(evidence.changes.diffChars > 8_000);
		assert.match(renderTurnEvidence(evidence), /Diff omitted \(\d+ chars, above the 8000-char inline limit\)/);
	} finally {
		await rm(repo, { recursive: true, force: true });
	}
});

test("degrades outside a git repository", async () => {
	const dir = await mkdtemp(join(tmpdir(), "bora-evidence-"));
	try {
		const baseline = await captureTurnBaseline(dir);
		assert.ok("error" in baseline);
		const evidence = await collectTurnEvidence(baseline, [], "");
		assert.equal(evidence.kind, "unavailable");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
