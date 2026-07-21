import { resolve, sep } from "node:path";
import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BLOCK_REASON = "Blocked rm -rf because the user did not approve the destructive command.";
const NO_UI_BLOCK_REASON = "Blocked rm -rf because no interactive UI was available to request permission.";

const RM_INVOCATION_PATTERN = /(?:^|[\s;&|()])(?:[^\s;&|()]+\/)?rm\s+([^;&|()\n]*)/gi;
const SHELL_EXPANSION_PATTERN = /[$`<>]/;
const GLOB_PATTERN = /[*?[{]/;

function parseShellWords(text: string): string[] | undefined {
	const words: string[] = [];
	let word = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;

	for (const character of text.trim()) {
		if (escaped) {
			word += character;
			escaped = false;
			continue;
		}

		if (character === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}

		if (quote) {
			if (character === quote) quote = undefined;
			else word += character;
			continue;
		}

		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}

		if (/\s/.test(character)) {
			if (word) {
				words.push(word);
				word = "";
			}
			continue;
		}

		word += character;
	}

	if (escaped || quote) return undefined;
	if (word) words.push(word);
	return words;
}

function getRecursiveForcedTargets(argumentsText: string): string[] | undefined {
	const tokens = parseShellWords(argumentsText);
	if (!tokens) return undefined;

	let recursive = false;
	let force = false;
	let optionsEnded = false;
	const targets: string[] = [];

	for (const token of tokens) {
		if (!optionsEnded && token === "--") {
			optionsEnded = true;
			continue;
		}

		if (!optionsEnded && token.startsWith("-")) {
			if (token === "--recursive") recursive = true;
			if (token === "--force") force = true;
			if (/^-[^-]*[rR]/.test(token)) recursive = true;
			if (/^-[^-]*f/.test(token)) force = true;
			continue;
		}

		targets.push(token);
	}

	return recursive && force ? targets : undefined;
}

function isWithinDirectory(path: string, directory: string): boolean {
	return path.startsWith(`${directory}${sep}`);
}

function isAllowedTarget(target: string, cwd: string): boolean {
	if (!target || SHELL_EXPANSION_PATTERN.test(target)) return false;

	const firstGlobIndex = target.search(GLOB_PATTERN);
	const hasGlob = firstGlobIndex !== -1;
	const pathToCheck = hasGlob ? target.slice(0, firstGlobIndex) : target;
	const suffixAfterGlob = hasGlob ? target.slice(firstGlobIndex) : "";

	// A parent traversal after a wildcard can escape after shell expansion.
	if (suffixAfterGlob.split(/[\\/]/).includes("..")) return false;

	const resolvedTarget = resolve(cwd, pathToCheck || ".");
	const resolvedCwd = resolve(cwd);
	const resolvedTmp = resolve("/tmp");

	// Permit children of /tmp and children of the directory where pi started.
	// Deliberately do not permit deleting /tmp, cwd, or `.` themselves.
	return (
		isWithinDirectory(resolvedTarget, resolvedTmp) ||
		isWithinDirectory(resolvedTarget, resolvedCwd) ||
		(hasGlob && (resolvedTarget === resolvedTmp || resolvedTarget === resolvedCwd))
	);
}

function requiresPermission(command: string, cwd: string): boolean {
	RM_INVOCATION_PATTERN.lastIndex = 0;

	for (const match of command.matchAll(RM_INVOCATION_PATTERN)) {
		const targets = getRecursiveForcedTargets(match[1] ?? "");
		if (!targets) continue;
		if (targets.length === 0 || targets.some((target) => !isAllowedTarget(target, cwd))) return true;
	}

	return false;
}

export default function rmRfGuard(pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const { command } = event.input;
		if (typeof command !== "string" || !requiresPermission(command, ctx.cwd)) return;

		if (!ctx.hasUI) {
			return { block: true, reason: NO_UI_BLOCK_REASON };
		}

		const approved = await ctx.ui.confirm(
			"Allow recursive forced deletion?",
			`The model wants to execute:\n\n${command}\n\nThis command uses rm with recursive and force flags.`,
		);

		if (!approved) {
			return { block: true, reason: BLOCK_REASON };
		}
	});
}
