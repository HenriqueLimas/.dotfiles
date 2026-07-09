import { isToolCallEventType, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { homedir } from "node:os";

const PAIR_ENTRY_TYPE = "pair-mode";
const WIDGET_KEY = "pair-mode";
const PAIR_STATE_VERSION = 1;

const PAIR_SYSTEM_PROMPT = `
## Pair Programming Mode

Act as a disciplined pair-programming driver. I am the navigator and reviewer — you implement, I steer.

Follow these principles:

1. Start by clarifying the task.
   - Restate the goal in your own words.
   - Identify assumptions, missing context, risks, and acceptance criteria.
   - Ask me about anything genuinely ambiguous before proceeding. Do not silently assume your way past important unknowns.

2. Work in small, reviewable steps.
   - Break the task into tiny increments.
   - Before any significant change, explain your intended approach and the files you plan to touch.
   - After each step, summarize what changed and why, and wait for my feedback before continuing.
   - Avoid large opaque rewrites unless I explicitly ask for one.

3. Make changes transparently.
   - Prefer minimal, focused diffs.
   - Preserve existing behavior unless the task requires changing it.
   - Call out any risky, uncertain, or irreversible changes before making them.
   - Present decisions and tradeoffs clearly so I can redirect.

4. Use test-aware development.
   - Identify relevant existing tests before changing code.
   - Add or update tests when appropriate.
   - Prefer red-green-refactor when practical: define expected behavior first, then implement, then clean up.
   - Always report which tests were run and what remains untested.

5. Continuously self-review.
   - Check your own changes for correctness, readability, edge cases, error handling, security, and performance before presenting them.
   - Flag overengineering, duplication, and scope creep.

6. Communicate like a good driver.
   - Keep explanations concise but complete.
   - Surface blockers and uncertainty early. Never pretend to know something you don't.
   - If my instruction conflicts with correctness or project constraints, say so and propose a safer alternative — then let me decide.

7. Never perform git operations without my explicit instruction.
   - Do not stage, commit, push, or create pull requests unless I specifically ask you to.
   - This includes partial commits, amends, and stashes.
   - When the work is ready to ship, tell me what you'd commit and wait for my go-ahead.

8. Avoid common agent-driver mistakes.
   - Do not make broad unrelated changes.
   - Do not silently refactor areas outside the task scope.
   - Do not claim tests passed unless they were actually run.
   - Do not invent APIs, files, conventions, or requirements.
   - Stop and ask when evidence shows the current approach is wrong.

9. Close each step with a clear summary.
   - What changed and why.
   - Tests run and their results.
   - Known risks, open questions, or follow-ups.
   - What comes next — and whether you need my input before proceeding.

10. Pair-mode approval gate.
   - Pair mode enforces explicit approval for edit, write, and mutating bash tool calls.
   - Before attempting those tools, explain the intended change and why it is needed.
   - If a tool call is blocked, stop, describe what was blocked, and ask me how to proceed.

Your operating model: you drive the implementation, I navigate and review. Optimize for transparency, small safe changes, verifiable behavior, and easy human review. When in doubt, pause and ask.
`;

const ALERT_SOUND = join(homedir(), ".pi/agent/sounds/metal-gear-codec.mp3");

const MUTATING_BASH_PATTERNS: RegExp[] = [
  /(?:^|[;&|]\s*)(rm|mv|cp|mkdir|touch|chmod|chown|ln)\b/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|checkout|switch|reset|restore|stash|clean|apply|am|tag)\b/i,
  /\b(npm|pnpm|yarn|bun)\s+(install|i|add|remove|rm|uninstall|update|upgrade|dedupe|link|unlink)\b/i,
  /\b(pip|pip3)\s+install\b/i,
  /\bpython\s+-m\s+pip\s+install\b/i,
  /\bcargo\s+(add|remove|install|update|publish)\b/i,
  /\bgo\s+(get|install)\b/i,
  /\bsed\s+.*\s-i(?:\s|$)/i,
  /\bperl\s+.*\s-pi(?:\s|$)/i,
  /(?:^|[;&|]\s*)tee\b/i,
  /(^|[^<])>>?\s*[^\s&|;]/,
];

interface PairState {
  enabled: boolean;
  description: string;
  version?: number;
}

type PairCustomEntry = {
  type: "custom";
  customType?: string;
  data?: Partial<PairState>;
};

function buildWidget(notify = false, description?: string): string[] {
  const suffix = description ? ` — ${description}` : "";
  return [notify ? `👯‍♂️ 🔔 Pair mode${suffix}` : `👯‍♂️  Pair mode${suffix}`];
}

function isPairCustomEntry(entry: unknown): entry is PairCustomEntry {
  return (
    typeof entry === "object" &&
    entry !== null &&
    (entry as { type?: unknown }).type === "custom" &&
    (entry as { customType?: unknown }).customType === PAIR_ENTRY_TYPE
  );
}

function isMutatingBashCommand(command: string): boolean {
  return MUTATING_BASH_PATTERNS.some((pattern) => pattern.test(command));
}

function describeToolCall(event: { toolName: string; input: Record<string, unknown> }): string {
  if (event.toolName === "edit") {
    const path = typeof event.input.path === "string" ? event.input.path : "unknown path";
    const edits = Array.isArray(event.input.edits) ? event.input.edits.length : undefined;
    return edits === undefined ? `edit ${path}` : `edit ${path} (${edits} replacement${edits === 1 ? "" : "s"})`;
  }

  if (event.toolName === "write") {
    const path = typeof event.input.path === "string" ? event.input.path : "unknown path";
    return `write ${path}`;
  }

  if (event.toolName === "bash") {
    const command = typeof event.input.command === "string" ? event.input.command : "unknown command";
    return `run mutating bash command:\n\n${command}`;
  }

  return event.toolName;
}

export default function pairExtension(pi: ExtensionAPI) {
  let enabled = false;
  let description = "";

  function renderWidget(ctx: ExtensionContext, notify = false): void {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget(WIDGET_KEY, enabled ? buildWidget(notify, description) : undefined);
  }

  function persistState(): void {
    pi.appendEntry(PAIR_ENTRY_TYPE, {
      version: PAIR_STATE_VERSION,
      enabled,
      description,
    });
  }

  function setState(nextState: PairState, ctx: ExtensionContext, options: { persist?: boolean; notify?: boolean } = {}): void {
    enabled = nextState.enabled;
    description = nextState.enabled ? nextState.description || "pair programming session" : "";
    renderWidget(ctx, options.notify ?? false);

    if (options.persist) {
      persistState();
    }
  }

  function restoreStateFromCurrentBranch(ctx: ExtensionContext): void {
    const pairEntries = ctx.sessionManager.getBranch().filter(isPairCustomEntry);
    const last = pairEntries.at(-1);

    setState(
      {
        enabled: last?.data?.enabled === true,
        description: last?.data?.description || "",
        version: last?.data?.version,
      },
      ctx,
    );
  }

  async function confirmMutation(event: { toolName: string; input: Record<string, unknown> }, ctx: ExtensionContext) {
    const action = describeToolCall(event);
    const reason = `Pair mode blocked ${action}. Pair mode requires explicit approval before edit, write, or mutating bash tool calls.`;

    if (!ctx.hasUI) {
      return { block: true as const, reason };
    }

    const allowed = await ctx.ui.confirm(
      "Pair mode approval required",
      `Allow the agent to ${action}?\n\nOnly approve this if the agent already explained the intended change and it matches what you want.`,
    );

    if (!allowed) {
      return { block: true as const, reason };
    }

    return undefined;
  }

  function sendPairKickoff(message: string, ctx: ExtensionContext): void {
    if (ctx.isIdle()) {
      pi.sendUserMessage(message);
      return;
    }

    pi.sendUserMessage(message, { deliverAs: "followUp" });
  }

  // Restore state on session start/resume/reload from the active branch only.
  pi.on("session_start", (_event, ctx) => {
    restoreStateFromCurrentBranch(ctx);
  });

  // /tree changes the active branch without creating a new session, so recompute state.
  pi.on("session_tree", (_event, ctx) => {
    restoreStateFromCurrentBranch(ctx);
  });

  // After compaction, write a fresh state marker so pair state remains explicit after the compaction point.
  pi.on("session_compact", () => {
    if (enabled) {
      persistState();
    }
  });

  // Hard guard: pair mode requires approval before write/edit/mutating bash tools execute.
  pi.on("tool_call", async (event, ctx) => {
    if (!enabled) return undefined;

    if (event.toolName === "edit" || event.toolName === "write") {
      return confirmMutation(event as { toolName: string; input: Record<string, unknown> }, ctx);
    }

    if (isToolCallEventType("bash", event) && isMutatingBashCommand(event.input.command)) {
      return confirmMutation(event as { toolName: string; input: Record<string, unknown> }, ctx);
    }

    return undefined;
  });

  // Play Metal Gear alert sound and show notification bell when agent finishes.
  pi.on("agent_end", async (_event, ctx) => {
    if (!enabled || !ctx.hasUI) return;

    if (ctx.mode === "tui" && process.platform === "darwin") {
      pi.exec("afplay", [ALERT_SOUND]).catch(() => {});
    }

    renderWidget(ctx, true);
  });

  // Clear notification bell when the human sends a message.
  pi.on("input", async (event, ctx) => {
    if (!enabled || !ctx.hasUI || event.source === "extension") return;
    renderWidget(ctx, false);
  });

  // Inject system prompt when pair mode is active.
  pi.on("before_agent_start", (event) => {
    if (!enabled) return;

    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n--- Pair Programming Session ---\nWhat we are working on: ${description}` +
        PAIR_SYSTEM_PROMPT,
    };
  });

  pi.registerCommand("pair", {
    description: "Toggle pair mode. /pair [description] to start/update, /pair off to stop",
    handler: async (args, ctx) => {
      const input = args.trim();

      if (input.toLowerCase() === "off") {
        if (!enabled) {
          ctx.ui.notify("Pair mode is not active.", "info");
          return;
        }

        setState({ enabled: false, description: "" }, ctx, { persist: true });
        ctx.ui.notify("Pair mode off.", "info");
        return;
      }

      if (enabled) {
        if (!input) {
          ctx.ui.notify(`Pair mode is on — ${description}`, "info");
          return;
        }

        setState({ enabled: true, description: input }, ctx, { persist: true });
        ctx.ui.notify(`Pair mode updated — ${input}`, "info");
        return;
      }

      const desc = input || "pair programming session";
      setState({ enabled: true, description: desc }, ctx, { persist: true });

      if (input) {
        sendPairKickoff(
          `We just started a pair programming session. We are working on: ${desc}. Acknowledge this and let's get started.`,
          ctx,
        );
      } else {
        sendPairKickoff(
          "We just started a pair programming session. Greet me briefly as my pair programming partner and ask what we're working on today.",
          ctx,
        );
      }
    },
  });
}
