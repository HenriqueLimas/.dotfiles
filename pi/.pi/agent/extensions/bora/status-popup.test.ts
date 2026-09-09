import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager as TuiKeybindingsManager, type KeybindingsConfig, visibleWidth } from "@earendil-works/pi-tui";
import { BoraStatusPopup, type BoraStatusSnapshot } from "./status-popup.ts";

const stripAnsi = (text: string) => text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");

initTheme(undefined, false);

function theme() {
	return {
		fg: (_color: string, text: string) => `\u001b[38;5;99m${text}\u001b[39m`,
		bold: (text: string) => `\u001b[1m${text}\u001b[22m`,
	} as never;
}

const keybindingDefinitions = {
	"app.tools.expand": { defaultKeys: "ctrl+o", description: "Toggle task" },
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

function toolTurn(timestamp: number): AgentMessage {
	return {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "inspect the implementation before editing" },
			{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "src/index.ts" } },
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
		content: [{ type: "text", text: "complete tool output" }],
		isError: false,
		timestamp,
	} as AgentMessage;
}

function snapshot(overrides: Partial<BoraStatusSnapshot> = {}): BoraStatusSnapshot {
	return {
		id: "run-1",
		status: "running",
		model: "provider/model",
		task: "inspect the repository",
		sessionFile: "/tmp/child.jsonl",
		artifactDir: "/tmp/artifacts",
		activity: [{ timestamp: 1_000, kind: "status", text: "Starting" }],
		messages: [toolTurn(2_000), toolResult(3_000), assistant("retained completed answer", 4_000)],
		liveMessage: assistant("current live answer", 5_000),
		revision: 1,
		phase: "responding",
		...overrides,
	};
}

function popup(current: BoraStatusSnapshot, rows = 34, bindings = keybindings()): BoraStatusPopup {
	return new BoraStatusPopup(theme(), () => current, () => {}, bindings, () => rows);
}

test("Bora uses a near-fullscreen layout and keeps the task above the transcript", () => {
	const current = snapshot({ task: `first task line\nsecond task line\nthird task line ${"x".repeat(80)}` });
	const rendered = popup(current, 32).render(64).map(stripAnsi);
	assert.equal(rendered.length, 32);
	assert.equal(rendered.filter((line) => line.includes("Task")).length, 1);
	assert.match(rendered.join("\n"), /Complete child transcript/);
	assert.match(rendered.join("\n"), /current live answer/);
});

test("Bora expands and collapses the task with Ctrl+O while reserving most rows for logs", () => {
	const current = snapshot({ task: "first task line\nsecond task line\nthird task line" });
	const view = popup(current, 34);
	assert.equal(view.render(60).map(stripAnsi).filter((line) => line.includes("task line")).length, 1);

	assert.equal(view.handleInput("\u000f"), true);
	const expanded = view.render(60).map(stripAnsi);
	assert.match(expanded.join("\n"), /second task line/);
	assert.match(expanded.join("\n"), /third task line/);
	assert.ok(expanded.filter((line) => line.includes("task line")).length < expanded.length / 2);

	assert.equal(view.handleInput("\u000f"), true);
	assert.equal(view.render(60).map(stripAnsi).filter((line) => line.includes("task line")).length, 1);
});

test("Bora renders the complete durable transcript without replacing prior output", () => {
	const rendered = popup(snapshot(), 40).render(88).map(stripAnsi).join("\n");
	assert.match(rendered, /inspect the implementation before editing/);
	assert.match(rendered, /TOOL CALL · read/);
	assert.match(rendered, /complete tool output/);
	assert.match(rendered, /retained completed answer/);
	assert.match(rendered, /current live answer/);
});

test("Bora supports line, page, and transcript-end navigation", () => {
	const current = snapshot({
		activity: Array.from({ length: 100 }, (_, index) => ({ timestamp: 1_000 + index, kind: "activity", text: `activity ${index}` })),
		revision: 2,
	});
	const view = popup(current, 34);
	const position = () => {
		const match = view.render(72).map(stripAnsi).at(-2)?.match(/(\d+)-(\d+)\/(\d+)/);
		assert.ok(match);
		return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
	};

	const initial = position();
	assert.equal(view.handleInput("\u001b[A"), true);
	assert.equal(position().start, initial.start - 1);
	assert.equal(view.handleInput("\u001b[B"), true);
	assert.deepEqual(position(), initial);

	assert.equal(view.handleInput("\u001bp"), true);
	assert.equal(position().start, initial.start - 23);
	assert.equal(view.handleInput("\u001bn"), true);
	assert.deepEqual(position(), initial);

	assert.equal(view.handleInput("\u001bb"), true);
	assert.equal(position().start, 1);
	assert.equal(view.handleInput("\u001bf"), true);
	assert.deepEqual(position(), initial);
});

test("Bora honors a customized task expand binding", () => {
	const view = popup(snapshot({ task: "line one\nline two" }), 30, keybindings({ "app.tools.expand": "ctrl+x" }));
	assert.match(view.render(64).map(stripAnsi).at(-2)!, /ctrl\+x task/);
	assert.equal(view.handleInput("\u000f"), false);
	assert.equal(view.handleInput("\u0018"), true);
	assert.match(view.render(64).map(stripAnsi).join("\n"), /line two/);
});

test("Bora status remains bordered and width bounded", () => {
	const lines = popup(snapshot({ task: "task ".repeat(40) }), 28).render(48);
	assert.equal(lines.length, 28);
	assert.equal(stripAnsi(lines[0]!), `╭${"─".repeat(46)}╮`);
	assert.equal(stripAnsi(lines.at(-1)!), `╰${"─".repeat(46)}╯`);
	assert.ok(lines.every((line) => visibleWidth(line) <= 48));
});
