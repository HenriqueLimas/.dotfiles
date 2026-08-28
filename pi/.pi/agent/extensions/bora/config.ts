import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { BoraConfig } from "./types.ts";

export const DEFAULT_BORA_MODEL = "openai-codex/gpt-5.6-luna";
export const DEFAULT_BORA_MAX_RESULT_CHARS = 30_000;
export const BORA_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const THINKING_LEVELS = new Set<ThinkingLevel>(BORA_THINKING_LEVELS);
const CONFIG_KEYS = new Set(["model", "thinkingLevel", "maxResultChars"]);

function expectRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("bora config must be an object");
	}
	return value as Record<string, unknown>;
}

export function parseBoraConfig(value: unknown): BoraConfig {
	const config = expectRecord(value);
	const unknownKeys = Object.keys(config).filter((key) => !CONFIG_KEYS.has(key));
	if (unknownKeys.length > 0) {
		throw new Error(`Unknown Bora config key${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}`);
	}

	const model = config.model === undefined ? DEFAULT_BORA_MODEL : config.model;
	if (typeof model !== "string" || model.trim() === "") {
		throw new Error("model must be a non-empty string");
	}

	if (
		config.thinkingLevel !== undefined &&
		(typeof config.thinkingLevel !== "string" || !THINKING_LEVELS.has(config.thinkingLevel as ThinkingLevel))
	) {
		throw new Error(`thinkingLevel must be one of: ${BORA_THINKING_LEVELS.join(", ")}`);
	}

	const maxResultChars = config.maxResultChars === undefined ? DEFAULT_BORA_MAX_RESULT_CHARS : config.maxResultChars;
	if (!Number.isInteger(maxResultChars) || (maxResultChars as number) < 1 || (maxResultChars as number) > 100_000) {
		throw new Error("maxResultChars must be an integer between 1 and 100000");
	}

	return {
		model: model.trim(),
		thinkingLevel: config.thinkingLevel as ThinkingLevel | undefined,
		maxResultChars: maxResultChars as number,
	};
}

export function getBoraConfigPath(): string {
	return join(getAgentDir(), "bora.json");
}

export async function loadBoraConfigFrom(path: string): Promise<BoraConfig> {
	let source: string;
	try {
		source = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return parseBoraConfig({});
		}
		throw new Error(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}

	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch (error) {
		throw new Error(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}

	try {
		return parseBoraConfig(value);
	} catch (error) {
		throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function loadBoraConfig(): Promise<BoraConfig> {
	return loadBoraConfigFrom(getBoraConfigPath());
}