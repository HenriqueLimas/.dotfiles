import assert from "node:assert/strict";
import test from "node:test";
import { parseToolSafetyConfig, resolveToolRule } from "./config.ts";
import { boundText, parseReviewResponse, recentUserContext, reviewToolCall } from "./reviewer.ts";

test("review response accepts only the exact decision schema", () => {
	assert.deepEqual(parseReviewResponse('{"decision":"allow","reason":"Routine read."}'), {
		decision: "allow",
		reason: "Routine read.",
	});
	assert.throws(
		() => parseReviewResponse('```json\n{"decision":"allow","reason":"Routine read."}\n```'),
		/invalid JSON/,
	);
	assert.throws(
		() => parseReviewResponse('{"decision":"allow","reason":"Routine read.","confidence":1}'),
		/unsupported field confidence/,
	);
});

test("bounded text retains both ends and marks omitted content", () => {
	const bounded = boundText(`${"a".repeat(1_000)}${"z".repeat(1_000)}`, 1_000);
	assert.equal(bounded.length, 1_000);
	assert.match(bounded, /^a+/);
	const marker = bounded.match(/<tool-safety-truncated omitted-characters="(\d+)"\/>/)?.[0];
	const omittedCharacters = bounded.match(/omitted-characters="(\d+)"/)?.[1];
	assert.ok(marker);
	assert.equal(Number(omittedCharacters), 2_000 - (bounded.length - marker.length - 2));
	assert.match(bounded, /z+$/);
});

test("user context includes only user messages in chronological order", () => {
	const context = recentUserContext(
		[
			{ type: "message", message: { role: "user", content: [{ type: "text", text: "first" }] } },
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "ignore" }] } },
			{ type: "message", message: { role: "toolResult", content: [{ type: "text", text: "ignore" }] } },
			{ type: "message", message: { role: "user", content: "second" } },
		],
		1_000,
	);
	assert.equal(context, "USER: first\n\nUSER: second");
});

test("tool review resolves the configured model and validates its verdict", async () => {
	const config = parseToolSafetyConfig({
		reviewers: { luna: { provider: "openai-codex", model: "gpt-5.6-luna", thinkingLevel: "low" } },
		tools: { bash: { reviewer: "luna" } },
	});
	const rule = resolveToolRule(config, "bash")!;
	const usage = {
		input: 10,
		output: 5,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 15,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	let receivedOptions: Record<string, unknown> | undefined;
	const ctx = {
		cwd: "/workspace",
		signal: undefined,
		sessionManager: {
			getBranch: () => [{ type: "message", message: { role: "user", content: "Inspect the repository." } }],
		},
		modelRegistry: {
			find: (provider: string, model: string) => ({ provider, id: model }),
			hasConfiguredAuth: () => true,
			complete: async (_model: unknown, _context: unknown, options: Record<string, unknown>) => {
				receivedOptions = options;
				return {
					stopReason: "stop",
					content: [{ type: "text", text: '{"decision":"allow","reason":"Authorized read-only command."}' }],
					usage,
				};
			},
		},
	};

	const verdict = await reviewToolCall(
		ctx as never,
		config,
		rule,
		config.reviewers.luna,
		"bash",
		{ command: "git status" },
	);
	assert.equal(verdict.decision, "allow");
	assert.equal(verdict.usage.totalTokens, 15);
	assert.equal(receivedOptions?.reasoningEffort, "low");
	assert.equal(receivedOptions?.maxTokens, 1_024);
});
