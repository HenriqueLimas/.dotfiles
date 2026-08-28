import assert from "node:assert/strict";
import test from "node:test";
import { resolveBoraTask } from "./command.ts";

function userEntry(content: unknown, id: string) {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		message: { role: "user", content, timestamp: Date.now() },
	} as never;
}

function assistantEntry(content: unknown, id: string) {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		message: { role: "assistant", content, timestamp: Date.now() },
	} as never;
}

test("bare /bora uses the latest non-empty assistant response", () => {
	const branch = [assistantEntry([{ type: "text", text: "implementation plan" }], "assistant")];

	assert.equal(resolveBoraTask("", branch), "implementation plan");
});

test("a newer user message does not become the bare /bora task", () => {
	const branch = [assistantEntry([{ type: "text", text: "implementation plan" }], "assistant"), userEntry("thanks", "user")];

	assert.equal(resolveBoraTask("", branch), "implementation plan");
});

test("explicit /bora task takes precedence over the assistant response", () => {
	const branch = [assistantEntry([{ type: "text", text: "implicit task" }], "assistant")];

	assert.equal(resolveBoraTask(' "explicit task" ', branch), "explicit task");
});

test("bare /bora fails when no assistant response exists", () => {
	assert.throws(
		() => resolveBoraTask("  ", [userEntry("request", "user")]),
		/No suitable non-empty parent assistant response exists for bare \/bora/,
	);
});
