import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { BoraStatusPopup, type BoraStatusSnapshot } from "./status-popup.ts";

const stripAnsi = (text: string) => text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");

function theme() {
	return {
		fg: (_color: string, text: string) => `\u001b[38;5;99m${text}\u001b[39m`,
		bold: (text: string) => `\u001b[1m${text}\u001b[22m`,
	} as never;
}

function snapshot(overrides: Partial<BoraStatusSnapshot> = {}): BoraStatusSnapshot {
	return {
		id: "run-1",
		status: "running",
		model: "provider/model",
		task: "inspect the repository",
		sessionFile: "/tmp/child.jsonl",
		artifactDir: "/tmp/artifacts",
		logs: [],
		streamingText: "response",
		output: "",
		...overrides,
	};
}

test("Bora scrolls logs with Ctrl+U and Ctrl+D", () => {
	const popup = new BoraStatusPopup(
		theme(),
		() => snapshot({ logs: Array.from({ length: 30 }, (_, index) => `log ${index}`) }),
		() => {},
	);

	popup.render(48);
	assert.equal(popup.handleInput("\u0015"), true);
	assert.match(popup.render(48).join("\n"), /log 11/);
	assert.equal(popup.handleInput("\u0004"), true);
	assert.match(popup.render(48).join("\n"), /log 19/);
});

test("Bora status renders bordered, width-bounded output", () => {
	const popup = new BoraStatusPopup(
		theme(),
		() =>
			snapshot({
				logs: Array.from({ length: 30 }, (_, index) => `tool ${index} ${"x".repeat(80)}`),
			}),
		() => {},
	);

	const lines = popup.render(48);
	assert.equal(stripAnsi(lines[0]!), `╭${"─".repeat(46)}╮`);
	assert.equal(stripAnsi(lines.at(-1)!), `╰${"─".repeat(46)}╯`);
	assert.ok(lines.every((line) => visibleWidth(line) <= 48));
});
