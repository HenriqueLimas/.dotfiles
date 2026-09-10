import assert from "node:assert/strict";
import test from "node:test";
import { buildBoraResultPublication, RESULT_MESSAGE } from "./publication.ts";

test("Bora publishes a hidden parent review follow-up", () => {
	const publication = buildBoraResultPublication({
		id: "run-1",
		task: "Implement the review loop",
		model: "provider/luna",
		status: "completed",
		output: "The implementation is complete.",
	});

	assert.equal(publication.message.customType, RESULT_MESSAGE);
	assert.equal(publication.message.display, false);
	assert.equal(publication.options.deliverAs, "followUp");
	assert.equal(publication.options.triggerTurn, true);
	assert.deepEqual(publication.message.details, {
		version: 1,
		id: "run-1",
		task: "Implement the review loop",
		model: "provider/luna",
		status: "completed",
		error: undefined,
	});
	assert.match(publication.message.content, /Bora has finished an implementation run/);
	assert.match(publication.message.content, /Implement the review loop/);
	assert.match(publication.message.content, /The implementation is complete/);
});

test("Bora retains failed result details in the parent review publication", () => {
	const publication = buildBoraResultPublication({
		id: "run-2",
		task: "Fix the command",
		model: "provider/luna",
		status: "failed",
		error: "Child session stopped",
		output: "Partial report",
	});

	assert.equal(publication.message.display, false);
	assert.equal(publication.options.triggerTurn, true);
	assert.equal(publication.message.details.id, "run-2");
	assert.equal(publication.message.details.task, "Fix the command");
	assert.equal(publication.message.details.model, "provider/luna");
	assert.equal(publication.message.details.status, "failed");
	assert.equal(publication.message.details.error, "Child session stopped");
	assert.match(publication.message.content, /Status: failed/);
	assert.match(publication.message.content, /Error: Child session stopped/);
});
