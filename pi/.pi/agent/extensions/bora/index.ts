import { randomUUID } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	ChildAgentSession,
	classifyTerminalResult,
	createChildAgentSession,
	DEFAULT_CHILD_RESOURCE_POLICY,
	IMPLEMENTATION_TOOLS,
} from "../_shared/agent-session.ts";
import { DEFAULT_BORA_MAX_RESULT_CHARS, getBoraConfigPath, loadBoraConfig } from "./config.ts";
import { BORA_SYSTEM_PROMPT, buildFollowupTask, buildInitialTask } from "./prompts.ts";
import { BoraStatusPopup } from "./status-popup.ts";
import { resolveBoraTask, stripOuterQuotes } from "./command.ts";
import {
	BORA_STATE_ENTRY,
	isBoraWorking,
	latestBoraRun,
	latestParentAssistantMessage,
	markInterruptedBoraRun,
} from "./state.ts";
import type { BoraConfig, BoraResultDetails, BoraStatus, PersistedBoraRun } from "./types.ts";

const RESULT_MESSAGE = "bora-results";
const HERDR_BACKGROUND_WORK_EVENT = "herdr:background-work";
const STATUS_KEY = "bora";
const BORA_CHILD_RESOURCE_POLICY = {
	...DEFAULT_CHILD_RESOURCE_POLICY,
	noSkills: false,
};
const MAX_LOG_LINES = 200;

interface BoraRun {
	id: string;
	task: string;
	createdAt: string;
	cwd: string;
	artifactDir: string;
	sessionFile?: string;
	model: string;
	resolvedModel?: string;
	thinkingLevel?: BoraConfig["thinkingLevel"];
	maxResultChars: number;
	status: BoraStatus;
	error?: string;
	logs: string[];
	output: string;
	streamingText: string;
	phase?: string;
	child?: ChildAgentSession;
	abortRequested: boolean;
	suppressPublication: boolean;
	uiCleared: boolean;
	backgroundWorkId?: string;
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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

function capOutput(output: string, maxChars: number): string {
	return output.length > maxChars ? output.slice(0, maxChars) : output;
}

function appendLog(run: BoraRun, line: string): void {
	run.logs.push(`[${new Date().toLocaleTimeString()}] ${line}`);
	if (run.logs.length > MAX_LOG_LINES) run.logs.splice(0, run.logs.length - MAX_LOG_LINES);
}

function safeJson(value: unknown): string {
	try {
		const text = JSON.stringify(value);
		if (typeof text !== "string") return "(no arguments)";
		return text.length > 160 ? `${text.slice(0, 160)}...` : text;
	} catch {
		return "(unserializable arguments)";
	}
}

function persisted(run: BoraRun): PersistedBoraRun {
	return {
		version: 1,
		id: run.id,
		task: run.task,
		createdAt: run.createdAt,
		cwd: run.cwd,
		artifactDir: run.artifactDir,
		sessionFile: run.sessionFile,
		model: run.model,
		thinkingLevel: run.thinkingLevel,
		status: run.status,
		error: run.error,
		latestOutput: run.output,
		maxResultChars: run.maxResultChars,
	};
}

function runFromPersisted(data: PersistedBoraRun, interrupted = false): BoraRun {
	return {
		id: data.id,
		task: data.task,
		createdAt: data.createdAt,
		cwd: data.cwd,
		artifactDir: data.artifactDir,
		sessionFile: data.sessionFile,
		model: data.model,
		thinkingLevel: data.thinkingLevel,
		maxResultChars: data.maxResultChars ?? DEFAULT_BORA_MAX_RESULT_CHARS,
		status: data.status,
		error: data.error,
		logs: interrupted ? ["restored after interruption"] : [],
		output: data.latestOutput ?? "",
		streamingText: "",
		abortRequested: false,
		suppressPublication: false,
		uiCleared: false,
	};
}

export default function boraExtension(pi: ExtensionAPI) {
	let currentRun: BoraRun | undefined;
	let currentContext: ExtensionContext | undefined;
	let alive = true;
	let uiUpdateTimer: ReturnType<typeof setTimeout> | undefined;
	let reportedBackgroundWorkId: string | undefined;
	const overlayRefreshes = new Set<() => void>();

	function clearUi(ctx = currentContext): void {
		if (!ctx?.hasUI) return;
		ctx.ui.setStatus(STATUS_KEY, undefined);
		ctx.ui.setWidget(STATUS_KEY, undefined);
	}

	function updateUi(): void {
		const ctx = currentContext;
		if (ctx?.hasUI) {
			if (!currentRun || currentRun.uiCleared) {
				clearUi(ctx);
			} else if (currentRun.status === "running") {
				const model = currentRun.resolvedModel ?? currentRun.model;
				const phase = currentRun.phase ? ` · ${currentRun.phase}` : "";
				ctx.ui.setStatus(
					STATUS_KEY,
					ctx.ui.theme.fg("warning", `bora working · ${model}${phase} · ${currentRun.id}`),
				);
			} else {
				const color = currentRun.status === "completed" ? "success" : "error";
				ctx.ui.setStatus(
					STATUS_KEY,
					ctx.ui.theme.fg(color, `bora ${currentRun.status} · ${currentRun.id}`),
				);
			}
		}
		for (const refresh of overlayRefreshes) refresh();
	}

	function scheduleUiUpdate(): void {
		if (uiUpdateTimer) return;
		uiUpdateTimer = setTimeout(() => {
			uiUpdateTimer = undefined;
			if (alive) updateUi();
		}, 50);
	}

	function persistCurrentRun(run = currentRun): void {
		if (alive && run && currentRun === run) pi.appendEntry(BORA_STATE_ENTRY, persisted(run));
	}

	function beginBackgroundWork(run: BoraRun): void {
		run.backgroundWorkId ??= `bora:${run.id}`;
		if (reportedBackgroundWorkId === run.backgroundWorkId) return;
		if (reportedBackgroundWorkId) {
			pi.events.emit(HERDR_BACKGROUND_WORK_EVENT, { id: reportedBackgroundWorkId, active: false });
		}
		reportedBackgroundWorkId = run.backgroundWorkId;
		pi.events.emit(HERDR_BACKGROUND_WORK_EVENT, { id: run.backgroundWorkId, active: true });
	}

	function closeReportedBackgroundWork(): void {
		if (!reportedBackgroundWorkId) return;
		pi.events.emit(HERDR_BACKGROUND_WORK_EVENT, { id: reportedBackgroundWorkId, active: false });
		reportedBackgroundWorkId = undefined;
	}

	function finishBackgroundWork(run: BoraRun): void {
		if (!run.backgroundWorkId || reportedBackgroundWorkId !== run.backgroundWorkId) return;
		closeReportedBackgroundWork();
		run.backgroundWorkId = undefined;
	}

	function disposeRun(run: BoraRun): void {
		run.child?.dispose();
		run.child = undefined;
	}

	function attachChild(run: BoraRun, child: ChildAgentSession): void {
		run.child = child;
		run.sessionFile = child.sessionFile;
		run.resolvedModel = child.resolvedModel;
		run.thinkingLevel = child.thinkingLevel;
		persistCurrentRun(run);

		child.subscribe((event) => {
			if (!alive || currentRun !== run) return;
			if (event.type === "agent_start") {
				run.streamingText = "";
				run.phase = "thinking";
				appendLog(run, "agent started");
			} else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				run.streamingText += event.assistantMessageEvent.delta;
				if (run.streamingText.length > run.maxResultChars) {
					run.streamingText = run.streamingText.slice(-run.maxResultChars);
				}
				run.phase = "responding";
				scheduleUiUpdate();
				return;
			} else if (event.type === "tool_execution_start") {
				run.phase = event.toolName;
				appendLog(run, `tool ${event.toolName} started ${safeJson(event.args)}`);
			} else if (event.type === "tool_execution_end") {
				run.phase = `${event.toolName} ${event.isError ? "failed" : "completed"}`;
				appendLog(run, `tool ${event.toolName} ${event.isError ? "failed" : "completed"}`);
			} else if (event.type === "auto_retry_start") {
				run.phase = `retry ${event.attempt}/${event.maxAttempts}`;
				appendLog(run, `retry ${event.attempt}/${event.maxAttempts}: ${event.errorMessage}`);
			}
			updateUi();
		});
	}

	async function createChildForRun(run: BoraRun, projectTrusted: boolean): Promise<ChildAgentSession> {
		return createChildAgentSession({
			cwd: run.cwd,
			artifactDir: run.artifactDir,
			sessionFile: run.sessionFile,
			sessionName: `bora ${run.id}`,
			requireExistingSessionFile: Boolean(run.sessionFile),
			model: run.model,
			thinkingLevel: run.thinkingLevel,
			tools: IMPLEMENTATION_TOOLS,
			appendSystemPrompt: BORA_SYSTEM_PROMPT,
			resourcePolicy: BORA_CHILD_RESOURCE_POLICY,
			projectTrusted,
		});
	}

	async function ensureChild(run: BoraRun, projectTrusted: boolean): Promise<ChildAgentSession> {
		if (run.child) return run.child;
		if (!run.sessionFile) {
			throw new Error(`Cannot reopen Bora run ${run.id}: its child session path is missing. Parent state was retained.`);
		}

		try {
			const child = await createChildForRun(run, projectTrusted);
			if (!alive || currentRun !== run) {
				child.dispose();
				throw new Error("The Bora run is no longer active");
			}
			attachChild(run, child);
			return child;
		} catch (error) {
			throw new Error(
				`Cannot reopen Bora child session ${run.sessionFile}: ${formatError(error)}. Parent Bora state was retained.`,
			);
		}
	}

	async function abortRun(
		run: BoraRun,
		options: { reason: string; clearUi: boolean; suppressPublication: boolean },
	): Promise<void> {
		run.abortRequested = true;
		run.suppressPublication ||= options.suppressPublication;
		run.status = "aborted";
		run.error = options.reason;
		appendLog(run, `aborted: ${options.reason}`);
		run.phase = undefined;
		run.uiCleared = options.clearUi;
		persistCurrentRun(run);
		if (run.child) await run.child.abort().catch(() => {});
		persistCurrentRun(run);
		finishBackgroundWork(run);
		if (options.clearUi) clearUi();
		else updateUi();
	}

	function resultContent(run: BoraRun): string {
		const body = run.error ? `Error: ${run.error}\n\n${run.output}` : run.output || "No response.";
		return `Bora ${run.status} for: ${run.task}\n\nModel: ${run.resolvedModel ?? run.model}\n\n${body}`;
	}

	function publishResult(run: BoraRun): void {
		if (!alive || currentRun !== run || run.suppressPublication) return;
		const details: BoraResultDetails = {
			version: 1,
			id: run.id,
			task: run.task,
			model: run.resolvedModel ?? run.model,
			status: run.status,
			error: run.error,
		};
		pi.sendMessage(
			{
				customType: RESULT_MESSAGE,
				content: resultContent(run),
				display: true,
				details,
			},
			{ deliverAs: "followUp", triggerTurn: false },
		);
	}

	async function executeTurn(run: BoraRun, prompt: string, projectTrusted: boolean): Promise<void> {
		if (!alive || currentRun !== run || run.abortRequested) return;
		run.status = "running";
		run.error = undefined;
		run.streamingText = "";
		run.phase = "starting";
		run.uiCleared = false;
		appendLog(run, "starting");
		beginBackgroundWork(run);
		persistCurrentRun(run);
		updateUi();

		try {
			const child = await ensureChild(run, projectTrusted);
			if (!alive || currentRun !== run || run.abortRequested) return;
			await child.session.prompt(prompt, { expandPromptTemplates: false });
			if (!alive || currentRun !== run || run.abortRequested) return;

			const result = classifyTerminalResult(child.session);
			run.output = capOutput(result.output, run.maxResultChars);
			run.streamingText = "";
			run.status = result.status;
			run.error = result.error;
			appendLog(run, result.status === "completed" ? "completed" : `${result.status}: ${result.error ?? "no details"}`);
		} catch (error) {
			if (!alive || currentRun !== run) return;
			if (!run.abortRequested) {
				run.status = "failed";
				run.error = formatError(error);
				appendLog(run, `failed: ${run.error}`);
			}
			run.streamingText = "";
		} finally {
			if (!alive || currentRun !== run) return;
			run.phase = undefined;
			persistCurrentRun(run);
			finishBackgroundWork(run);
			updateUi();
			publishResult(run);
		}
	}

	async function launch(task: string, config: BoraConfig, ctx: ExtensionContext): Promise<BoraRun> {
		if (currentRun && isBoraWorking(currentRun.status)) {
			if (!ctx.hasUI) {
				throw new Error("A Bora run is already working; abort it before starting another run");
			}
			const replace = await ctx.ui.confirm("Replace active Bora run?", "This aborts the current implementation agent.");
			if (!replace) throw new Error("A Bora run is already working");
			await abortRun(currentRun, {
				reason: "Aborted to start a replacement run",
				clearUi: true,
				suppressPublication: true,
			});
		}

		if (currentRun) {
			disposeRun(currentRun);
			currentRun = undefined;
			clearUi(ctx);
		}

		const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
		const parentId = ctx.sessionManager.getSessionId().replace(/[^a-zA-Z0-9_-]/g, "_");
		const artifactDir = join(getAgentDir(), "bora-sessions", parentId, id);
		await mkdir(artifactDir, { recursive: true, mode: 0o700 });
		await chmod(artifactDir, 0o700);

		const run: BoraRun = {
			id,
			task,
			createdAt: new Date().toISOString(),
			cwd: ctx.cwd,
			artifactDir,
			model: config.model,
			thinkingLevel: config.thinkingLevel,
			maxResultChars: config.maxResultChars,
			status: "running",
			logs: [],
			output: "",
			streamingText: "",
			abortRequested: false,
			suppressPublication: false,
			uiCleared: false,
		};

		// Session creation performs model resolution and auth validation before any prompt starts.
		const projectTrusted = ctx.isProjectTrusted();
		const child = await createChildForRun(run, projectTrusted);
		if (!child.sessionFile) {
			child.dispose();
			throw new Error("Bora child session did not create a persistent JSONL file");
		}

		currentRun = run;
		currentContext = ctx;
		attachChild(run, child);
		beginBackgroundWork(run);
		persistCurrentRun(run);
		updateUi();
		void executeTurn(run, buildInitialTask(task), projectTrusted);
		return run;
	}

	async function followup(message: string, ctx: ExtensionContext): Promise<void> {
		const run = currentRun;
		if (!run) throw new Error("No Bora run to follow up");
		if (run.status === "running" || run.child?.session.isStreaming) {
			throw new Error("Wait for the current Bora run to finish before sending a follow-up");
		}

		// Reopen only on demand after reload/resume. This also gives a useful recovery error
		// without changing the persisted parent marker when the JSONL is unavailable.
		const projectTrusted = ctx.isProjectTrusted();
		await ensureChild(run, projectTrusted);
		run.abortRequested = false;
		run.suppressPublication = false;
		run.uiCleared = false;
		void executeTurn(run, buildFollowupTask(message), projectTrusted);
		ctx.ui.notify(`Bora follow-up queued for ${run.id}.`, "info");
	}

	function statusText(run: BoraRun): string {
		const output = run.streamingText || run.output || "(no output yet)";
		return [
			`Bora ${run.status} · ${run.id}`,
			`Model: ${run.resolvedModel ?? run.model}`,
			`Task: ${run.task}`,
			`Child session: ${run.sessionFile ?? "(not created)"}`,
			`Artifact directory: ${run.artifactDir}`,
			`Latest output: ${output}`,
			...(run.error ? [`Error: ${run.error}`] : []),
		].join("\n");
	}

	async function showStatus(ctx: ExtensionContext): Promise<void> {
		if (!currentRun) {
			ctx.ui.notify("No Bora run in this session.", "info");
			return;
		}
		if (ctx.mode !== "tui") {
			ctx.ui.notify(statusText(currentRun), "info");
			return;
		}

		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) => {
				const popup = new BoraStatusPopup(
					theme,
					() => {
						const run = currentRun;
						if (!run) return undefined;
						return {
							id: run.id,
							status: run.status,
							model: run.resolvedModel ?? run.model,
							task: run.task,
							sessionFile: run.sessionFile,
							artifactDir: run.artifactDir,
							logs: [...run.logs],
							streamingText: run.streamingText,
							output: run.output,
							error: run.error,
						};
					},
					done,
				);
				const refresh = () => tui.requestRender();
				overlayRefreshes.add(refresh);
				return {
					render: (width: number) => popup.render(width),
					handleInput: (data: string) => {
						if (popup.handleInput(data)) tui.requestRender();
					},
					invalidate: () => popup.invalidate(),
					dispose: () => overlayRefreshes.delete(refresh),
				};
			},
			{
				overlay: true,
				overlayOptions: { width: "90%", minWidth: 60, maxHeight: "85%", anchor: "center" },
			},
		);
	}

	function restoreRun(ctx: ExtensionContext): void {
		if (currentRun) disposeRun(currentRun);
		currentRun = undefined;
		const data = latestBoraRun(ctx.sessionManager.getBranch());
		if (!data) {
			updateUi();
			return;
		}

		const restored = markInterruptedBoraRun(data);
		currentRun = runFromPersisted(restored, data.status === "running");
		if (restored.status !== data.status) pi.appendEntry(BORA_STATE_ENTRY, restored);
		updateUi();
	}

	pi.registerMessageRenderer(RESULT_MESSAGE, (message, { expanded, outputPad }, theme) => {
		const details = message.details as BoraResultDetails | undefined;
		if (!details) return undefined;
		const color = details.status === "completed" ? "success" : "error";
		let text = theme.fg("accent", theme.bold(`Bora ${details.status}`));
		text += ` ${theme.fg("dim", details.model)} · ${theme.fg("muted", details.id)}`;
		if (details.error) text += `\n${theme.fg("error", details.error)}`;
		if (expanded && typeof message.content === "string") text += `\n\n${message.content}`;
		else if (!expanded) text += `\n${theme.fg(color, "Expand to inspect Luna's response.")}`;
		return new Text(text, outputPad, 0);
	});

	pi.on("session_start", (_event, ctx) => {
		alive = true;
		currentContext = ctx;
		restoreRun(ctx);
	});

	pi.on("session_before_tree", async (event) => {
		if (event.preparation.targetId === event.preparation.oldLeafId) return;
		const run = currentRun;
		if (run && isBoraWorking(run.status)) {
			await abortRun(run, {
				reason: "Aborted because the parent session changed branches",
				clearUi: false,
				suppressPublication: true,
			});
		}
	});

	pi.on("session_tree", (event, ctx) => {
		if (event.newLeafId === event.oldLeafId) return;
		if (currentRun) {
			finishBackgroundWork(currentRun);
			disposeRun(currentRun);
		}
		closeReportedBackgroundWork();
		currentRun = undefined;
		currentContext = ctx;
		restoreRun(ctx);
	});

	pi.on("session_compact", () => persistCurrentRun());

	pi.on("session_shutdown", async (_event, ctx) => {
		const run = currentRun;
		if (run && isBoraWorking(run.status)) {
			await abortRun(run, {
				reason: "Interrupted by session shutdown",
				clearUi: true,
				suppressPublication: true,
			});
		} else if (run) {
			finishBackgroundWork(run);
		}
		closeReportedBackgroundWork();
		clearUi(ctx);
		alive = false;
		if (uiUpdateTimer) clearTimeout(uiUpdateTimer);
		uiUpdateTimer = undefined;
		if (run) disposeRun(run);
		currentContext = undefined;
		overlayRefreshes.clear();
	});

	pi.registerCommand("bora", {
		description: "Delegate implementation work to a persistent Luna agent",
		getArgumentCompletions: (prefix) => {
			const values = ["followup ", "status", "abort", "config"];
			const matches = values.filter((value) => value.startsWith(prefix));
			return matches.length ? matches.map((value) => ({ value, label: value.trim() })) : null;
		},
		handler: async (args, ctx) => {
			alive = true;
			currentContext = ctx;
			const input = args.trim();
			const parsed = takeFirstArgument(input);
			const action = parsed.value.toLowerCase();
			try {
				if (action === "status") {
					if (parsed.rest) throw new Error("Usage: /bora status");
					await showStatus(ctx);
					return;
				}
				if (action === "config") {
					if (parsed.rest) throw new Error("Usage: /bora config");
					const config = await loadBoraConfig();
					ctx.ui.notify(
						`Bora config: ${getBoraConfigPath()}\nmodel=${config.model}\nthinkingLevel=${config.thinkingLevel ?? "(model default)"}\nmaxResultChars=${config.maxResultChars}`,
						"info",
					);
					return;
				}
				if (action === "abort") {
					if (parsed.rest) throw new Error("Usage: /bora abort");
					if (!currentRun || !isBoraWorking(currentRun.status)) {
						ctx.ui.notify("No active Bora run to abort.", "info");
						return;
					}
					await abortRun(currentRun, {
						reason: "Aborted by user",
						clearUi: true,
						suppressPublication: true,
					});
					return;
				}
				if (action === "followup" || action === "follow-up") {
					if (!currentRun) throw new Error("No Bora run to follow up");
					let message = stripOuterQuotes(parsed.rest);
					if (!message) {
						if (!ctx.hasUI) {
							throw new Error("Provide an explicit follow-up message without UI confirmation");
						}
						await ctx.waitForIdle();
						const parentMessage = latestParentAssistantMessage(ctx.sessionManager.getBranch());
						if (!parentMessage) throw new Error("No suitable non-empty parent assistant response exists for a follow-up");
						const preview = parentMessage.replace(/\s+/g, " ").slice(0, 240);
						const confirmed = await ctx.ui.confirm(
							"Send latest parent response to Bora?",
							`${preview}${parentMessage.length > 240 ? "…" : ""}`,
						);
						if (!confirmed) {
							ctx.ui.notify("Bora follow-up canceled.", "info");
							return;
						}
						message = parentMessage;
					}
					await followup(message, ctx);
					return;
				}

				if (!stripOuterQuotes(input)) await ctx.waitForIdle();
				const task = resolveBoraTask(input, ctx.sessionManager.getBranch());
				const config = await loadBoraConfig();
				const run = await launch(task, config, ctx);
				ctx.ui.notify(`Bora ${run.id} started with ${run.resolvedModel ?? run.model}.`, "info");
			} catch (error) {
				ctx.ui.notify(formatError(error), "error");
			}
		},
	});
}