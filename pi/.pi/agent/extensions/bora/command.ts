import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { latestParentUserMessage } from "./state.ts";

export function stripOuterQuotes(value: string): string {
	const trimmed = value.trim();
	if (
		trimmed.length >= 2 &&
		((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
			(trimmed.startsWith("'") && trimmed.endsWith("'")))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

export function resolveBoraTask(input: string, branch: readonly SessionEntry[]): string {
	const explicitTask = stripOuterQuotes(input);
	if (explicitTask) return explicitTask;

	const parentMessage = latestParentUserMessage(branch);
	if (!parentMessage) throw new Error("No suitable non-empty parent user message exists for bare /bora");
	return parentMessage;
}
