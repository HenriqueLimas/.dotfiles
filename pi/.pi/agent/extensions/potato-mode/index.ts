import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATE_ENTRY_TYPE = "potato-mode-state";
const STATUS_KEY = "potato-mode";
const STATE_VERSION = 2;
const SKILLS_DIR = fileURLToPath(new URL("./skills", import.meta.url));
const POTATO_MODE_SKILL_PATH = fileURLToPath(new URL("./skills/potato-mode/SKILL.md", import.meta.url));

interface PotatoState {
	version: number;
	enabled: boolean;
	focus: string;
}

type PotatoStateEntry = {
	type: "custom";
	customType?: string;
	data?: Partial<PotatoState>;
};

const POTATO_MODE_HOOK = `
## Potato Mode active

Before substantive work, read ${POTATO_MODE_SKILL_PATH} in full and follow its semantic playbook routing, principle leaf skills, Pi-native delegation rules, authority boundaries, and reply contract. Do not replace that skill with remembered or improvised Potato Mode rules.
`;

function isStateEntry(entry: unknown): entry is PotatoStateEntry {
	return (
		typeof entry === "object" &&
		entry !== null &&
		(entry as { type?: unknown }).type === "custom" &&
		(entry as { customType?: unknown }).customType === STATE_ENTRY_TYPE
	);
}

export function isDisableRequest(text: string): boolean {
	return /^\s*(?:(?:please|can you|could you|would you)\s+)?(?:disable|stop|exit|turn off)\s+potato(?:[- ]mode)?(?:\s+please)?\s*[.!?]?\s*$/i.test(
		text,
	);
}

function stateFromBranch(ctx: ExtensionContext): PotatoState {
	const last = ctx.sessionManager.getBranch().filter(isStateEntry).at(-1);
	return {
		version: STATE_VERSION,
		enabled: last?.data?.enabled === true,
		focus: typeof last?.data?.focus === "string" ? last.data.focus : "",
	};
}

export default function potatoMode(pi: ExtensionAPI): void {
	let state: PotatoState = {
		version: STATE_VERSION,
		enabled: false,
		focus: "",
	};

	function persistState(): void {
		pi.appendEntry(STATE_ENTRY_TYPE, { ...state });
	}

	function renderStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		if (!state.enabled) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}

		const agentStatus = pi.getActiveTools().includes("subagent") ? "subagents" : "local";
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", `🥔 active · ${agentStatus}`));
	}

	function setState(next: Partial<PotatoState>, ctx: ExtensionContext, persist = true): void {
		state = { ...state, ...next, version: STATE_VERSION };
		renderStatus(ctx);
		if (persist) persistState();
	}

	function sendUserMessage(message: string, ctx: ExtensionContext): void {
		if (ctx.isIdle()) {
			pi.sendUserMessage(message);
		} else {
			pi.sendUserMessage(message, { deliverAs: "followUp" });
		}
	}

	pi.on("resources_discover", () => ({ skillPaths: [SKILLS_DIR] }));

	pi.on("session_start", (_event, ctx) => {
		state = stateFromBranch(ctx);
		renderStatus(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		state = stateFromBranch(ctx);
		renderStatus(ctx);
	});

	pi.on("session_compact", () => {
		if (state.enabled) persistState();
	});

	pi.on("input", (event, ctx) => {
		if (!state.enabled || event.source === "extension" || !isDisableRequest(event.text)) return;

		setState({ enabled: false, focus: "" }, ctx);
		ctx.ui.notify("Potato Mode off.", "info");
		return { action: "handled" as const };
	});

	pi.on("before_agent_start", (event) => {
		if (!state.enabled) return;
		const focus = state.focus ? `\nCurrent focus: ${state.focus}\n` : "";
		const availability = pi.getActiveTools().includes("subagent")
			? "The pi-subagents tool is active in this session."
			: "The pi-subagents tool is not active. Continue locally and do not invent subagent calls.";

		return {
			systemPrompt: event.systemPrompt + POTATO_MODE_HOOK + focus + `\nRuntime: ${availability}\n`,
		};
	});

	pi.registerCommand("potato-mode", {
		description: "Enable rigorous sticky Potato Mode. Usage: /potato-mode [task|on|off|status]",
		handler: async (args, ctx) => {
			const input = args.trim();
			const command = input.toLowerCase();

			if (command === "off") {
				if (!state.enabled) {
					ctx.ui.notify("Potato Mode is already off.", "info");
					return;
				}
				setState({ enabled: false, focus: "" }, ctx);
				ctx.ui.notify("Potato Mode off.", "info");
				return;
			}

			if (command === "status") {
				const agentStatus = pi.getActiveTools().includes("subagent") ? "subagents ready" : "local only";
				const focus = state.focus ? `\nFocus: ${state.focus}` : "";
				ctx.ui.notify(`Potato Mode: ${state.enabled ? `active · ${agentStatus}` : "off"}${focus}`, "info");
				return;
			}

			if (!input || command === "on") {
				if (state.enabled) {
					ctx.ui.notify("Potato Mode is on.", "info");
					return;
				}
				setState({ enabled: true, focus: "" }, ctx);
				ctx.ui.notify("Potato Mode on. Submit a task or run /potato-mode <task>.", "info");
				return;
			}

			setState({ enabled: true, focus: input }, ctx);
			sendUserMessage(`Potato Mode task:\n${input}`, ctx);
		},
	});
}
