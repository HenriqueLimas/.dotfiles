import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { TeamDashboard } from "./dashboard.ts";
import type { TeamRunSnapshot } from "./types.ts";

function theme() {
	return {
		fg: (_color: string, text: string) => `\u001b[38;5;99m${text}\u001b[39m`,
		bold: (text: string) => `\u001b[1m${text}\u001b[22m`,
	} as never;
}

function snapshot(): TeamRunSnapshot {
	return {
		id: "team-1",
		mode: "brainstorm",
		subject: "subject",
		createdAt: "now",
		members: [
			{
				name: "first",
				model: "provider/one",
				status: "running",
				output: "first newest output",
				logs: Array.from({ length: 30 }, (_, index) => `first log ${index}`),
			},
			{
				name: "second",
				model: "provider/two",
				status: "completed",
				output: "second newest output",
				logs: ["second log"],
			},
		],
	};
}

test("Team scrolls logs with Ctrl+U and Ctrl+D", () => {
	const current = snapshot();
	const dashboard = new TeamDashboard(theme(), () => current, () => {});

	dashboard.render(48);
	assert.equal(dashboard.handleInput("\u0015"), true);
	assert.match(dashboard.render(48).join("\n"), /first log 11/);
	assert.equal(dashboard.handleInput("\u0004"), true);
	assert.match(dashboard.render(48).join("\n"), /first log 19/);
});

test("Team resets the log viewport when selecting a member and when content shrinks", () => {
	const current = snapshot();
	const dashboard = new TeamDashboard(theme(), () => current, () => {});

	dashboard.render(48);
	dashboard.handleInput("\u001b[5~");
	current.members[0]!.logs = ["first short log"];
	current.members[0]!.output = "first short output";
	const shrunk = dashboard.render(48).join("\n");
	assert.doesNotMatch(shrunk, /\d+-\d+\/\d+/);

	dashboard.handleInput("\u001b[B");
	const selected = dashboard.render(48).join("\n");
	assert.match(selected, /second newest output/);
});

test("Team keeps every rendered line within the supplied width", () => {
	const current = snapshot();
	current.subject = "subject ".repeat(20);
	const dashboard = new TeamDashboard(theme(), () => current, () => {});

	assert.ok(dashboard.render(48).every((line) => visibleWidth(line) <= 48));
});
