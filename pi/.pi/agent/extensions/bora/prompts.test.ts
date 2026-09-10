import assert from "node:assert/strict";
import test from "node:test";
import {
	BORA_SYSTEM_PROMPT,
	buildFollowupTask,
	buildHandoffPrompt,
	buildInitialTask,
	buildParentReviewPrompt,
} from "./prompts.ts";

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

test("parent review prompt includes the task and bounded Luna report", () => {
	const prompt = buildParentReviewPrompt({
		task: "Add the review loop",
		status: "completed",
		output: "The implementation is complete.",
	});

	assert.match(prompt, /Bora has finished an implementation run/);
	assert.match(prompt, /Original request:\nAdd the review loop/);
	assert.match(prompt, /Status: completed/);
	assert.match(prompt, /Luna's output:\nThe implementation is complete\./);
});

test("parent review prompt requires read-only repository inspection and standalone handoffs", () => {
	const prompt = buildParentReviewPrompt({
		task: "Fix the command",
		status: "failed",
		error: "The child session stopped",
		output: "Partial report",
	});

	assert.match(prompt, /Inspect the actual repository changes/);
	assert.match(prompt, /Do not edit files or fix problems/);
	assert.match(prompt, /do not clean, revert, commit/);
	assert.match(prompt, /complete, implementation-ready handoff for Bora/);
	assert.match(prompt, /expected correction, relevant files or code locations, constraints, and validation/);
	assert.match(prompt, /stand on its own/);
	assert.match(prompt, /Error: The child session stopped/);
});

test("parent review prompt makes empty and failed reports useful", () => {
	for (const status of ["completed", "failed"] as const) {
		const prompt = buildParentReviewPrompt({ task: "Inspect it", status, output: "" });
		assert.match(prompt, new RegExp(`Status: ${status}`));
		assert.match(prompt, /Luna returned no output/);
		assert.match(prompt, /validation performed/);
	}

	const abortedPrompt = buildParentReviewPrompt({
		task: "Inspect it",
		status: "aborted",
		error: "Aborted by the user",
		output: "",
	});
	assert.match(abortedPrompt, /Status: aborted/);
	assert.match(abortedPrompt, /Error: Aborted by the user/);
});

test("follow-up prompt preserves the child session context", () => {
	const prompt = buildFollowupTask("Apply only the confirmed finding");
	assert.match(prompt, /Follow-up from the parent session/);
	assert.match(prompt, /Apply only the confirmed finding/);
	assert.match(prompt, /same implementation session/);
});

test("handoff request asks for concrete implementation details without fixed sections", () => {
	const prompt = buildHandoffPrompt();
	assert.match(prompt, /Create a handoff for Bora/i);
	assert.match(prompt, /what to implement/i);
	assert.match(prompt, /relevant context and constraints/i);
	assert.match(prompt, /important files if known/i);
	assert.match(prompt, /how to validate/i);
	assert.doesNotMatch(prompt, /required sections|## /i);
});

test("handoff request preserves read-only and response restrictions", () => {
	const prompt = buildHandoffPrompt();
	assert.match(prompt, /read-only/i);
	assert.match(prompt, /do not implement or modify anything/i);
	assert.match(prompt, /without asking for approval/i);
	assert.match(prompt, /offering to delegate/i);
	assert.match(prompt, /complete updated handoff/i);
});

test("handoff request includes an optional focus when provided", () => {
	const prompt = buildHandoffPrompt("the command parser");
	assert.match(prompt, /\n\nFocus: the command parser$/);
});

test("handoff request omits an empty focus", () => {
	const prompt = buildHandoffPrompt("  ");
	assert.doesNotMatch(prompt, /Focus:/);
});
