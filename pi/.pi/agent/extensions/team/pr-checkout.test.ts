import assert from "node:assert/strict";
import test from "node:test";
import { preparePullRequestCheckout, type CaptureCommand } from "./pr-checkout.ts";

const head = "abcdef1234567890";

test("numbered PR checkout runs gh in an isolated clone at the PR head", async () => {
	const sourceOrigin = "https://github.com/eBay/evo-web.git";
	const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
	const captureCommand: CaptureCommand = async (command, args, cwd) => {
		calls.push({ command, args, cwd });
		if (command === "git" && args[0] === "remote" && args[1] === "get-url") return sourceOrigin;
		return command === "git" && args[0] === "rev-parse" ? head : "";
	};

	const checkoutPath = await preparePullRequestCheckout({
		target: "123",
		headRefOid: head,
		preparationDir: "/tmp/team-run",
		sourceCwd: "/workspace/current",
		captureCommand,
		removeCheckout: async () => {},
	});

	assert.equal(checkoutPath, "/tmp/team-run/pr-head");
	assert.deepEqual(calls, [
		{
			command: "git",
			args: ["remote", "get-url", "origin"],
			cwd: "/workspace/current",
		},
		{
			command: "git",
			args: ["clone", "--no-local", "--no-checkout", "/workspace/current", "/tmp/team-run/pr-head"],
			cwd: "/workspace/current",
		},
		{
			command: "git",
			args: ["remote", "set-url", "origin", sourceOrigin],
			cwd: "/tmp/team-run/pr-head",
		},
		{
			command: "gh",
			args: ["pr", "checkout", "123", "--detach"],
			cwd: "/tmp/team-run/pr-head",
		},
		{
			command: "git",
			args: ["rev-parse", "HEAD"],
			cwd: "/tmp/team-run/pr-head",
		},
	]);
});

test("PR checkout failure cleans up and never falls back to the source checkout", async () => {
	const sourceOrigin = "https://github.com/eBay/evo-web.git";
	const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
	let removed: string | undefined;
	const captureCommand: CaptureCommand = async (command, args, cwd) => {
		calls.push({ command, args, cwd });
		if (command === "git" && args[0] === "remote" && args[1] === "get-url") return sourceOrigin;
		if (command === "gh") throw new Error("network unavailable");
		return "";
	};

	await assert.rejects(
		preparePullRequestCheckout({
			target: "123",
			headRefOid: head,
			preparationDir: "/tmp/team-run",
			sourceCwd: "/workspace/current",
			captureCommand,
			removeCheckout: async (path) => {
				removed = path;
			},
		}),
		/Cannot prepare isolated checkout.*network unavailable/,
	);
	assert.equal(removed, "/tmp/team-run/pr-head");
	assert.deepEqual(calls, [
		{
			command: "git",
			args: ["remote", "get-url", "origin"],
			cwd: "/workspace/current",
		},
		{
			command: "git",
			args: ["clone", "--no-local", "--no-checkout", "/workspace/current", "/tmp/team-run/pr-head"],
			cwd: "/workspace/current",
		},
		{
			command: "git",
			args: ["remote", "set-url", "origin", sourceOrigin],
			cwd: "/tmp/team-run/pr-head",
		},
		{
			command: "gh",
			args: ["pr", "checkout", "123", "--detach"],
			cwd: "/tmp/team-run/pr-head",
		},
	]);
	assert.equal(calls.some(({ command, args, cwd }) => command === "git" && args[0] === "remote" && args[1] === "set-url" && cwd === "/workspace/current"), false);
	assert.equal(calls.some(({ command, cwd }) => command === "gh" && cwd === "/workspace/current"), false);
});
