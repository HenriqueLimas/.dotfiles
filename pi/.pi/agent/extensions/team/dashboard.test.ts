import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager as TuiKeybindingsManager, type KeybindingsConfig, visibleWidth } from "@earendil-works/pi-tui";
import { TeamDashboard } from "./dashboard.ts";
import type { TeamRunSnapshot } from "./types.ts";

const stripAnsi = (text: string) => text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");

initTheme(undefined, false);

function theme() {
	return {
		fg: (_color: string, text: string) => `\u001b[38;5;99m${text}\u001b[39m`,
		bg: (_color: string, text: string) => `\u001b[48;5;17m${text}\u001b[49m`,
		bold: (text: string) => `\u001b[1m${text}\u001b[22m`,
	} as never;
}

const keybindingDefinitions = {
	"app.tools.expand": { defaultKeys: "ctrl+o", description: "Toggle input" },
} as const;

function keybindings(userBindings: KeybindingsConfig = {}): KeybindingsManager {
	return new TuiKeybindingsManager(keybindingDefinitions, userBindings) as unknown as KeybindingsManager;
}

function assistant(text: string, timestamp: number): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp,
		stopReason: "stop",
		api: "test",
		provider: "provider",
		model: "model",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	} as AgentMessage;
}

function user(text: string, timestamp: number): AgentMessage {
	return { role: "user", content: text, timestamp } as AgentMessage;
}

function assistantToolTurn(timestamp: number): AgentMessage {
	return {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "inspect the durable child session" },
			{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "dashboard.ts" } },
		],
		timestamp,
		stopReason: "toolUse",
		api: "test",
		provider: "provider",
		model: "model",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	} as AgentMessage;
}

function toolResult(timestamp: number): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "read",
		content: [{ type: "text", text: "durable tool output" }],
		isError: false,
		timestamp,
	} as AgentMessage;
}

function snapshot(): TeamRunSnapshot {
	return {
		id: "team-1",
		mode: "brainstorm",
		subject: "Should we replace the job queue?",
		createdAt: "now",
		collaborationMode: "roundtable",
		currentRound: 2,
		totalRounds: 3,
		roundsCompleted: 1,
		maxConcurrency: 2,
		roundSources: ["first", "second"],
		latestActivityMember: "first",
		members: [
			{
				name: "first",
				model: "provider/one",
				status: "running",
				activity: Array.from({ length: 30 }, (_, index) => ({ timestamp: 1_000 + index, kind: "activity" as const, text: `first activity ${index}` })),
				messages: [
					assistantToolTurn(1_500),
					toolResult(1_600),
					assistant("round one retained answer", 2_000),
					user("round two peer prompt", 3_000),
				],
				liveMessage: assistant("round two live answer", 4_000),
				revision: 1,
			},
			{
				name: "second",
				model: "provider/two",
				status: "completed",
				activity: [{ timestamp: 1_000, kind: "status", text: "completed" }],
				messages: [assistant("second retained answer", 2_000)],
				revision: 1,
			},
		],
	};
}

function dashboard(current: TeamRunSnapshot, rows = 30, bindings = keybindings()): TeamDashboard {
	return new TeamDashboard(theme(), () => current, () => {}, bindings, () => rows);
}

test("Team renders one horizontal tab row and switches tabs with Left and Right", () => {
	const current = snapshot();
	const view = dashboard(current);
	const initial = view.render(80).map(stripAnsi);
	const tabLine = initial.find((line) => line.includes("first ●") && line.includes("second ✓"));
	assert.ok(tabLine);
	assert.match(initial.join("\n"), /first provider\/one · running/);

	assert.equal(view.handleInput("\u001b[C"), true);
	assert.match(view.render(80).map(stripAnsi).join("\n"), /second provider\/two · completed/);
	assert.equal(view.handleInput("\u001b[D"), true);
	assert.match(view.render(80).map(stripAnsi).join("\n"), /first provider\/one · running/);
});

test("Team puts the latest working member first when the popup opens", () => {
	const current = snapshot();
	current.latestActivityMember = "second";
	current.members[1]!.status = "running";
	const rendered = dashboard(current).render(80).map(stripAnsi);
	const tabLine = rendered.find((line) => line.includes("▶ second ●"));
	assert.ok(tabLine);
	assert.ok(tabLine.indexOf("second") < tabLine.indexOf("first"));
	assert.match(rendered.join("\n"), /second provider\/two · running/);
});

test("Team keeps prior rounds and the live response in one complete transcript", () => {
	const current = snapshot();
	current.members[0]!.activity = [];
	current.members[0]!.revision++;
	const rendered = dashboard(current, 40).render(88).map(stripAnsi).join("\n");
	assert.match(rendered, /inspect the durable child session/);
	assert.match(rendered, /TOOL CALL · read/);
	assert.match(rendered, /durable tool output/);
	assert.match(rendered, /round one retained answer/);
	assert.match(rendered, /round two peer prompt/);
	assert.match(rendered, /round two live answer/);
	assert.match(rendered, /Round 2 broadcast: first \+ second → all successful participants/);
});

test("Team expands and collapses the initial input with the configured binding", () => {
	const current = snapshot();
	current.subject = "first input line\nsecond input line\nthird input line";
	const view = dashboard(current, 30, keybindings({ "app.tools.expand": "ctrl+x" }));

	const collapsed = view.render(60).map(stripAnsi);
	assert.equal(collapsed.filter((line) => line.includes("input line")).length, 1);
	assert.match(collapsed.at(-2)!, /ctrl\+x input/);
	assert.equal(view.handleInput("\u000f"), false);
	assert.equal(view.handleInput("\u0018"), true);
	const expanded = view.render(60).map(stripAnsi).join("\n");
	assert.match(expanded, /second input line/);
	assert.match(expanded, /third input line/);
});

test("Team supports line, page, and transcript-end navigation", () => {
	const current = snapshot();
	current.members[0]!.activity = Array.from({ length: 100 }, (_, index) => ({
		timestamp: 1_000 + index,
		kind: "activity" as const,
		text: `first activity ${index}`,
	}));
	current.members[0]!.revision++;
	const view = dashboard(current, 34);
	const position = () => {
		const match = view.render(72).map(stripAnsi).at(-2)?.match(/(\d+)-(\d+)\/(\d+)/);
		assert.ok(match);
		return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
	};

	const initial = position();
	assert.equal(view.render(72).length, 34);
	assert.equal(view.handleInput("\u001b[A"), true);
	assert.equal(position().start, initial.start - 1);
	assert.equal(view.handleInput("\u001b[B"), true);
	assert.deepEqual(position(), initial);

	assert.equal(view.handleInput("\u001bp"), true);
	assert.equal(position().start, initial.start - 24);
	assert.equal(view.handleInput("\u001bn"), true);
	assert.deepEqual(position(), initial);

	assert.equal(view.handleInput("\u001bb"), true);
	assert.equal(position().start, 1);
	assert.equal(view.handleInput("\u001bf"), true);
	assert.deepEqual(position(), initial);
	assert.match(view.render(72).map(stripAnsi).join("\n"), /round two live answer/);
});

test("Team keeps every rendered line within the supplied width", () => {
	const current = snapshot();
	current.subject = "subject ".repeat(40);
	const rendered = dashboard(current, 28).render(48);
	assert.equal(rendered.length, 28);
	assert.ok(rendered.every((line) => visibleWidth(line) <= 48));
});
