import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { type ExtensionAPI, type ExtensionContext, getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { resolveCollaborationForMode, takeCollaborationOverride } from "./collaboration.ts";
import { loadTeamConfig, getTeamConfigPath } from "./config.ts";
import { TeamDashboard } from "./dashboard.ts";
import {
	buildFollowupTask,
	buildInitialTask,
	buildMemberSystemPrompt,
	buildModeratorTask,
	buildReviewSynthesisTask,
	buildRoundtableTask,
	PARENT_SYNTHESIS_OPTIONS,
} from "./prompts.ts";
import { calculateTeamProgress, formatWorkingProgress, type TeamProgress } from "./progress.ts";
import { TeamWorkingWidget } from "./working-widget.ts";
import { preparePullRequestCheckout } from "./pr-checkout.ts";
import { neutralizeControlCharacters } from "./evidence.ts";
import {
	ChildAgentSession,
	classifyTerminalResult,
	createChildAgentSession,
	DEFAULT_CHILD_RESOURCE_POLICY,
	READ_ONLY_TOOLS,
	textFromAssistant,
} from "../_shared/agent-session.ts";
import type {
	AgentStatus,
	PersistedTeamRun,
	TeamActivityEvent,
	TeamActivityKind,
	TeamCollaborationConfig,
	TeamCollaborationMode,
	TeamConfig,
	TeamMemberConfig,
	TeamMode,
	TeamRunSnapshot,
} from "./types.ts";

const STATE_ENTRY = "team-state";
const RESULT_MESSAGE = "team-results";
const HERDR_BACKGROUND_WORK_EVENT = "herdr:background-work";

type Scheduler = <T>(task: () => Promise<T>) => Promise<T>;

interface MemberRuntime {
	config: TeamMemberConfig;
	status: AgentStatus;
	sessionFile?: string;
	session?: ChildAgentSession;
	activity: TeamActivityEvent[];
	messages: AgentMessage[];
	liveMessage?: AgentMessage;
	output: string;
	error?: string;
	queue: Promise<void>;
	revision: number;
	activitySequence: number;
}

interface ResolvedTeamConfig extends Omit<TeamConfig, "collaboration"> {
	collaboration: TeamCollaborationConfig;
}

interface TeamRun {
	id: string;
	mode: Exclude<TeamMode, "followup">;
	subject: string;
	createdAt: string;
	cwd: string;
	gitCwd: string;
	artifactDir: string;
	reviewEvidencePath?: string;
	reviewCheckoutPath?: string;
	reviewPrTarget?: string;
	reviewHeadRefOid?: string;
	config: ResolvedTeamConfig;
	members: MemberRuntime[];
	schedule: Scheduler;
	roundsCompleted: number;
	currentRound: number;
	roundSources: string[];
	aborted: boolean;
}

interface ReviewInput {
	subject: string;
	evidence: string;
	prTarget?: string;
	headRefOid?: string;
}

interface PreparedRun {
	id: string;
	artifactDir: string;
	cwd?: string;
	gitCwd?: string;
	reviewEvidencePath?: string;
	reviewCheckoutPath?: string;
	reviewPrTarget?: string;
	reviewHeadRefOid?: string;
}

interface TeamResultDetails {
	round: TeamMode;
	runId: string;
	subject: string;
	collaboration?: { mode: "roundtable"; roundsCompleted: number };
	members: Array<{ name: string; model: string; status: AgentStatus; error?: string }>;
}

function stripOuterQuotes(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function takeFirstArgument(input: string): { value: string; rest: string } {
	const source = input.trimStart();
	if (!source) return { value: "", rest: "" };
	const quote = source[0] === '"' || source[0] === "'" ? source[0] : undefined;
	let escaped = false;
	let value = "";
	let index = quote ? 1 : 0;
	for (; index < source.length; index++) {
		const char = source[index]!;
		if (escaped) {
			value += char;
			escaped = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if ((quote && char === quote) || (!quote && /\s/.test(char))) {
			index++;
			break;
		}
		value += char;
	}
	return { value, rest: source.slice(index).trimStart() };
}

function lastParentAssistant(ctx: ExtensionContext): string | undefined {
	for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const text = textFromAssistant(entry.message as AgentMessage);
		if (text) return text;
	}
	return undefined;
}

function createScheduler(limit: number): Scheduler {
	let active = 0;
	const waiting: Array<() => void> = [];
	const acquire = () =>
		new Promise<void>((resolve) => {
			if (active < limit) {
				active++;
				resolve();
			} else {
				waiting.push(resolve);
			}
		});
	const release = () => {
		const next = waiting.shift();
		if (next) next();
		else active--;
	};
	return async <T>(task: () => Promise<T>): Promise<T> => {
		await acquire();
		try {
			return await task();
		} finally {
			release();
		}
	};
}

function appendActivity(member: MemberRuntime, kind: TeamActivityKind, text: string): void {
	member.activity.push({ timestamp: Date.now(), kind, text });
	member.revision++;
}

function messagesFromSessionManager(manager: SessionManager): AgentMessage[] {
	return manager.getBranch().flatMap((entry) => entry.type === "message" ? [entry.message] : []);
}

function snapshot(run: TeamRun): TeamRunSnapshot {
	const latestActivityMember = run.members
		.filter((member) => member.status === "running")
		.sort((left, right) => right.activitySequence - left.activitySequence)[0]?.config.name;
	return {
		id: run.id,
		mode: run.mode,
		subject: run.subject,
		createdAt: run.createdAt,
		collaborationMode: run.config.collaboration.mode,
		currentRound: run.currentRound,
		totalRounds: run.config.collaboration.rounds,
		roundsCompleted: run.roundsCompleted,
		maxConcurrency: run.config.maxConcurrency,
		roundSources: run.roundSources,
		latestActivityMember,
		members: run.members.map((member) => ({
			name: member.config.name,
			model: member.config.model,
			status: member.status,
			error: member.error,
			activity: member.activity,
			messages: member.messages,
			liveMessage: member.liveMessage,
			revision: member.revision,
		})),
	};
}

function persisted(run: TeamRun): PersistedTeamRun {
	return {
		version: 1,
		id: run.id,
		mode: run.mode,
		subject: run.subject,
		createdAt: run.createdAt,
		cwd: run.cwd,
		gitCwd: run.gitCwd,
		reviewEvidencePath: run.reviewEvidencePath,
		reviewCheckoutPath: run.reviewCheckoutPath,
		reviewPrTarget: run.reviewPrTarget,
		reviewHeadRefOid: run.reviewHeadRefOid,
		artifactDir: run.artifactDir,
		maxConcurrency: run.config.maxConcurrency,
		maxResultChars: run.config.maxResultChars,
		collaboration: run.config.collaboration,
		roundsCompleted: run.roundsCompleted,
		currentRound: run.currentRound,
		roundSources: run.roundSources,
		members: run.members.map((member) => ({
			config: member.config,
			status: member.status,
			sessionFile: member.sessionFile,
			error: member.error,
			activity: member.activity,
		})),
	};
}

function isPersistedRun(value: unknown): value is PersistedTeamRun {
	if (typeof value !== "object" || value === null) return false;
	const data = value as Partial<PersistedTeamRun>;
	return data.version === 1 && typeof data.id === "string" && (data.mode === "brainstorm" || data.mode === "review") && Array.isArray(data.members);
}

export default function teamExtension(pi: ExtensionAPI) {
	let currentRun: TeamRun | undefined;
	let currentContext: ExtensionContext | undefined;
	let alive = true;
	let uiUpdateTimer: ReturnType<typeof setTimeout> | undefined;
	let workingWidgetInstalled = false;
	let reportedBackgroundRunId: string | undefined;
	let preparationStatus: string | undefined;
	let awaitingSynthesisRunId: string | undefined;
	let activitySequence = 0;
	const dashboardRefresh = new Set<() => void>();

	function markMemberActivity(member: MemberRuntime): void {
		member.activitySequence = ++activitySequence;
		member.revision++;
	}

	function beginBackgroundWorkId(id: string): void {
		if (reportedBackgroundRunId === id) return;
		if (reportedBackgroundRunId) {
			pi.events.emit(HERDR_BACKGROUND_WORK_EVENT, { id: reportedBackgroundRunId, active: false });
		}
		reportedBackgroundRunId = id;
		pi.events.emit(HERDR_BACKGROUND_WORK_EVENT, { id, active: true });
	}

	function beginBackgroundWork(run: TeamRun): void {
		awaitingSynthesisRunId = undefined;
		beginBackgroundWorkId(run.id);
	}

	function beginPreparationBackgroundWork(id: string): boolean {
		if (reportedBackgroundRunId) return false;
		beginBackgroundWorkId(id);
		return true;
	}

	function finishBackgroundWork(runId: string): void {
		if (reportedBackgroundRunId !== runId) return;
		pi.events.emit(HERDR_BACKGROUND_WORK_EVENT, { id: runId, active: false });
		reportedBackgroundRunId = undefined;
		if (awaitingSynthesisRunId === runId) awaitingSynthesisRunId = undefined;
	}

	function getProgress(): TeamProgress {
		return calculateTeamProgress((currentRun?.members ?? []).map((member) => member.status));
	}

	function updateUi(): void {
		const ctx = currentContext;
		if (ctx?.hasUI) {
			if (preparationStatus) {
				ctx.ui.setStatus("team", ctx.ui.theme.fg("warning", `team ${preparationStatus}`));
				if (workingWidgetInstalled) {
					ctx.ui.setWidget("team", undefined);
					workingWidgetInstalled = false;
				}
			} else if (!currentRun) {
				ctx.ui.setStatus("team", undefined);
				if (workingWidgetInstalled) ctx.ui.setWidget("team", undefined);
				workingWidgetInstalled = false;
			} else {
				const progress = getProgress();
				const working = progress.running > 0 || progress.queued > 0;
				const status = working
					? `team ${formatWorkingProgress(progress)}`
					: progress.failed > 0
						? `team ${progress.done}/${progress.total} done · ${progress.failed} failed`
						: `team ${progress.done}/${progress.total} done`;
				ctx.ui.setStatus("team", ctx.ui.theme.fg(working ? "warning" : progress.failed > 0 ? "error" : "success", status));

				if (ctx.mode === "tui" && working && !workingWidgetInstalled) {
					ctx.ui.setWidget(
						"team",
						(tui, theme) => new TeamWorkingWidget(tui, theme, getProgress),
						{ placement: "belowEditor" },
					);
					workingWidgetInstalled = true;
				} else if ((!working || ctx.mode !== "tui") && workingWidgetInstalled) {
					ctx.ui.setWidget("team", undefined);
					workingWidgetInstalled = false;
				}
			}
		}
		for (const refresh of dashboardRefresh) refresh();
	}

	function setPreparationStatus(status: string | undefined): void {
		preparationStatus = status;
		updateUi();
	}

	function scheduleUiUpdate(): void {
		if (uiUpdateTimer) return;
		uiUpdateTimer = setTimeout(() => {
			uiUpdateTimer = undefined;
			updateUi();
		}, 50);
	}

	function persistCurrentRun(expectedRun?: TeamRun): void {
		if (alive && currentRun && (!expectedRun || expectedRun === currentRun)) {
			pi.appendEntry(STATE_ENTRY, persisted(currentRun));
		}
	}

	async function cleanupReviewCheckout(run: TeamRun): Promise<void> {
		const checkoutPath = run.reviewCheckoutPath;
		if (!checkoutPath) return;
		try {
			await rm(checkoutPath, { recursive: true, force: true });
		} catch (error) {
			throw new Error(`Cannot clean up isolated PR checkout ${checkoutPath}: ${error instanceof Error ? error.message : String(error)}`);
		}
		run.reviewCheckoutPath = undefined;
		persistCurrentRun(run);
	}

	async function disposeRun(run: TeamRun): Promise<void> {
		for (const member of run.members) {
			member.session?.dispose();
			member.session = undefined;
		}
		await cleanupReviewCheckout(run);
	}

	async function abortRun(run: TeamRun): Promise<void> {
		run.aborted = true;
		const synthesisPending = awaitingSynthesisRunId === run.id;
		if (synthesisPending) currentContext?.abort();
		await Promise.all(
			run.members.map(async (member) => {
				if (member.status === "completed" || member.status === "failed" || member.status === "aborted") return;
				member.status = "aborted";
				member.error = "Aborted by user";
				member.liveMessage = undefined;
				appendActivity(member, "error", "Aborted by user");
				await member.session?.abort().catch(() => {});
			}),
		);
		updateUi();
		persistCurrentRun(run);
		if (!synthesisPending) {
			finishBackgroundWork(run.id);
			await cleanupReviewCheckout(run);
		}
	}

	async function ensureSession(run: TeamRun, member: MemberRuntime): Promise<ChildAgentSession> {
		if (member.session) return member.session;
		const session = await createChildAgentSession({
			cwd: run.cwd,
			artifactDir: run.artifactDir,
			sessionFile: member.sessionFile,
			sessionName: `team ${run.id}: ${member.config.name}`,
			model: member.config.model,
			thinkingLevel: member.config.thinkingLevel,
			tools: READ_ONLY_TOOLS,
			appendSystemPrompt: buildMemberSystemPrompt(member.config, run.mode),
			resourcePolicy: DEFAULT_CHILD_RESOURCE_POLICY,
		});
		member.session = session;
		member.sessionFile = session.sessionFile;
		member.messages = messagesFromSessionManager(session.sessionManager);
		member.revision++;
		persistCurrentRun(run);
		session.subscribe((event) => {
			if (event.type === "agent_start") {
				member.liveMessage = undefined;
				appendActivity(member, "activity", "Model started");
				markMemberActivity(member);
			} else if (event.type === "message_update") {
				member.liveMessage = event.message;
				markMemberActivity(member);
				scheduleUiUpdate();
				return;
			} else if (event.type === "message_end") {
				member.messages.push(event.message);
				member.liveMessage = undefined;
				markMemberActivity(member);
			} else if (event.type === "tool_execution_start" || event.type === "tool_execution_update" || event.type === "tool_execution_end") {
				markMemberActivity(member);
				scheduleUiUpdate();
				return;
			} else if (event.type === "auto_retry_start") {
				appendActivity(member, "retry", `Retry ${event.attempt}/${event.maxAttempts}: ${event.errorMessage}`);
				markMemberActivity(member);
			}
			updateUi();
		});
		return session;
	}

	async function executeMember(run: TeamRun, member: MemberRuntime, task: string): Promise<void> {
		if (run.aborted || !alive) {
			member.status = "aborted";
			return;
		}
		member.status = "running";
		member.error = undefined;
		member.liveMessage = undefined;
		appendActivity(member, "status", "Starting");
		markMemberActivity(member);
		updateUi();
		try {
			const session = await ensureSession(run, member);
			await session.session.prompt(task, { expandPromptTemplates: false });
			const result = classifyTerminalResult(session.session);
			member.output = result.output.slice(0, run.config.maxResultChars);
			member.liveMessage = undefined;
			member.status = result.status;
			member.error = result.error;
			appendActivity(member, result.status === "completed" ? "status" : "error", result.status);
		} catch (error) {
			member.liveMessage = undefined;
			member.status = run.aborted ? "aborted" : "failed";
			member.error = error instanceof Error ? error.message : String(error);
			appendActivity(member, "error", member.error);
		}
		persistCurrentRun(run);
		updateUi();
	}

	function enqueue(run: TeamRun, member: MemberRuntime, task: string): Promise<void> {
		member.status = "queued";
		member.revision++;
		const next = member.queue
			.catch(() => {})
			.then(() => run.schedule(() => executeMember(run, member, task)));
		member.queue = next;
		updateUi();
		return next;
	}

	function resultDetails(run: TeamRun, round: TeamMode, members: MemberRuntime[]): TeamResultDetails {
		return {
			round,
			runId: run.id,
			subject: run.subject,
			collaboration:
				round !== "followup" && run.config.collaboration.mode === "roundtable"
					? { mode: "roundtable", roundsCompleted: run.roundsCompleted }
					: undefined,
			members: members.map((member) => ({
				name: member.config.name,
				model: member.config.model,
				status: member.status,
				error: member.error,
			})),
		};
	}

	function formatResults(run: TeamRun, round: TeamMode, members: MemberRuntime[]): string {
		if (run.mode === "review") {
			return buildReviewSynthesisTask(
				run.subject,
				run.reviewEvidencePath,
				run.cwd,
				members.map((member) => ({
					name: member.config.name,
					output: member.error ? `Reviewer failed: ${member.error}\n${member.output}` : member.output || "No findings reported.",
				})),
				run.config.collaboration.maxTranscriptChars,
			);
		}

		const sections = members.map((member) => {
			const body = member.error ? `Error: ${member.error}\n\n${member.output}` : member.output || "No response.";
			return `## ${member.config.name} (${member.config.model}, ${member.status})\n\n${body}`;
		});
		const completion =
			round !== "followup" && run.config.collaboration.mode === "roundtable"
				? `finished its ${run.roundsCompleted}-round roundtable`
				: "finished its panel round";
		return `The ${round} team ${completion} for: ${run.subject}\n\n${sections.join("\n\n---\n\n")}\n\n${buildModeratorTask()}`;
	}

	async function runPanelRounds(
		run: TeamRun,
		openingTask: string,
		members: MemberRuntime[] = run.members,
		publish = true,
	): Promise<void> {
		const totalRounds = run.config.collaboration.rounds;
		run.currentRound = 1;
		run.roundSources = [];
		for (const member of members) appendActivity(member, "round", `Round 1/${totalRounds}: independent response`);
		persistCurrentRun(run);
		updateUi();
		await Promise.allSettled(members.map((member) => enqueue(run, member, openingTask)));
		if (!alive || currentRun !== run || run.aborted) return;
		run.roundsCompleted = 1;
		persistCurrentRun(run);

		let participants = members.filter((member) => member.status === "completed");
		for (let round = 2; round <= totalRounds && participants.length >= 2; round++) {
			const previousResponses = participants.map((member) => ({
				name: member.config.name,
				output: member.output,
			}));
			run.currentRound = round;
			run.roundSources = previousResponses.map((response) => response.name);
			for (const member of participants) appendActivity(member, "round", `Round ${round}/${totalRounds}: peer critique`);
			persistCurrentRun(run);
			updateUi();
			await Promise.allSettled(
				participants.map((member) =>
					enqueue(
						run,
						member,
						buildRoundtableTask(
							round,
							totalRounds,
							previousResponses.filter((response) => response.name !== member.config.name),
							run.config.collaboration.maxTranscriptChars,
						),
					),
			),
			);
			if (!alive || currentRun !== run || run.aborted) return;
			run.roundsCompleted = round;
			persistCurrentRun(run);
			participants = participants.filter((member) => member.status === "completed");
		}

		if (publish) await publishResults(run, run.mode, run.members);
	}

	async function publishResults(run: TeamRun, round: TeamMode, members: MemberRuntime[]): Promise<void> {
		if (!alive || currentRun !== run || run.aborted) return;
		persistCurrentRun();
		const details = resultDetails(run, round, members);
		awaitingSynthesisRunId = run.id;
		pi.sendMessage(
			{ customType: RESULT_MESSAGE, content: formatResults(run, round, members), display: true, details },
			PARENT_SYNTHESIS_OPTIONS,
		);
	}

	async function launch(
		mode: Exclude<TeamMode, "followup">,
		subject: string,
		config: TeamConfig,
		ctx: ExtensionContext,
		evidencePath?: string,
		preparedRun?: PreparedRun,
		collaborationOverride?: TeamCollaborationMode,
		memberConfigs?: TeamMemberConfig[],
	): Promise<TeamRun> {
		if (currentRun && (currentRun.members.some((member) => member.status === "queued" || member.status === "running") || awaitingSynthesisRunId === currentRun.id)) {
			const replace = ctx.hasUI && (await ctx.ui.confirm("Replace active team?", "This aborts the current panel run."));
			if (!replace) throw new Error("A team is already working");
			await abortRun(currentRun);
		}
		if (currentRun) await disposeRun(currentRun);

		const id = preparedRun?.id ?? `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
		const parentId = ctx.sessionManager.getSessionId().replace(/[^a-zA-Z0-9_-]/g, "_");
		const artifactDir = preparedRun?.artifactDir ?? join(getAgentDir(), "team-sessions", parentId, id);
		await mkdir(artifactDir, { recursive: true, mode: 0o700 });
		const resolvedConfig: ResolvedTeamConfig = {
			...config,
			collaboration: resolveCollaborationForMode(config.collaboration, mode, collaborationOverride),
		};
		const activeMemberConfigs = memberConfigs ?? config.models;
		if (activeMemberConfigs.length === 0) throw new Error("Team run has no members");
		const run: TeamRun = {
			id,
			mode,
			subject,
			createdAt: new Date().toISOString(),
			cwd: preparedRun?.cwd ?? ctx.cwd,
			gitCwd: preparedRun?.gitCwd ?? ctx.cwd,
			artifactDir,
			reviewEvidencePath: preparedRun?.reviewEvidencePath ?? evidencePath,
			reviewCheckoutPath: preparedRun?.reviewCheckoutPath,
			reviewPrTarget: preparedRun?.reviewPrTarget,
			reviewHeadRefOid: preparedRun?.reviewHeadRefOid,
			config: resolvedConfig,
			members: activeMemberConfigs.map((member) => ({
				config: member,
				status: "queued",
				activity: [],
				messages: [],
				output: "",
				queue: Promise.resolve(),
				revision: 0,
				activitySequence: 0,
			})),
			schedule: createScheduler(Math.min(config.maxConcurrency, activeMemberConfigs.length)),
			roundsCompleted: 0,
			currentRound: 1,
			roundSources: [],
			aborted: false,
		};
		currentRun = run;
		currentContext = ctx;
		beginBackgroundWork(run);
		persistCurrentRun();
		updateUi();

		const task = buildInitialTask(mode, subject, run.reviewEvidencePath);
		void runPanelRounds(run, task).catch(async (error) => {
			if (currentRun !== run || run.aborted) return;
			run.aborted = true;
			finishBackgroundWork(run.id);
			await cleanupReviewCheckout(run).catch(() => {});
			currentContext?.ui.notify(`Team orchestration failed: ${error instanceof Error ? error.message : String(error)}`, "error");
		});
		return run;
	}

	async function captureCommand(command: string, args: string[], cwd: string): Promise<string> {
		const result = await pi.exec(command, args, { cwd, timeout: 60_000 });
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
		if (result.code !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.code}): ${output || "no output"}`);
		return output;
	}

	function parsePullRequestMetadata(metadata: string): { number?: number; headRefOid?: string } {
		try {
			const value = JSON.parse(metadata) as {
				number?: unknown;
				headRefOid?: unknown;
			};
			return {
				number: typeof value.number === "number" ? value.number : undefined,
				headRefOid: typeof value.headRefOid === "string" ? value.headRefOid : undefined,
			};
		} catch {
			return {};
		}
	}

	async function prepareReview(input: string, ctx: ExtensionContext): Promise<ReviewInput> {
		const first = takeFirstArgument(input);
		const kind = first.value.toLowerCase();
		let rest = stripOuterQuotes(first.rest);
		let subject: string;
		let evidence: string;
		let prTarget: string | undefined;
		let headRefOid: string | undefined;

		if (["uncommitted", "uncommited", "uncommitted code", "uncommited code"].includes(kind)) {
			if (rest.toLowerCase().startsWith("code")) rest = rest.slice(4).trimStart();
			const parts = await Promise.all([
				captureCommand("git", ["status", "--short"], ctx.cwd),
				captureCommand("git", ["diff", "--no-ext-diff", "--unified=80"], ctx.cwd),
				captureCommand("git", ["diff", "--cached", "--no-ext-diff", "--unified=80"], ctx.cwd),
			]);
			subject = `uncommitted code${rest ? `, focus: ${rest}` : ""}`;
			evidence = `# Git status\n\n\`\`\`text\n${parts[0]}\n\`\`\`\n\n# Unstaged diff\n\n\`\`\`diff\n${parts[1]}\n\`\`\`\n\n# Staged diff\n\n\`\`\`diff\n${parts[2]}\n\`\`\``;
		} else if (kind === "pr" || kind === "pull-request" || kind === "pullrequest") {
			const targetArg = takeFirstArgument(rest);
			const target = targetArg.value;
			const ghTarget = target ? [target] : [];
			const [metadata, diff] = await Promise.all([
				captureCommand("gh", ["pr", "view", ...ghTarget, "--json", "number,title,body,url,baseRefName,headRefName,headRefOid,files"], ctx.cwd),
				captureCommand("gh", ["pr", "diff", ...ghTarget, "--allow-escape-sequences"], ctx.cwd),
			]);
			const pullRequest = parsePullRequestMetadata(metadata);
			if (!pullRequest.headRefOid) throw new Error("GitHub did not return the PR head commit; refusing to review the current checkout");
			prTarget = target || (pullRequest.number === undefined ? undefined : String(pullRequest.number));
			headRefOid = pullRequest.headRefOid;
			subject = `pull request ${target || "for the current branch"}${targetArg.rest ? `, focus: ${stripOuterQuotes(targetArg.rest)}` : ""}`;
			evidence = `# Pull request metadata\n\n\`\`\`json\n${metadata}\n\`\`\`\n\n# Pull request diff\n\n\`\`\`diff\n${diff}\n\`\`\``;
		} else if (["commit", "committed", "commited", "committed code", "commited code"].includes(kind)) {
			if (rest.toLowerCase() === "code" || rest.toLowerCase().startsWith("code ")) rest = rest.slice(4).trimStart();
			const targetArg = takeFirstArgument(rest);
			const target = targetArg.value || "HEAD";
			const patch = await captureCommand("git", ["show", "--stat", "--patch", "--find-renames", target], ctx.cwd);
			subject = `commit ${target}${targetArg.rest ? `, focus: ${stripOuterQuotes(targetArg.rest)}` : ""}`;
			evidence = `# Commit ${target}\n\n\`\`\`diff\n${patch}\n\`\`\``;
		} else if (kind === "plan") {
			let plan = rest || lastParentAssistant(ctx);
			if (!plan) throw new Error("Provide plan text, a plan path, or run this after an assistant proposed a plan");
			let planSource = "provided plan";
			if (rest) {
				const candidate = resolve(ctx.cwd, rest);
				try {
					plan = await readFile(candidate, "utf8");
					planSource = candidate;
				} catch {}
			}
			subject = `implementation plan from ${planSource}: ${plan.slice(0, 300)}`;
			evidence = `# Plan to review\n\nSource: ${planSource}\n\n${plan}`;
		} else {
			throw new Error("Review target must be uncommitted, pr, commit, or plan");
		}

		// gh refuses piped diffs with escape sequences unless allowed, and git never
		// filters them, so neutralize every review input once here.
		return {
			subject: neutralizeControlCharacters(subject),
			evidence: neutralizeControlCharacters(evidence),
			prTarget,
			headRefOid,
		};
	}

	async function showDashboard(ctx: ExtensionContext): Promise<void> {
		if (!currentRun) {
			ctx.ui.notify("No team run in this session.", "info");
			return;
		}
		if (ctx.mode !== "tui") {
			const done = currentRun.members.filter((member) => member.status === "completed").length;
			ctx.ui.notify(`Team ${currentRun.id}: ${done}/${currentRun.members.length} completed`, "info");
			return;
		}
		await ctx.ui.custom<void>(
			(tui, theme, keybindings, done) => {
				const dashboard = new TeamDashboard(
					theme,
					() => snapshot(currentRun!),
					done,
					keybindings,
					() => Math.max(12, tui.terminal.rows - 2),
				);
				const refresh = () => tui.requestRender();
				dashboardRefresh.add(refresh);
				return {
					render: (width) => dashboard.render(width),
					handleInput: (data) => {
						if (dashboard.handleInput(data)) tui.requestRender();
					},
					invalidate: () => dashboard.invalidate(),
					dispose: () => dashboardRefresh.delete(refresh),
				};
			},
			{
				overlay: true,
				overlayOptions: { width: "100%", minWidth: 40, maxHeight: "100%", anchor: "center", margin: 1 },
			},
		);
	}

	async function restoreRun(ctx: ExtensionContext): Promise<void> {
		if (currentRun) await disposeRun(currentRun);
		const entry = [...ctx.sessionManager.getBranch()]
			.reverse()
			.find((candidate) => candidate.type === "custom" && candidate.customType === STATE_ENTRY);
		if (!entry || entry.type !== "custom" || !isPersistedRun(entry.data)) {
			currentRun = undefined;
			updateUi();
			return;
		}
		const data = entry.data;
		const restoredChildCwd = data.reviewCheckoutPath
			? data.cwd ?? ctx.cwd
			: data.reviewHeadRefOid
				? data.gitCwd ?? ctx.cwd
				: data.cwd ?? ctx.cwd;
		const members: MemberRuntime[] = data.members.map((member) => {
			let output = "";
			let messages: AgentMessage[] = [];
			if (member.sessionFile) {
				try {
					const manager = SessionManager.open(member.sessionFile, data.artifactDir, restoredChildCwd);
					messages = messagesFromSessionManager(manager);
					output = textFromAssistant([...messages].reverse().find((message) => message.role === "assistant"));
				} catch {}
			}
			const status = member.status === "queued" || member.status === "running" ? "aborted" : member.status;
			const activity = [...(member.activity ?? [])];
			if (status === "aborted" && member.status !== "aborted") {
				activity.push({ timestamp: Date.now(), kind: "error", text: "Previous pi runtime ended before this agent completed." });
			}
			return {
				config: member.config,
				status,
				sessionFile: member.sessionFile,
				activity,
				messages,
				output,
				error: status === "aborted" ? "Interrupted by session reload or shutdown" : member.error,
				queue: Promise.resolve(),
				revision: activity.length + messages.length,
				activitySequence: 0,
			};
		});
		currentRun = {
			id: data.id,
			mode: data.mode,
			subject: data.subject,
			createdAt: data.createdAt,
			cwd: restoredChildCwd,
			gitCwd: data.gitCwd ?? ctx.cwd,
			artifactDir: data.artifactDir,
			reviewEvidencePath: data.reviewEvidencePath,
			reviewCheckoutPath: data.reviewCheckoutPath,
			reviewPrTarget: data.reviewPrTarget,
			reviewHeadRefOid: data.reviewHeadRefOid,
			config: {
				models: members.map((member) => member.config),
				maxConcurrency: data.maxConcurrency ?? members.length,
				maxResultChars: data.maxResultChars ?? 30_000,
				collaboration: data.collaboration ?? { mode: "independent", rounds: 1, maxTranscriptChars: 30_000 },
			},
			members,
			schedule: createScheduler(Math.max(1, data.maxConcurrency ?? members.length)),
			roundsCompleted: data.roundsCompleted ?? 1,
			currentRound: data.currentRound ?? data.roundsCompleted ?? 1,
			roundSources: data.roundSources ?? [],
			aborted: false,
		};
		if (currentRun.reviewCheckoutPath) {
			try {
				await cleanupReviewCheckout(currentRun);
				currentRun.cwd = currentRun.gitCwd;
				persistCurrentRun(currentRun);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		} else if (currentRun.reviewHeadRefOid) {
			currentRun.cwd = currentRun.gitCwd;
		}
		updateUi();
	}

	pi.registerMessageRenderer(RESULT_MESSAGE, (message, { expanded, outputPad }, theme) => {
		const details = message.details as TeamResultDetails | undefined;
		if (!details) return new Text("Team results", outputPad, 0);
		const roundtable = details.collaboration ? ` · ${details.collaboration.roundsCompleted} rounds` : "";
		let text = theme.fg("accent", theme.bold(`Team ${details.round}: ${details.members.length} responses${roundtable}`));
		for (const member of details.members) {
			const color = member.status === "completed" ? "success" : "error";
			text += `\n${theme.fg(color, member.status === "completed" ? "ok" : "x")} ${theme.fg("text", member.name)} ${theme.fg("dim", member.model)}`;
			if (member.error) text += ` ${theme.fg("error", member.error)}`;
		}
		if (expanded && typeof message.content === "string") text += `\n\n${message.content}`;
		else if (!expanded) text += `\n${theme.fg("dim", "Expand to inspect each response.")}`;
		return new Text(text, outputPad, 0);
	});

	pi.on("session_start", async (_event, ctx) => {
		alive = true;
		currentContext = ctx;
		await restoreRun(ctx);
	});
	pi.on("agent_settled", async () => {
		const runId = awaitingSynthesisRunId;
		if (!runId) return;
		finishBackgroundWork(runId);
		if (currentRun?.id !== runId) return;
		try {
			await cleanupReviewCheckout(currentRun);
		} catch (error) {
			currentContext?.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	});
	pi.on("session_tree", async (_event, ctx) => {
		const previous = currentRun;
		if (previous?.members.some((member) => member.status === "queued" || member.status === "running")) {
			previous.aborted = true;
			await Promise.all(previous.members.map((member) => member.session?.abort().catch(() => {})));
		}
		if (previous) {
			finishBackgroundWork(previous.id);
			await disposeRun(previous);
		}
		currentContext = ctx;
		await restoreRun(ctx);
	});
	pi.on("session_compact", () => persistCurrentRun());
	pi.on("session_shutdown", async () => {
		if (reportedBackgroundRunId) finishBackgroundWork(reportedBackgroundRunId);
		alive = false;
		if (uiUpdateTimer) clearTimeout(uiUpdateTimer);
		uiUpdateTimer = undefined;
		if (currentRun) {
			currentRun.aborted = true;
			await Promise.all(currentRun.members.map((member) => member.session?.abort().catch(() => {})));
			await disposeRun(currentRun).catch(() => {});
		}
		dashboardRefresh.clear();
	});

	pi.registerCommand("team", {
		description: "Run and inspect a parallel panel. Try /team help",
		getArgumentCompletions: (prefix) => {
			const values = [
				"brainstorm ",
				"brainstorm --independent ",
				"brainstorm --roundtable ",
				"review uncommitted",
				"review --independent uncommitted",
				"review --roundtable uncommitted",
				"review pr ",
				"review commit ",
				"review plan ",
				"followup ",
				"status",
				"abort",
				"config",
			];
			const matches = values.filter((value) => value.startsWith(prefix));
			return matches.length ? matches.map((value) => ({ value, label: value.trim() })) : null;
		},
		handler: async (args, ctx) => {
			alive = true;
			currentContext = ctx;
			const parsed = takeFirstArgument(args);
			const action = parsed.value.toLowerCase();
			try {
				if (!action || action === "status") {
					await showDashboard(ctx);
					return;
				}
				if (action === "help") {
					ctx.ui.notify("/team brainstorm [--roundtable|--independent] <idea> | review [--roundtable|--independent] <uncommitted|pr|commit|plan> [target] | followup [member|all] <question> | status | abort | config", "info");
					return;
				}
				if (action === "config") {
					const config = await loadTeamConfig();
					const roster = config.models.map((member) => `${member.name}=${member.model}`).join(", ");
					const reviewRoster = config.reviewModels
						? `\nReview roster: ${config.reviewModels.map((member) => `${member.name}=${member.model}`).join(", ")}`
						: "";
					const describe = (mode: "brainstorm" | "review") => {
						const collaboration = config.collaboration[mode];
						return collaboration.mode === "roundtable"
							? `${mode}: roundtable (${collaboration.rounds} rounds)`
							: `${mode}: independent`;
					};
					ctx.ui.notify(`Team config: ${getTeamConfigPath()}\n${roster}${reviewRoster}\n${describe("brainstorm")}\n${describe("review")}`, "info");
					return;
				}
				if (action === "abort") {
					if (!currentRun) ctx.ui.notify("No team run to abort.", "info");
					else await abortRun(currentRun);
					return;
				}
				if (action === "brainstorm") {
					const collaboration = takeCollaborationOverride(parsed.rest);
					const idea = stripOuterQuotes(collaboration.rest);
					if (!idea) throw new Error("Usage: /team brainstorm [--roundtable|--independent] <idea>");
					const config = await loadTeamConfig();
					const run = await launch("brainstorm", idea, config, ctx, undefined, undefined, collaboration.mode);
					ctx.ui.notify(`Team ${run.id} started. Use /team status to watch it.`, "info");
					return;
				}
				if (action === "review") {
					const collaboration = takeCollaborationOverride(parsed.rest);
					const config = await loadTeamConfig();
					const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
					const parentId = ctx.sessionManager.getSessionId().replace(/[^a-zA-Z0-9_-]/g, "_");
					const preparationDir = join(getAgentDir(), "team-sessions", parentId, id);
					await mkdir(preparationDir, { recursive: true, mode: 0o700 });
					const preparationWorkId = `team:preparing:${id}`;
					const ownsPreparationWork = beginPreparationBackgroundWork(preparationWorkId);
					setPreparationStatus("pending · preparing review");
					try {
						const review = await prepareReview(collaboration.rest, ctx);
						const evidencePath = join(preparationDir, "review-evidence.md");
						await writeFile(evidencePath, review.evidence, { encoding: "utf8", mode: 0o600 });
						let checkoutPath: string | undefined;
						try {
							if (review.headRefOid) {
								setPreparationStatus("pending · preparing isolated checkout");
								checkoutPath = await preparePullRequestCheckout({
									target: review.prTarget,
									headRefOid: review.headRefOid,
									preparationDir,
									sourceCwd: ctx.cwd,
									captureCommand,
								});
							}
							const run = await launch(
								"review",
								review.subject,
								config,
								ctx,
								evidencePath,
								{
									id,
									artifactDir: preparationDir,
									cwd: checkoutPath,
									gitCwd: ctx.cwd,
									reviewEvidencePath: evidencePath,
									reviewCheckoutPath: checkoutPath,
									reviewPrTarget: review.prTarget,
									reviewHeadRefOid: review.headRefOid,
								},
								collaboration.mode,
								config.reviewModels,
							);
							ctx.ui.notify(`Team ${run.id} started. Review snapshot: ${evidencePath}`, "info");
						} catch (error) {
							if (checkoutPath) {
								try {
									await rm(checkoutPath, { recursive: true, force: true });
								} catch (cleanupError) {
									throw new Error(
										`${error instanceof Error ? error.message : String(error)}. Cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
									);
								}
							}
							throw error;
						}
					} finally {
						setPreparationStatus(undefined);
						if (ownsPreparationWork) finishBackgroundWork(preparationWorkId);
					}
					return;
				}
				if (action === "followup" || action === "follow-up") {
					if (!currentRun) throw new Error("No team run to follow up");
					const progress = getProgress();
					if (progress.running > 0 || progress.queued > 0) {
						throw new Error("Wait for the current team round to finish before sending a follow-up");
					}
					const targetArg = takeFirstArgument(parsed.rest);
					const named = currentRun.members.find((member) => member.config.name.toLowerCase() === targetArg.value.toLowerCase());
					const targetAll = targetArg.value.toLowerCase() === "all";
					const question = stripOuterQuotes(named || targetAll ? targetArg.rest : parsed.rest);
					if (!question) throw new Error("Usage: /team followup [member|all] <question>");
					const run = currentRun;
					if (run.mode === "review" && run.reviewHeadRefOid && !run.reviewCheckoutPath) {
						const preparationWorkId = `team:preparing:${run.id}`;
						const ownsPreparationWork = beginPreparationBackgroundWork(preparationWorkId);
						setPreparationStatus("pending · preparing isolated checkout");
						try {
							const checkoutPath = await preparePullRequestCheckout({
								target: run.reviewPrTarget,
								headRefOid: run.reviewHeadRefOid,
								preparationDir: run.artifactDir,
								sourceCwd: run.gitCwd,
								captureCommand,
							});
							run.reviewCheckoutPath = checkoutPath;
							run.cwd = checkoutPath;
							persistCurrentRun(run);
						} finally {
							setPreparationStatus(undefined);
							if (ownsPreparationWork) finishBackgroundWork(preparationWorkId);
						}
					}
					const targets = named ? [named] : run.members;
					beginBackgroundWork(run);
					const pending = targets.map((member) => enqueue(run, member, buildFollowupTask(question)));
					void Promise.allSettled(pending).then(() => publishResults(run, "followup", targets));
					ctx.ui.notify(`Follow-up queued for ${named ? named.config.name : "all team members"}.`, "info");
					return;
				}
				throw new Error(`Unknown team action: ${action}. Use /team help.`);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
