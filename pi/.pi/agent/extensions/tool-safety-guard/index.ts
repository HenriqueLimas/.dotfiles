import type { Usage } from "@earendil-works/pi-ai";
import {
	getAgentDir,
	isToolCallEventType,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { loadToolSafetyConfig, resolveToolRule, type FailureMode } from "./config.ts";
import { BLOCKED_FLAGS, findBlockedFlag } from "./policies.ts";
import { addUsage, reviewToolCall, ToolReviewError } from "./reviewer.ts";

const CONFIG_PATH = join(getAgentDir(), "tool-safety.json");

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error"): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}

function toolSummary(toolName: string, input: unknown): string {
	if (toolName === "bash" && input && typeof input === "object") {
		const command = (input as { command?: unknown }).command;
		if (typeof command === "string") return command.length <= 1_000 ? command : `${command.slice(0, 1_000)}…`;
	}
	try {
		const serialized = JSON.stringify(input);
		return serialized.length <= 1_000 ? serialized : `${serialized.slice(0, 1_000)}…`;
	} catch {
		return "<unserializable tool input>";
	}
}

async function askUser(
	ctx: ExtensionContext,
	toolName: string,
	input: unknown,
	reason: string,
): Promise<{ block: true; reason: string } | undefined> {
	if (!ctx.hasUI) return { block: true, reason: `${reason} No interactive UI is available for confirmation.` };
	const confirmed = await ctx.ui.confirm(
		`Confirm ${toolName} tool call`,
		`${reason}\n\n${toolSummary(toolName, input)}`,
	);
	return confirmed ? undefined : { block: true, reason: `Tool call rejected. ${reason}` };
}

async function handleReviewFailure(
	failureMode: FailureMode,
	ctx: ExtensionContext,
	toolName: string,
	input: unknown,
	error: unknown,
): Promise<{ block: true; reason: string } | undefined> {
	const detail = error instanceof Error ? error.message : String(error);
	const reason = `Automatic safety review failed closed: ${detail}`;
	notify(ctx, reason, "warning");
	if (failureMode === "ask") return askUser(ctx, toolName, input, reason);
	return { block: true, reason };
}

export default function toolSafetyGuard(pi: ExtensionAPI) {
	const configResult = loadToolSafetyConfig(CONFIG_PATH);
	const reviewerUsage = new Map<string, Usage>();

	pi.on("session_start", (_event, ctx) => {
		if (configResult.status === "invalid") notify(ctx, configResult.error, "error");
	});

	pi.on("tool_call", async (event, ctx) => {
		if (isToolCallEventType("bash", event)) {
			const { command } = event.input;
			if (typeof command === "string") {
				const blockedFlag = findBlockedFlag(command);
				if (blockedFlag) {
					const block = BLOCKED_FLAGS[blockedFlag];
					notify(ctx, block.notification, "warning");
					return { block: true, reason: block.reason };
				}
			}
		}

		if (configResult.status === "missing") return;
		if (configResult.status === "invalid") {
			return { block: true, reason: `${configResult.error} Tool execution is blocked until the config is fixed.` };
		}

		const { config } = configResult;
		if (!config.enabled) return;
		const rule = resolveToolRule(config, event.toolName);
		if (!rule) return;
		const reviewer = config.reviewers[rule.reviewer];
		ctx.ui.setStatus("tool-safety", `reviewing ${event.toolName} with ${rule.reviewer}`);

		try {
			const verdict = await reviewToolCall(ctx, config, rule, reviewer, event.toolName, event.input);
			reviewerUsage.set(event.toolCallId, verdict.usage);
			if (verdict.decision === "allow") return;
			if (verdict.decision === "ask") {
				return askUser(ctx, event.toolName, event.input, `Safety reviewer requested confirmation: ${verdict.reason}`);
			}
			notify(ctx, `Blocked ${event.toolName}: ${verdict.reason}`, "warning");
			return { block: true, reason: `Automatic safety review blocked this tool call: ${verdict.reason}` };
		} catch (error) {
			if (error instanceof ToolReviewError && error.usage) reviewerUsage.set(event.toolCallId, error.usage);
			return handleReviewFailure(config.failureMode, ctx, event.toolName, event.input, error);
		} finally {
			ctx.ui.setStatus("tool-safety", undefined);
		}
	});

	pi.on("tool_result", (event) => {
		const usage = reviewerUsage.get(event.toolCallId);
		if (!usage) return;
		reviewerUsage.delete(event.toolCallId);
		return { usage: addUsage(event.usage, usage) };
	});

	pi.on("session_shutdown", () => {
		reviewerUsage.clear();
	});
}
