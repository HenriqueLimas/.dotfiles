import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { BORA_THINKING_LEVELS } from "./config.ts";
import type { BoraStatus, PersistedBoraRun } from "./types.ts";

export const BORA_STATE_ENTRY = "bora-state";

const STATUSES = new Set<BoraStatus>(["running", "completed", "failed", "aborted"]);
const THINKING_LEVELS = new Set<ThinkingLevel>(BORA_THINKING_LEVELS);

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

export function isPersistedBoraRun(value: unknown): value is PersistedBoraRun {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const data = value as Partial<PersistedBoraRun>;
	if (
		data.version !== 1 ||
		!isNonEmptyString(data.id) ||
		!isNonEmptyString(data.task) ||
		!isNonEmptyString(data.createdAt) ||
		!isNonEmptyString(data.cwd) ||
		!isNonEmptyString(data.artifactDir) ||
		!isNonEmptyString(data.model) ||
		!STATUSES.has(data.status as BoraStatus)
	) {
		return false;
	}
	if (data.sessionFile !== undefined && !isNonEmptyString(data.sessionFile)) return false;
	if (data.thinkingLevel !== undefined && !THINKING_LEVELS.has(data.thinkingLevel as ThinkingLevel)) return false;
	if (data.error !== undefined && typeof data.error !== "string") return false;
	if (data.latestOutput !== undefined && typeof data.latestOutput !== "string") return false;
	if (
		data.maxResultChars !== undefined &&
		(typeof data.maxResultChars !== "number" ||
			!Number.isInteger(data.maxResultChars) ||
			data.maxResultChars < 1 ||
			data.maxResultChars > 100_000)
	) {
		return false;
	}
	return true;
}

export function latestBoraRun(entries: readonly SessionEntry[]): PersistedBoraRun | undefined {
	const marker = [...entries]
		.reverse()
		.find((entry) => entry.type === "custom" && entry.customType === BORA_STATE_ENTRY);
	if (!marker || marker.type !== "custom") return undefined;
	return isPersistedBoraRun(marker.data) ? marker.data : undefined;
}

function textFromUser(message: AgentMessage): string {
	if (message.role !== "user") return "";
	if (typeof message.content === "string") return message.content.trim();
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

export function latestParentUserMessage(entries: readonly SessionEntry[]): string | undefined {
	for (const entry of [...entries].reverse()) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const text = textFromUser(entry.message);
		if (text) return text;
	}
	return undefined;
}

export function markInterruptedBoraRun(
	run: PersistedBoraRun,
	error = "Interrupted by session reload or process restart",
): PersistedBoraRun {
	if (run.status !== "running") return { ...run };
	return { ...run, status: "aborted", error };
}

export function isBoraWorking(status: BoraStatus): boolean {
	return status === "running";
}