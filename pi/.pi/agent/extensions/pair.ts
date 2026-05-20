import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { homedir } from "node:os";

const PAIR_ENTRY_TYPE = "pair-mode";
const WIDGET_KEY = "pair-mode";

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

Your operating model: you drive the implementation, I navigate and review. Optimize for transparency, small safe changes, verifiable behavior, and easy human review. When in doubt, pause and ask.
`;

const ALERT_SOUND = join(homedir(), ".pi/agent/sounds/metal-gear-codec.mp3");

function buildWidget(notify = false): string[] {
  return [notify ? `👯‍♂️ 🔔 Pair mode` : `👯‍♂️  Pair mode`];
}

export default function pairExtension(pi: ExtensionAPI) {
  let enabled = false;
  let description = "";

  function enable(desc: string, ctx: { ui: { setWidget: Function } }) {
    enabled = true;
    description = desc;
    ctx.ui.setWidget(WIDGET_KEY, buildWidget());
  }

  function disable(ctx: { ui: { setWidget: Function } }) {
    enabled = false;
    description = "";
    ctx.ui.setWidget(WIDGET_KEY, []);
  }

  // Restore state on session start
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    const entries = ctx.sessionManager.getEntries();
    // Find the last pair-mode entry
    const pairEntries = entries.filter(
      (e) => e.type === "custom" && (e as any).customType === PAIR_ENTRY_TYPE
    );

    if (pairEntries.length > 0) {
      const last = pairEntries[pairEntries.length - 1] as any;
      if (last.data?.enabled && last.data?.description) {
        enable(last.data.description, ctx);
      }
    }
  });

  // Play Metal Gear alert sound and show notification bell when agent finishes
  pi.on("agent_end", async (_event, ctx) => {
    if (!enabled || !ctx.hasUI) return;
    pi.exec("afplay", [ALERT_SOUND]).catch(() => {});
    ctx.ui.setWidget(WIDGET_KEY, buildWidget(true));
  });

  // Clear notification bell when user sends a message
  pi.on("input", async (_event, ctx) => {
    if (!enabled || !ctx.hasUI) return;
    ctx.ui.setWidget(WIDGET_KEY, buildWidget(false));
  });

  // Inject system prompt when pair mode is active
  pi.on("before_agent_start", (event, _ctx) => {
    if (!enabled) return;

    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n--- Pair Programming Session ---\nWhat we are working on: ${description}` +
        PAIR_SYSTEM_PROMPT,
    };
  });

  pi.registerCommand("pair", {
    description: 'Toggle pair mode. /pair [description] to start, /pair off to stop',
    handler: async (args, ctx) => {
      const input = args.trim();

      if (input === "off") {
        if (!enabled) {
          ctx.ui.notify("Pair mode is not active.", "info");
          return;
        }
        disable(ctx);
        pi.appendEntry(PAIR_ENTRY_TYPE, { enabled: false, description: "" });
        ctx.ui.notify("Pair mode off.", "info");
        return;
      }

      if (enabled) {
        ctx.ui.notify(`Pair mode is already on — ${description}`, "info");
        return;
      }

      const desc = input || "pair programming session";
      enable(desc, ctx);
      pi.appendEntry(PAIR_ENTRY_TYPE, { enabled: true, description: desc });
      if (input) {
        pi.sendUserMessage(`We just started a pair programming session. We are working on: ${desc}. Acknowledge this and let's get started.`);
      } else {
        pi.sendUserMessage(`We just started a pair programming session. Greet me briefly as my pair programming partner and ask what we're working on today.`);
      }
    },
  });
}
