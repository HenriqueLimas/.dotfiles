import assert from "node:assert/strict";
import test from "node:test";
import {
	buildAgentSessionOptions,
	ChildAgentSession,
	classifyTerminalResult,
	DEFAULT_CHILD_RESOURCE_POLICY,
	IMPLEMENTATION_TOOLS,
	READ_ONLY_TOOLS,
} from "./agent-session.ts";

test("team child session options preserve the read-only tool allowlist", () => {
	const options = buildAgentSessionOptions({
		cwd: "/repo",
		modelRuntime: {} as never,
		model: {} as never,
		thinkingLevel: "high",
		tools: READ_ONLY_TOOLS,
		resourceLoader: {} as never,
		sessionManager: {} as never,
	});

	assert.deepEqual(options.tools, ["read", "grep", "find", "ls"]);
	assert.equal(options.cwd, "/repo");
});

test("Bora child session options include the fixed mutation-capable tools", () => {
	const options = buildAgentSessionOptions({
		cwd: "/repo",
		modelRuntime: {} as never,
		model: {} as never,
		thinkingLevel: "high",
		tools: IMPLEMENTATION_TOOLS,
		resourceLoader: {} as never,
		sessionManager: {} as never,
	});

	assert.deepEqual(options.tools, ["read", "bash", "edit", "write", "grep", "find", "ls"]);
});

test("child resource policy keeps context files while disabling executable resources", () => {
	assert.deepEqual(DEFAULT_CHILD_RESOURCE_POLICY, {
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: false,
	});
});

test("child session disposal removes subscriptions and disposes the underlying session", () => {
	const listeners = new Set<(event: never) => void>();
	let disposed = false;
	const session = {
		sessionFile: undefined,
		thinkingLevel: "high",
		messages: [],
		subscribe(listener: (event: never) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose() {
			disposed = true;
		},
	} as never;
	const child = new ChildAgentSession(session, {} as never, "configured/model", "provider/model");
	child.subscribe(() => {});
	assert.equal(listeners.size, 1);
	child.dispose();
	assert.equal(listeners.size, 0);
	assert.equal(disposed, true);
});

test("terminal child results distinguish successful, failed, and aborted stops", () => {
	const message = (stopReason: string, errorMessage?: string) => ({
		role: "assistant",
		content: [{ type: "text", text: "response" }],
		stopReason,
		errorMessage,
	});

	assert.equal(classifyTerminalResult({ messages: [message("stop")] } as never).status, "completed");
	assert.equal(classifyTerminalResult({ messages: [message("error", "quota")] } as never).status, "failed");
	assert.equal(classifyTerminalResult({ messages: [message("aborted")] } as never).status, "aborted");
	assert.equal(classifyTerminalResult({ messages: [] } as never).status, "failed");
});