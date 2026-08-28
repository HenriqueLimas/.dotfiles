import assert from "node:assert/strict";
import test from "node:test";
import { BORA_STATE_ENTRY } from "./state.ts";
import {
	isBoraWorking,
	isPersistedBoraRun,
	latestBoraRun,
	latestParentAssistantMessage,
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

function assistantEntry(content: unknown, id = "assistant-1") {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		message: { role: "assistant", content, timestamp: Date.now() },
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

test("latest non-empty assistant response ignores newer user messages", () => {
	const entries = [
		userEntry("older request"),
		assistantEntry([{ type: "text", text: "implementation plan" }]),
		userEntry("thanks"),
	];

	assert.equal(latestParentAssistantMessage(entries), "implementation plan");
});

test("empty, tool-call-only, and thinking-only assistant messages are skipped", () => {
	const entries = [
		assistantEntry([{ type: "text", text: "usable response" }], "usable"),
		assistantEntry([{ type: "text", text: "   " }], "empty"),
		assistantEntry([{ type: "toolCall", name: "edit" }], "tool-only"),
		assistantEntry([{ type: "thinking", thinking: "internal reasoning" }], "thinking-only"),
	] as never[];

	assert.equal(latestParentAssistantMessage(entries), "usable response");
	assert.equal(latestParentAssistantMessage([assistantEntry([])]), undefined);
});

test("mixed assistant content returns text blocks in order", () => {
	const entries = [
		assistantEntry([
			{ type: "thinking", thinking: "internal reasoning" },
			{ type: "text", text: "first part" },
			{ type: "toolCall", name: "read" },
			{ type: "text", text: "second part" },
		]),
	] as never[];

	assert.equal(latestParentAssistantMessage(entries), "first part\nsecond part");
});

test("only the supplied active branch is inspected", () => {
	const inactiveBranch = [assistantEntry([{ type: "text", text: "inactive response" }]), userEntry("inactive user")];
	const activeBranch = [assistantEntry([{ type: "text", text: "active response" }])];

	assert.equal(latestParentAssistantMessage(activeBranch), "active response");
	assert.notEqual(latestParentAssistantMessage(activeBranch), latestParentAssistantMessage(inactiveBranch));
});

test("no suitable assistant response returns undefined", () => {
	assert.equal(latestParentAssistantMessage([userEntry("request")]), undefined);
});

test("only running state counts as active work", () => {
	assert.equal(isBoraWorking("running"), true);
	assert.equal(isBoraWorking("completed"), false);
	assert.equal(isBoraWorking("failed"), false);
	assert.equal(isBoraWorking("aborted"), false);
});