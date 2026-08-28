import assert from "node:assert/strict";
import test from "node:test";
import { BORA_STATE_ENTRY } from "./state.ts";
import {
	isBoraWorking,
	isPersistedBoraRun,
	latestBoraRun,
	latestParentUserMessage,
	markInterruptedBoraRun,
} from "./state.ts";
import type { PersistedBoraRun } from "./types.ts";

const run: PersistedBoraRun = {
	version: 1,
	id: "run-1",
	task: "Implement the feature",
	createdAt: "2026-01-01T00:00:00.000Z",
	cwd: "/repo",
	artifactDir: "/home/user/.pi/agent/bora-sessions/parent/run-1",
	sessionFile: "/home/user/.pi/agent/bora-sessions/parent/run-1/session.jsonl",
	model: "openai-codex/gpt-5.6-luna",
	thinkingLevel: "high",
	status: "completed",
	latestOutput: "Done",
};

function customEntry(data: unknown, id = "entry-1") {
	return {
		type: "custom",
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		customType: BORA_STATE_ENTRY,
		data,
	} as never;
}

function userEntry(content: unknown, id = "user-1") {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		message: { role: "user", content, timestamp: Date.now() },
	} as never;
}

test("persisted Bora state is validated", () => {
	assert.equal(isPersistedBoraRun(run), true);
	assert.equal(isPersistedBoraRun({ ...run, version: 2 }), false);
	assert.equal(isPersistedBoraRun({ ...run, status: "working" }), false);
	assert.equal(isPersistedBoraRun({ ...run, thinkingLevel: "turbo" }), false);
	assert.equal(isPersistedBoraRun({ ...run, sessionFile: "" }), false);
	assert.equal(isPersistedBoraRun({ ...run, maxResultChars: 0 }), false);
});

test("the latest Bora marker is selected from the active branch", () => {
	const latest = latestBoraRun([customEntry(run, "old"), customEntry({ ...run, id: "run-2" }, "new")]);
	assert.equal(latest?.id, "run-2");
	assert.equal(latestBoraRun([customEntry({ ...run, status: "invalid" })]), undefined);
});

test("running state is restored as aborted after interruption", () => {
	const interrupted = markInterruptedBoraRun({ ...run, status: "running" });
	assert.equal(interrupted.status, "aborted");
	assert.match(interrupted.error ?? "", /reload or process restart/);
	assert.equal(markInterruptedBoraRun(run).status, "completed");
});

test("latest non-empty parent user message ignores empty and assistant entries", () => {
	const entries = [
		userEntry("first", "first"),
		{
			type: "message",
			id: "assistant",
			parentId: "first",
			timestamp: "2026-01-01T00:00:01.000Z",
			message: { role: "assistant", content: [{ type: "text", text: "reply" }], timestamp: Date.now() },
		},
		userEntry("   ", "empty"),
		userEntry([{ type: "text", text: "latest feedback" }], "latest"),
	] as never[];

	assert.equal(latestParentUserMessage(entries), "latest feedback");
	assert.equal(latestParentUserMessage([userEntry("  ")]), undefined);
});

test("only running state counts as active work", () => {
	assert.equal(isBoraWorking("running"), true);
	assert.equal(isBoraWorking("completed"), false);
	assert.equal(isBoraWorking("failed"), false);
	assert.equal(isBoraWorking("aborted"), false);
});