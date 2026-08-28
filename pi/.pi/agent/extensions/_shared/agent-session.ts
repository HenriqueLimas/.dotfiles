import { chmod, mkdir, stat } from "node:fs/promises";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	resolveCliModel,
	SessionManager,
	SettingsManager,
	type AgentSessionEvent,
	type AgentSessionEventListener,
	type CreateAgentSessionOptions,
	type ResourceLoader,
} from "@earendil-works/pi-coding-agent";

export const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const;
export const IMPLEMENTATION_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

export interface ChildResourcePolicy {
	noExtensions: boolean;
	noSkills: boolean;
	noPromptTemplates: boolean;
	noThemes: boolean;
	noContextFiles?: boolean;
}

export const DEFAULT_CHILD_RESOURCE_POLICY: ChildResourcePolicy = {
	noExtensions: true,
	noSkills: true,
	noPromptTemplates: true,
	noThemes: true,
	noContextFiles: false,
};

export interface ChildSessionRequest {
	cwd: string;
	artifactDir: string;
	sessionFile?: string;
	sessionName: string;
	model: string;
	thinkingLevel?: ThinkingLevel;
	tools: readonly string[];
	appendSystemPrompt: string | readonly string[];
	resourcePolicy: ChildResourcePolicy;
	/** Parent trust state for project-local resources. Omitted by legacy callers. */
	projectTrusted?: boolean;
	/** Bora requires a durable prior file; `/team` preserves its historical reopen behavior. */
	requireExistingSessionFile?: boolean;
	/** Injectable for characterization tests and callers that already own a runtime. */
	modelRuntime?: ModelRuntime;
}

export interface ChildSessionCreationOptions {
	cwd: string;
	modelRuntime: ModelRuntime;
	model: NonNullable<CreateAgentSessionOptions["model"]>;
	thinkingLevel?: ThinkingLevel;
	tools: readonly string[];
	resourceLoader: ResourceLoader;
	sessionManager: SessionManager;
}

export interface ChildTerminalResult {
	status: "completed" | "failed" | "aborted";
	output: string;
	error?: string;
	stopReason?: string;
}

let modelRuntimePromise: Promise<ModelRuntime> | undefined;

/** Share the process-local model/auth runtime between child-session callers. */
export function getModelRuntime(): Promise<ModelRuntime> {
	if (!modelRuntimePromise) {
		modelRuntimePromise = ModelRuntime.create({ allowModelNetwork: false }).catch((error) => {
			modelRuntimePromise = undefined;
			throw error;
		});
	}
	return modelRuntimePromise;
}

/**
 * Keep the final SDK options in one place so callers cannot accidentally widen
 * the child tool allowlist or omit the isolated resource loader.
 */
export function buildAgentSessionOptions(options: ChildSessionCreationOptions): CreateAgentSessionOptions {
	return {
		cwd: options.cwd,
		agentDir: getAgentDir(),
		model: options.model,
		thinkingLevel: options.thinkingLevel,
		tools: [...options.tools],
		resourceLoader: options.resourceLoader,
		sessionManager: options.sessionManager,
		modelRuntime: options.modelRuntime,
	};
}

export class ChildAgentSession {
	private readonly subscriptions = new Set<() => void>();
	private readonly protectSessionFileUnsubscribe?: () => void;

	constructor(
		public readonly session: AgentSession,
		public readonly sessionManager: SessionManager,
		public readonly configuredModel: string,
		public readonly resolvedModel: string,
	) {
		const sessionFile = session.sessionFile;
		if (sessionFile) {
			const protectSessionFile = () => {
				void chmod(sessionFile, 0o600).catch(() => {});
			};
			this.protectSessionFileUnsubscribe = session.subscribe((event) => {
				if (event.type === "message_end") protectSessionFile();
			});
			protectSessionFile();
		}
	}

	get sessionFile(): string | undefined {
		return this.session.sessionFile;
	}

	get thinkingLevel(): ThinkingLevel {
		return this.session.thinkingLevel;
	}

	subscribe(listener: AgentSessionEventListener): () => void {
		const unsubscribe = this.session.subscribe(listener);
		this.subscriptions.add(unsubscribe);
		return () => {
			if (!this.subscriptions.delete(unsubscribe)) return;
			unsubscribe();
		};
	}

	abort(): Promise<void> {
		return this.session.abort();
	}

	dispose(): void {
		this.protectSessionFileUnsubscribe?.();
		for (const unsubscribe of this.subscriptions) unsubscribe();
		this.subscriptions.clear();
		this.session.dispose();
	}
}

export async function createChildAgentSession(request: ChildSessionRequest): Promise<ChildAgentSession> {
	await mkdir(request.artifactDir, { recursive: true, mode: 0o700 });
	await chmod(request.artifactDir, 0o700);
	if (request.sessionFile && request.requireExistingSessionFile) {
		await validateExistingSessionFile(request.sessionFile);
		await chmod(request.sessionFile, 0o600);
	}

	const modelRuntime = request.modelRuntime ?? (await getModelRuntime());
	const resolved = resolveCliModel({
		cliModel: request.model,
		cliThinking: request.thinkingLevel,
		modelRuntime,
	});
	if (!resolved.model) throw new Error(resolved.error ?? `Unknown model: ${request.model}`);
	if (!(await modelRuntime.getAuth(resolved.model))) {
		throw new Error(`No authentication available for ${resolved.model.provider}/${resolved.model.id}`);
	}

	const appendSystemPrompt =
		typeof request.appendSystemPrompt === "string"
			? [request.appendSystemPrompt]
			: [...request.appendSystemPrompt];
	const policy = request.resourcePolicy;
	const settingsManager = SettingsManager.create(request.cwd, getAgentDir(), {
		projectTrusted: request.projectTrusted,
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd: request.cwd,
		agentDir: getAgentDir(),
		settingsManager,
		noExtensions: policy.noExtensions,
		noSkills: policy.noSkills,
		noPromptTemplates: policy.noPromptTemplates,
		noThemes: policy.noThemes,
		noContextFiles: policy.noContextFiles,
		appendSystemPromptOverride: (base) => [...base, ...appendSystemPrompt],
	});
	await resourceLoader.reload();

	let sessionManager: SessionManager;
	if (request.sessionFile) {
		try {
			sessionManager = SessionManager.open(request.sessionFile, request.artifactDir, request.cwd);
		} catch (error) {
			throw new Error(`Cannot open child session ${request.sessionFile}: ${formatError(error)}`);
		}
	} else {
		sessionManager = SessionManager.create(request.cwd, request.artifactDir);
		sessionManager.appendSessionInfo(request.sessionName);
	}

	const { session } = await createAgentSession(
		buildAgentSessionOptions({
			cwd: request.cwd,
			modelRuntime,
			model: resolved.model,
			thinkingLevel: resolved.thinkingLevel ?? request.thinkingLevel,
			tools: request.tools,
			resourceLoader,
			sessionManager,
		}),
	);
	const sessionFile = session.sessionFile ?? sessionManager.getSessionFile();
	if (sessionFile) {
		try {
			await chmod(sessionFile, 0o600);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}

	return new ChildAgentSession(
		session,
		sessionManager,
		request.model,
		`${resolved.model.provider}/${resolved.model.id}`,
	);
}

async function validateExistingSessionFile(sessionFile: string): Promise<void> {
	const info = await stat(sessionFile).catch((error: unknown) => {
		throw new Error(`Child session file is unavailable: ${formatError(error)}`);
	});
	if (!info.isFile()) throw new Error(`Child session path is not a file: ${sessionFile}`);
	if (info.size === 0) throw new Error(`Child session file is empty: ${sessionFile}`);
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function textFromAssistant(message: AgentMessage | undefined): string {
	if (!message || message.role !== "assistant") return "";
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

export function latestAssistant(session: Pick<AgentSession, "messages">): Extract<AgentMessage, { role: "assistant" }> | undefined {
	return [...session.messages]
		.reverse()
		.find((message): message is Extract<AgentMessage, { role: "assistant" }> => message.role === "assistant");
}

export function classifyTerminalResult(session: Pick<AgentSession, "messages">): ChildTerminalResult {
	const last = latestAssistant(session);
	if (!last) {
		return { status: "failed", output: "", error: "Model returned no assistant message" };
	}

	if (last.stopReason === "aborted") {
		return {
			status: "aborted",
			output: textFromAssistant(last),
			error: last.errorMessage ?? "Model stopped with aborted",
			stopReason: last.stopReason,
		};
	}
	if (last.stopReason === "error") {
		return {
			status: "failed",
			output: textFromAssistant(last),
			error: last.errorMessage ?? "Model stopped with error",
			stopReason: last.stopReason,
		};
	}

	return {
		status: "completed",
		output: textFromAssistant(last),
		stopReason: last.stopReason,
	};
}

export type { AgentSessionEvent };