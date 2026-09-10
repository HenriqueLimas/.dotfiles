import assert from "node:assert/strict";
import test from "node:test";
import { renderBoraResult } from "./result-renderer.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function render(details: unknown, content: string, expanded: boolean): string {
	const card = renderBoraResult({ details, content }, { expanded, outputPad: 0 }, theme);
	assert.ok(card);
	return card.render(120).join("\n");
}

test("legacy result cards never expose the historical message content", () => {
	const details = {
		version: 1 as const,
		id: "run-1",
		task: "Implement the task",
		model: "provider/luna",
		status: "completed" as const,
	};
	const content = "Original task and Luna output that must stay out of the card";

	assert.doesNotMatch(render(details, content, false), /Original task and Luna output/);
	assert.doesNotMatch(render(details, content, true), /Original task and Luna output/);
});

test("legacy result cards without valid details stay compact", () => {
	for (const details of [undefined, null, { version: 1 }]) {
		const output = render(details, "sensitive historical task and output", true);
		assert.match(output, /Bora result/);
		assert.doesNotMatch(output, /sensitive historical task and output/);
	}
});

test("legacy failed result cards show status, model, run ID, and error", () => {
	const output = render(
		{
			version: 1,
			id: "run-2",
			task: "Fix the command",
			model: "provider/luna",
			status: "failed",
			error: "Child session stopped",
		},
		"hidden historical content",
		false,
	);

	assert.match(output, /Bora failed/);
	assert.match(output, /provider\/luna/);
	assert.match(output, /run-2/);
	assert.match(output, /Child session stopped/);
	assert.doesNotMatch(output, /hidden historical content/);
	assert.doesNotMatch(output, /Expand/);
});
