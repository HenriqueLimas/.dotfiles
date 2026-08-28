import { readFileSync } from "node:fs";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type FailureMode = "block" | "ask";

export interface ReviewerConfig {
	provider: string;
	model: string;
	thinkingLevel: ThinkingLevel;
}

export interface ToolRule {
	reviewer: string;
	policy?: string;
}

export interface ToolSafetyConfig {
	enabled: boolean;
	reviewers: Record<string, ReviewerConfig>;
	tools: Record<string, ToolRule | false>;
	failureMode: FailureMode;
	timeoutMs: number;
	maxToolInputChars: number;
	maxUserContextChars: number;
	policy: string;
}

export type ConfigLoadResult =
	| { status: "missing" }
	| { status: "loaded"; config: ToolSafetyConfig }
	| { status: "invalid"; error: string };

const DEFAULT_POLICY = [
	"Allow unless the command presents a concrete, plausible high-risk effect on the machine, credentials, security boundaries, or broadly valuable data.",
	"Allow normal development activity, including file modifications, dependency installation, project scripts, shell chaining, local development processes, and deletion of scoped workspace files.",
	"Ask only when a concrete high-risk effect is plausible but the target or user intent makes confirmation useful.",
	"Block only clear catastrophic destruction, credential theft or disclosure, security-control bypass, malicious persistence, or comparable machine compromise.",
	"Missing or truncated context alone does not imply ask.",
].join(" ");

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOOL_INPUT_CHARS = 12_000;
const DEFAULT_MAX_USER_CONTEXT_CHARS = 6_000;

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
	const allowedKeys = new Set(allowed);
	const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
	if (unknown) throw new Error(`${path}.${unknown} is not supported`);
}

function optionalBoolean(value: unknown, fallback: boolean, path: string): boolean {
	if (value === undefined) return fallback;
	if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
	return value;
}

function optionalString(value: unknown, fallback: string, path: string): string {
	if (value === undefined) return fallback;
	if (typeof value !== "string") throw new Error(`${path} must be a string`);
	return value;
}

function requiredNonEmptyString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${path} must be a non-empty string`);
	}
	return value;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, path: string): number {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new Error(`${path} must be an integer between ${minimum} and ${maximum}`);
	}
	return value as number;
}

function parseReviewer(value: unknown, path: string): ReviewerConfig {
	assertObject(value, path);
	rejectUnknownKeys(value, ["provider", "model", "thinkingLevel"], path);

	const thinkingLevel = value.thinkingLevel ?? "low";
	if (typeof thinkingLevel !== "string" || !THINKING_LEVELS.includes(thinkingLevel as ThinkingLevel)) {
		throw new Error(`${path}.thinkingLevel must be one of ${THINKING_LEVELS.join(", ")}`);
	}

	return {
		provider: requiredNonEmptyString(value.provider, `${path}.provider`),
		model: requiredNonEmptyString(value.model, `${path}.model`),
		thinkingLevel: thinkingLevel as ThinkingLevel,
	};
}

function parseToolRule(value: unknown, path: string): ToolRule | false {
	if (value === false) return false;
	assertObject(value, path);
	rejectUnknownKeys(value, ["reviewer", "policy"], path);

	const policy = value.policy;
	if (policy !== undefined && (typeof policy !== "string" || policy.trim().length === 0)) {
		throw new Error(`${path}.policy must be a non-empty string when provided`);
	}

	return {
		reviewer: requiredNonEmptyString(value.reviewer, `${path}.reviewer`),
		...(typeof policy === "string" ? { policy } : {}),
	};
}

export function parseToolSafetyConfig(value: unknown): ToolSafetyConfig {
	assertObject(value, "tool-safety config");
	rejectUnknownKeys(
		value,
		[
			"enabled",
			"reviewers",
			"tools",
			"failureMode",
			"timeoutMs",
			"maxToolInputChars",
			"maxUserContextChars",
			"policy",
		],
		"tool-safety config",
	);

	assertObject(value.reviewers, "tool-safety config.reviewers");
	assertObject(value.tools, "tool-safety config.tools");

	const reviewers = Object.fromEntries(
		Object.entries(value.reviewers).map(([name, reviewer]) => {
			if (name.trim().length === 0) throw new Error("reviewer names must not be empty");
			return [name, parseReviewer(reviewer, `tool-safety config.reviewers.${name}`)];
		}),
	);
	const tools = Object.fromEntries(
		Object.entries(value.tools).map(([name, rule]) => {
			if (name.trim().length === 0) throw new Error("tool names must not be empty");
			return [name, parseToolRule(rule, `tool-safety config.tools.${name}`)];
		}),
	);

	for (const [toolName, rule] of Object.entries(tools)) {
		if (rule && !reviewers[rule.reviewer]) {
			throw new Error(`tool-safety config.tools.${toolName}.reviewer references unknown reviewer ${rule.reviewer}`);
		}
	}

	const failureMode = value.failureMode ?? "block";
	if (failureMode !== "block" && failureMode !== "ask") {
		throw new Error("tool-safety config.failureMode must be block or ask");
	}

	return {
		enabled: optionalBoolean(value.enabled, true, "tool-safety config.enabled"),
		reviewers,
		tools,
		failureMode,
		timeoutMs: boundedInteger(value.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 600_000, "tool-safety config.timeoutMs"),
		maxToolInputChars: boundedInteger(
			value.maxToolInputChars,
			DEFAULT_MAX_TOOL_INPUT_CHARS,
			1_000,
			100_000,
			"tool-safety config.maxToolInputChars",
		),
		maxUserContextChars: boundedInteger(
			value.maxUserContextChars,
			DEFAULT_MAX_USER_CONTEXT_CHARS,
			1_000,
			100_000,
			"tool-safety config.maxUserContextChars",
		),
		policy: optionalString(value.policy, DEFAULT_POLICY, "tool-safety config.policy"),
	};
}

export function resolveToolRule(config: ToolSafetyConfig, toolName: string): ToolRule | undefined {
	const exact = config.tools[toolName];
	if (exact !== undefined) return exact || undefined;
	const fallback = config.tools["*"];
	return fallback || undefined;
}

export function loadToolSafetyConfig(path: string): ConfigLoadResult {
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
		return { status: "invalid", error: `Could not read ${path}: ${String(error)}` };
	}

	try {
		return { status: "loaded", config: parseToolSafetyConfig(JSON.parse(source)) };
	} catch (error) {
		return {
			status: "invalid",
			error: `Invalid ${path}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}
