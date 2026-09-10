import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { latestParentAssistantMessage } from "./state.ts";

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

export function parseBoraCommand(input: string): { action: string; rest: string } {
	const parsed = takeFirstArgument(input);
	return { action: parsed.value.toLowerCase(), rest: parsed.rest };
}

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

	const parentMessage = latestParentAssistantMessage(branch);
	if (!parentMessage) throw new Error("No suitable non-empty parent assistant response exists for bare /bora");
	return parentMessage;
}

export function resolveBoraFollowup(input: string, branch: readonly SessionEntry[]): string {
	const explicitMessage = stripOuterQuotes(input);
	if (explicitMessage) return explicitMessage;

	const parentMessage = latestParentAssistantMessage(branch);
	if (!parentMessage) throw new Error("No suitable non-empty parent assistant response exists for a follow-up");
	return parentMessage;
}
