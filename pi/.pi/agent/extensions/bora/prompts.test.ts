import assert from "node:assert/strict";
import test from "node:test";
import { BORA_SYSTEM_PROMPT, buildFollowupTask, buildInitialTask } from "./prompts.ts";

test("implementation system prompt delegates work without duplicating global guidance", () => {
	assert.match(BORA_SYSTEM_PROMPT, /implement.*current repository/i);
	assert.match(BORA_SYSTEM_PROMPT, /obey all loaded AGENTS\.md instructions/i);
	assert.match(BORA_SYSTEM_PROMPT, /do not commit, push, open a pull request/i);
	assert.match(BORA_SYSTEM_PROMPT, /changed files, validation performed, and remaining risks/i);
});

test("initial prompt names the implementation task", () => {
	const prompt = buildInitialTask("Add a health check");
	assert.match(prompt, /Implement this task in the current repository/);
	assert.match(prompt, /Add a health check/);
});

test("follow-up prompt preserves the child session context", () => {
	const prompt = buildFollowupTask("Apply only the confirmed finding");
	assert.match(prompt, /Follow-up from the parent session/);
	assert.match(prompt, /Apply only the confirmed finding/);
	assert.match(prompt, /same implementation session/);
});
