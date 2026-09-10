import assert from "node:assert/strict";
import test from "node:test";
import { parseBoraCommand, resolveBoraFollowup, resolveBoraTask } from "./command.ts";

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

test("create-handoff is the only reserved handoff command", () => {
	assert.deepEqual(parseBoraCommand("create-handoff"), { action: "create-handoff", rest: "" });
	assert.deepEqual(parseBoraCommand("create-handoff focus on command parsing"), {
		action: "create-handoff",
		rest: "focus on command parsing",
	});
	assert.notEqual(parseBoraCommand("handoff plan: fix something").action, "create-handoff");
	assert.notEqual(parseBoraCommand("Handoff plan: fix something").action, "create-handoff");
});

test("handoff-prefixed tasks remain explicit Bora tasks", () => {
	assert.equal(resolveBoraTask("handoff plan: fix something", []), "handoff plan: fix something");
	assert.equal(resolveBoraTask("Handoff plan: fix something", []), "Handoff plan: fix something");
});

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

test("bare /bora followup uses the latest non-empty assistant response", () => {
	const branch = [assistantEntry([{ type: "text", text: "review handoff" }], "assistant")];

	assert.equal(resolveBoraFollowup("", branch), "review handoff");
});

test("explicit /bora followup takes precedence over the assistant response", () => {
	const branch = [assistantEntry([{ type: "text", text: "review handoff" }], "assistant")];

	assert.equal(resolveBoraFollowup(' "targeted correction" ', branch), "targeted correction");
});

test("bare /bora followup fails when no assistant response exists", () => {
	assert.throws(
		() => resolveBoraFollowup("", [userEntry("request", "user")]),
		/No suitable non-empty parent assistant response exists for a follow-up/,
	);
});
