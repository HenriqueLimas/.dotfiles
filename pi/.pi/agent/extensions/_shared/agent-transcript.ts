import type { AgentMessage } from "@earendil-works/pi-agent-core";

export type AgentTranscriptTone = "activity" | "prompt" | "thinking" | "tool" | "result" | "assistant" | "error";

export interface AgentTranscriptActivity {
	timestamp: number;
	kind: string;
	text: string;
}

export interface AgentTranscriptBlock {
	id: string;
	timestamp: number;
	label: string;
	text: string;
	tone: AgentTranscriptTone;
	live?: boolean;
}

function textContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((part) => {
			if (!part || typeof part !== "object") return [];
			const value = part as { type?: unknown; text?: unknown; mimeType?: unknown };
			if (value.type === "text" && typeof value.text === "string") return [value.text];
			if (value.type === "image") return [`[image${typeof value.mimeType === "string" ? ` ${value.mimeType}` : ""}]`];
			return [];
		})
		.join("\n");
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? "(no arguments)";
	} catch {
		return "(unserializable arguments)";
	}
}

function messageBlocks(message: AgentMessage, id: string, live = false): AgentTranscriptBlock[] {
	const timestamp = typeof message.timestamp === "number" ? message.timestamp : Date.now();
	if (message.role === "user") {
		return [{ id, timestamp, label: "PROMPT", text: textContent(message.content) || "(empty prompt)", tone: "prompt" }];
	}
	if (message.role === "assistant") {
		const blocks: AgentTranscriptBlock[] = [];
		for (const [index, part] of message.content.entries()) {
			if (part.type === "thinking") {
				blocks.push({ id: `${id}:${index}`, timestamp, label: "THINKING", text: part.thinking, tone: "thinking", live });
			} else if (part.type === "text") {
				blocks.push({ id: `${id}:${index}`, timestamp, label: live ? "ASSISTANT · LIVE" : "ASSISTANT", text: part.text, tone: "assistant", live });
			} else if (part.type === "toolCall") {
				blocks.push({
					id: `${id}:${index}`,
					timestamp,
					label: `TOOL CALL · ${part.name}`,
					text: safeJson(part.arguments),
					tone: "tool",
					live,
				});
			}
		}
		if (!live && message.errorMessage) {
			blocks.push({ id: `${id}:error`, timestamp, label: "ERROR", text: message.errorMessage, tone: "error" });
		}
		return blocks;
	}
	if (message.role === "toolResult") {
		return [{
			id,
			timestamp,
			label: `TOOL RESULT · ${message.toolName}`,
			text: textContent(message.content) || "(no output)",
			tone: message.isError ? "error" : "result",
		}];
	}
	if (message.role === "bashExecution") {
		return [{ id, timestamp, label: "BASH", text: `${message.command}\n${message.output}`, tone: message.exitCode === 0 ? "result" : "error" }];
	}
	if (message.role === "custom") {
		return [{ id, timestamp, label: message.customType.toUpperCase(), text: textContent(message.content), tone: "activity" }];
	}
	if (message.role === "branchSummary") {
		return [{ id, timestamp, label: "BRANCH SUMMARY", text: message.summary, tone: "activity" }];
	}
	if (message.role === "compactionSummary") {
		return [{ id, timestamp, label: "COMPACTION", text: message.summary, tone: "activity" }];
	}
	return [];
}

export function projectAgentTranscript(
	activity: readonly AgentTranscriptActivity[],
	messages: readonly AgentMessage[],
	liveMessage?: AgentMessage,
): AgentTranscriptBlock[] {
	const sequenced = [
		...activity.map((event, index) => ({
			order: index,
			block: {
				id: `activity:${event.timestamp}:${index}`,
				timestamp: event.timestamp,
				label: event.kind.toUpperCase(),
				text: event.text,
				tone: event.kind === "error" ? "error" as const : "activity" as const,
			},
		})),
		...messages.flatMap((message, messageIndex) =>
			messageBlocks(message, `message:${messageIndex}`).map((block, blockIndex) => ({
				order: activity.length + messageIndex * 100 + blockIndex,
				block,
			})),
		),
		...(liveMessage
			? messageBlocks(liveMessage, "live", true).map((block, blockIndex) => ({
				order: Number.MAX_SAFE_INTEGER - 100 + blockIndex,
				block,
			}))
			: []),
	];

	return sequenced
		.sort((left, right) => left.block.timestamp - right.block.timestamp || left.order - right.order)
		.map(({ block }) => block)
		.filter((block) => block.text.length > 0);
}
