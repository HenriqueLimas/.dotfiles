import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	ModelRuntime,
	resolveCliModel,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { resolveCollaborationForMode, takeCollaborationOverride } from "./collaboration.ts";
import { loadTeamConfig, getTeamConfigPath } from "./config.ts";
import { TeamDashboard } from "./dashboard.ts";
import {
	buildFollowupTask,
	buildInitialTask,
	buildMemberSystemPrompt,
	buildModeratorTask,
	buildRoundtableTask,
} from "./prompts.ts";
import { calculateTeamProgress, formatWorkingProgress, type TeamProgress } from "./progress.ts";
import { TeamWorkingWidget } from "./working-widget.ts";
import type {
	AgentStatus,
	PersistedTeamRun,
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
const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];
const MAX_LOG_LINES = 200;

type Scheduler = <T>(task: () => Promise<T>) => Promise<T>;

interface MemberRuntime {
	config: TeamMemberConfig;
	status: AgentStatus;
	sessionFile?: string;
	session?: AgentSession;
	unsubscribe?: () => void;
	logs: string[];
	output: string;
	streamingText: string;
	error?: string;
	queue: Promise<void>;
}

interface ResolvedTeamConfig extends Omit<TeamConfig, "collaboration"> {
	collaboration: TeamCollaborationConfig;
}

interface TeamRun {
	id: string;
	mode: Exclude<TeamMode, "followup">;
	subject: string;
	createdAt: string;
	artifactDir: string;
	config: ResolvedTeamConfig;
	members: MemberRuntime[];
	schedule: Scheduler;
	roundsCompleted: number;
	aborted: boolean;
}

interface ReviewInput {
	subject: string;
	evidence: string;
}

type AssistantAgentMessage = Extract<AgentMessage, { role: "assistant" }>;

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

function textFromAssistant(message: AgentMessage | undefined): string {
	if (!message || message.role !== "assistant") return "";
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function latestAssistant(session: AgentSession): AssistantAgentMessage | undefined {
	return [...session.messages]
		.reverse()
		.find((message): message is AssistantAgentMessage => message.role === "assistant");
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

function appendLog(member: MemberRuntime, line: string): void {
	member.logs.push(`[${new Date().toLocaleTimeString()}] ${line}`);
	if (member.logs.length > MAX_LOG_LINES) member.logs.splice(0, member.logs.length - MAX_LOG_LINES);
}

function safeJson(value: unknown): string {
	try {
		const text = JSON.stringify(value);
		return text.length > 240 ? `${text.slice(0, 240)}...` : text;
	} catch {
		return "(unserializable arguments)";
	}
}

function snapshot(run: TeamRun): TeamRunSnapshot {
	return {
		id: run.id,
		mode: run.mode,
		subject: run.subject,
		createdAt: run.createdAt,
		members: run.members.map((member) => ({
			name: member.config.name,
			model: member.config.model,
			status: member.status,
			output: member.streamingText || member.output,
			error: member.error,
			logs: [...member.logs],
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
		artifactDir: run.artifactDir,
		maxConcurrency: run.config.maxConcurrency,
		autoSynthesize: run.config.autoSynthesize,
		maxResultChars: run.config.maxResultChars,
		collaboration: run.config.collaboration,
		roundsCompleted: run.roundsCompleted,
		members: run.members.map((member) => ({
			config: member.config,
			status: member.status,
			sessionFile: member.sessionFile,
			error: member.error,
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
	let modelRuntimePromise: Promise<ModelRuntime> | undefined;
	let alive = true;
	let uiUpdateTimer: ReturnType<typeof setTimeout> | undefined;
	let workingWidgetInstalled = false;
	let reportedBackgroundRunId: string | undefined;
	let awaitingSynthesisRunId: string | undefined;
	const dashboardRefresh = new Set<() => void>();

	const getModelRuntime = () => {
		modelRuntimePromise ??= ModelRuntime.create({ allowModelNetwork: false });
		return modelRuntimePromise;
	};

	function beginBackgroundWork(run: TeamRun): void {
		awaitingSynthesisRunId = undefined;
		if (reportedBackgroundRunId === run.id) return;
		if (reportedBackgroundRunId) {
			pi.events.emit(HERDR_BACKGROUND_WORK_EVENT, { id: reportedBackgroundRunId, active: false });
		}
		reportedBackgroundRunId = run.id;
		pi.events.emit(HERDR_BACKGROUND_WORK_EVENT, { id: run.id, active: true });
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
			if (!currentRun) {
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

	function disposeRun(run: TeamRun): void {
		for (const member of run.members) {
			member.unsubscribe?.();
			member.session?.dispose();
			member.unsubscribe = undefined;
			member.session = undefined;
		}
	}

	async function abortRun(run: TeamRun): Promise<void> {
		run.aborted = true;
		await Promise.all(
			run.members.map(async (member) => {
				if (member.status === "completed" || member.status === "failed" || member.status === "aborted") return;
				member.status = "aborted";
				member.error = "Aborted by user";
				await member.session?.abort().catch(() => {});
			}),
		);
		updateUi();
		persistCurrentRun(run);
		finishBackgroundWork(run.id);
	}

	async function ensureSession(run: TeamRun, member: MemberRuntime): Promise<AgentSession> {
		if (member.session) return member.session;
		const modelRuntime = await getModelRuntime();
		const resolved = resolveCliModel({
			cliModel: member.config.model,
			cliThinking: member.config.thinkingLevel,
			modelRuntime,
		});
		if (!resolved.model) throw new Error(resolved.error ?? `Unknown model: ${member.config.model}`);
		if (!(await modelRuntime.getAuth(resolved.model))) {
			throw new Error(`No authentication available for ${resolved.model.provider}/${resolved.model.id}`);
		}

		const loader = new DefaultResourceLoader({
			cwd: currentContext?.cwd ?? process.cwd(),
			agentDir: getAgentDir(),
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			appendSystemPromptOverride: (base) => [...base, buildMemberSystemPrompt(member.config, run.mode)],
		});
		await loader.reload();

		const manager = member.sessionFile
			? SessionManager.open(member.sessionFile, run.artifactDir, currentContext?.cwd)
			: SessionManager.create(currentContext?.cwd ?? process.cwd(), run.artifactDir);
		if (!member.sessionFile) manager.appendSessionInfo(`team ${run.id}: ${member.config.name}`);

		const { session } = await createAgentSession({
			cwd: currentContext?.cwd ?? process.cwd(),
			agentDir: getAgentDir(),
			modelRuntime,
			model: resolved.model,
			thinkingLevel: resolved.thinkingLevel ?? member.config.thinkingLevel,
			tools: READ_ONLY_TOOLS,
			resourceLoader: loader,
			sessionManager: manager,
		});
		member.session = session;
		member.sessionFile = session.sessionFile;
		persistCurrentRun(run);
		member.unsubscribe = session.subscribe((event) => {
			if (event.type === "agent_start") {
				member.streamingText = "";
				appendLog(member, "model started");
			} else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				member.streamingText += event.assistantMessageEvent.delta;
				if (member.streamingText.length > run.config.maxResultChars) {
					member.streamingText = member.streamingText.slice(-run.config.maxResultChars);
				}
				scheduleUiUpdate();
				return;
			} else if (event.type === "tool_execution_start") {
				appendLog(member, `${event.toolName} ${safeJson(event.args)}`);
			} else if (event.type === "tool_execution_end") {
				appendLog(member, `${event.toolName} ${event.isError ? "failed" : "completed"}`);
			} else if (event.type === "auto_retry_start") {
				appendLog(member, `retry ${event.attempt}/${event.maxAttempts}: ${event.errorMessage}`);
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
		member.streamingText = "";
		appendLog(member, "starting");
		updateUi();
		try {
			const session = await ensureSession(run, member);
			await session.prompt(task, { expandPromptTemplates: false });
			const last = latestAssistant(session);
			member.output = textFromAssistant(last).slice(0, run.config.maxResultChars);
			member.streamingText = "";
			if (!last) {
				member.status = "failed";
				member.error = "Model returned no assistant message";
			} else if (last.stopReason === "error" || last.stopReason === "aborted") {
				member.status = last.stopReason === "aborted" ? "aborted" : "failed";
				member.error = last.errorMessage ?? `Model stopped with ${last.stopReason}`;
			} else {
				member.status = "completed";
			}
			appendLog(member, member.status);
		} catch (error) {
			member.streamingText = "";
			member.status = run.aborted ? "aborted" : "failed";
			member.error = error instanceof Error ? error.message : String(error);
			appendLog(member, member.error);
		}
		persistCurrentRun(run);
		updateUi();
	}

	function enqueue(run: TeamRun, member: MemberRuntime, task: string): Promise<void> {
		member.status = "queued";
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
		const sections = members.map((member) => {
			const body = member.error ? `Error: ${member.error}\n\n${member.output}` : member.output || "No response.";
			return `## ${member.config.name} (${member.config.model}, ${member.status})\n\n${body}`;
		});
		const synthesisRequest = run.config.autoSynthesize ? `\n\n${buildModeratorTask()}` : "";
		const completion =
			round !== "followup" && run.config.collaboration.mode === "roundtable"
				? `finished its ${run.roundsCompleted}-round roundtable`
				: "finished its panel round";
		return `The ${round} team ${completion} for: ${run.subject}\n\n${sections.join("\n\n---\n\n")}${synthesisRequest}`;
	}

	async function runPanelRounds(run: TeamRun, openingTask: string): Promise<void> {
		const totalRounds = run.config.collaboration.rounds;
		for (const member of run.members) appendLog(member, `round 1/${totalRounds}: independent response`);
		await Promise.allSettled(run.members.map((member) => enqueue(run, member, openingTask)));
		if (!alive || currentRun !== run || run.aborted) return;
		run.roundsCompleted = 1;
		persistCurrentRun(run);

		let participants = run.members.filter((member) => member.status === "completed");
		for (let round = 2; round <= totalRounds && participants.length >= 2; round++) {
			const previousResponses = participants.map((member) => ({
				name: member.config.name,
				output: member.output,
			}));
			for (const member of participants) appendLog(member, `round ${round}/${totalRounds}: peer critique`);
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

		await publishResults(run, run.mode, run.members);
	}

	async function publishResults(run: TeamRun, round: TeamMode, members: MemberRuntime[]): Promise<void> {
		if (!alive || currentRun !== run || run.aborted) return;
		persistCurrentRun();
		const details = resultDetails(run, round, members);
		if (run.config.autoSynthesize) awaitingSynthesisRunId = run.id;
		pi.sendMessage(
			{ customType: RESULT_MESSAGE, content: formatResults(run, round, members), display: true, details },
			{ deliverAs: "followUp", triggerTurn: run.config.autoSynthesize },
		);
		if (!run.config.autoSynthesize) finishBackgroundWork(run.id);
	}

	async function launch(
		mode: Exclude<TeamMode, "followup">,
		subject: string,
		config: TeamConfig,
		ctx: ExtensionContext,
		evidencePath?: string,
		preparedRun?: { id: string; artifactDir: string },
		collaborationOverride?: TeamCollaborationMode,
	): Promise<TeamRun> {
		if (currentRun?.members.some((member) => member.status === "queued" || member.status === "running")) {
			const replace = ctx.hasUI && (await ctx.ui.confirm("Replace active team?", "This aborts the current panel run."));
			if (!replace) throw new Error("A team is already working");
			await abortRun(currentRun);
		}
		if (currentRun) disposeRun(currentRun);

		const id = preparedRun?.id ?? `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
		const parentId = ctx.sessionManager.getSessionId().replace(/[^a-zA-Z0-9_-]/g, "_");
		const artifactDir = preparedRun?.artifactDir ?? join(getAgentDir(), "team-sessions", parentId, id);
		await mkdir(artifactDir, { recursive: true, mode: 0o700 });
		const resolvedConfig: ResolvedTeamConfig = {
			...config,
			collaboration: resolveCollaborationForMode(config.collaboration, mode, collaborationOverride),
		};
		const run: TeamRun = {
			id,
			mode,
			subject,
			createdAt: new Date().toISOString(),
			artifactDir,
			config: resolvedConfig,
			members: config.models.map((member) => ({
				config: member,
				status: "queued",
				logs: [],
				output: "",
				streamingText: "",
				queue: Promise.resolve(),
			})),
			schedule: createScheduler(Math.min(config.maxConcurrency, config.models.length)),
			roundsCompleted: 0,
			aborted: false,
		};
		currentRun = run;
		currentContext = ctx;
		beginBackgroundWork(run);
		persistCurrentRun();
		updateUi();

		const task = buildInitialTask(mode, subject, evidencePath);
		void runPanelRounds(run, task).catch((error) => {
			if (currentRun !== run || run.aborted) return;
			run.aborted = true;
			finishBackgroundWork(run.id);
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

	async function prepareReview(input: string, ctx: ExtensionContext): Promise<ReviewInput> {
		const first = takeFirstArgument(input);
		const kind = first.value.toLowerCase();
		let rest = stripOuterQuotes(first.rest);
		let subject: string;
		let evidence: string;

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
				captureCommand("gh", ["pr", "view", ...ghTarget, "--json", "number,title,body,url,baseRefName,headRefName,files"], ctx.cwd),
				captureCommand("gh", ["pr", "diff", ...ghTarget], ctx.cwd),
			]);
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

		return { subject, evidence };
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
			(tui, theme, _keybindings, done) => {
				const dashboard = new TeamDashboard(theme, () => snapshot(currentRun!), done);
				const refresh = () => tui.requestRender();
				dashboardRefresh.add(refresh);
				return {
					render: (width) => dashboard.render(width),
					handleInput: (data) => {
						dashboard.handleInput(data);
						tui.requestRender();
					},
					invalidate: () => dashboard.invalidate(),
					dispose: () => dashboardRefresh.delete(refresh),
				};
			},
			{
				overlay: true,
				overlayOptions: { width: "90%", minWidth: 50, maxHeight: "85%", anchor: "center" },
			},
		);
	}

	function restoreRun(ctx: ExtensionContext): void {
		disposeRunIfPresent();
		const entry = [...ctx.sessionManager.getBranch()]
			.reverse()
			.find((candidate) => candidate.type === "custom" && candidate.customType === STATE_ENTRY);
		if (!entry || entry.type !== "custom" || !isPersistedRun(entry.data)) {
			currentRun = undefined;
			updateUi();
			return;
		}
		const data = entry.data;
		const members: MemberRuntime[] = data.members.map((member) => {
			let output = "";
			if (member.sessionFile) {
				try {
					const manager = SessionManager.open(member.sessionFile, data.artifactDir, ctx.cwd);
					const message = [...manager.buildSessionContext().messages].reverse().find((item) => item.role === "assistant");
					output = textFromAssistant(message as AgentMessage | undefined);
				} catch {}
			}
			const status = member.status === "queued" || member.status === "running" ? "aborted" : member.status;
			return {
				config: member.config,
				status,
				sessionFile: member.sessionFile,
				logs: status === "aborted" ? ["Previous pi runtime ended before this agent completed."] : [],
				output,
				streamingText: "",
				error: status === "aborted" ? "Interrupted by session reload or shutdown" : member.error,
				queue: Promise.resolve(),
			};
		});
		currentRun = {
			id: data.id,
			mode: data.mode,
			subject: data.subject,
			createdAt: data.createdAt,
			artifactDir: data.artifactDir,
			config: {
				models: members.map((member) => member.config),
				maxConcurrency: data.maxConcurrency ?? members.length,
				autoSynthesize: data.autoSynthesize ?? true,
				maxResultChars: data.maxResultChars ?? 30_000,
				collaboration: data.collaboration ?? { mode: "independent", rounds: 1, maxTranscriptChars: 30_000 },
			},
			members,
			schedule: createScheduler(Math.max(1, data.maxConcurrency ?? members.length)),
			roundsCompleted: data.roundsCompleted ?? 1,
			aborted: false,
		};
		updateUi();
	}

	function disposeRunIfPresent(): void {
		if (currentRun) disposeRun(currentRun);
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

	pi.on("session_start", (_event, ctx) => {
		alive = true;
		currentContext = ctx;
		restoreRun(ctx);
	});
	pi.on("agent_settled", () => {
		if (awaitingSynthesisRunId) finishBackgroundWork(awaitingSynthesisRunId);
	});
	pi.on("session_tree", async (_event, ctx) => {
		const previous = currentRun;
		if (previous?.members.some((member) => member.status === "queued" || member.status === "running")) {
			previous.aborted = true;
			await Promise.all(previous.members.map((member) => member.session?.abort().catch(() => {})));
		}
		if (previous) finishBackgroundWork(previous.id);
		currentContext = ctx;
		restoreRun(ctx);
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
			disposeRun(currentRun);
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
					const describe = (mode: "brainstorm" | "review") => {
						const collaboration = config.collaboration[mode];
						return collaboration.mode === "roundtable"
							? `${mode}: roundtable (${collaboration.rounds} rounds)`
							: `${mode}: independent`;
					};
					ctx.ui.notify(`Team config: ${getTeamConfigPath()}\n${roster}\n${describe("brainstorm")}\n${describe("review")}`, "info");
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
					const review = await prepareReview(collaboration.rest, ctx);
					const evidencePath = join(preparationDir, "review-evidence.md");
					await writeFile(evidencePath, review.evidence, { encoding: "utf8", mode: 0o600 });
					const run = await launch(
						"review",
						review.subject,
						config,
						ctx,
						evidencePath,
						{ id, artifactDir: preparationDir },
						collaboration.mode,
					);
					ctx.ui.notify(`Team ${run.id} started. Review snapshot: ${evidencePath}`, "info");
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
