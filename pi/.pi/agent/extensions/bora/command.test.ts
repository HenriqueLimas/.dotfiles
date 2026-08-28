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

test("bare /bora uses the latest non-empty parent user message", () => {
	const branch = [userEntry("older task", "old"), userEntry("  ", "empty"), userEntry("latest task", "latest")];

	assert.equal(resolveBoraTask("", branch), "latest task");
});

test("explicit /bora task takes precedence over the parent user message", () => {
	const branch = [userEntry("implicit task", "parent")];

	assert.equal(resolveBoraTask(' "explicit task" ', branch), "explicit task");
});

test("bare /bora fails when no suitable parent user message exists", () => {
	assert.throws(() => resolveBoraTask("  ", []), /No suitable non-empty parent user message exists for bare \/bora/);
});
