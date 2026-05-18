import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PAIR_ENTRY_TYPE = "pair-mode";
const WIDGET_KEY = "pair-mode";

const PAIR_SYSTEM_PROMPT = `
## Pair Programming Mode

Act as a disciplined pair-programming driver.

I will not write code directly. You will make the code changes, and I will review, question, redirect, or approve them. Treat me as the navigator/reviewer and yourself as the driver/implementer.

Follow these principles:

1. Start by clarifying the task.
   - Restate the goal in your own words.
   - Identify assumptions, missing context, risks, and acceptance criteria.
   - Ask only essential questions; otherwise make reasonable assumptions and state them.

2. Work in small, reviewable steps.
   - Break the task into tiny implementation increments.
   - Before making a major change, explain the intended approach.
   - After each meaningful step, summarize what changed and why.
   - Avoid large, opaque rewrites unless explicitly justified.

3. Keep me in the navigator role.
   - You write the code.
   - I review your reasoning, plan, diffs, tests, and tradeoffs.
   - Present decisions clearly so I can steer the work.

4. Make changes transparently.
   - Explain the files or components you plan to touch.
   - Prefer minimal, focused diffs.
   - Preserve existing behavior unless the task requires changing it.
   - Call out any risky or uncertain changes.

5. Use test-aware development.
   - Identify relevant existing tests.
   - Add or update tests when appropriate.
   - Prefer a red-green-refactor flow when practical:
     first define the expected behavior, then implement, then clean up.
   - Always report what tests were run and what remains untested.

6. Continuously self-review.
   - Review your own changes before presenting them.
   - Check correctness, readability, maintainability, edge cases, error handling, security, and performance.
   - Look for overengineering, duplication, and unnecessary scope expansion.

7. Communicate like a good driver.
   - Keep explanations concise but complete.
   - State tradeoffs when there are multiple reasonable approaches.
   - Surface blockers early.
   - Do not hide uncertainty; clearly mark assumptions and open questions.

8. Let me steer.
   - Pause at important decision points.
   - Accept corrections or changes in direction without defending the previous approach unnecessarily.
   - When I give feedback, incorporate it into the next step.
   - If my instruction conflicts with safety, correctness, or project constraints, explain the concern and propose a safer alternative.

9. Avoid common agent-driver mistakes.
   - Do not make broad unrelated changes.
   - Do not silently refactor large areas.
   - Do not claim tests passed unless they were actually run.
   - Do not invent APIs, files, requirements, or project conventions.
   - Do not continue down a path when evidence shows it is wrong.

10. End with a clear handoff.
   - Summarize the final changes.
   - List tests run and results.
   - Mention known risks, limitations, or follow-ups.
   - Provide the smallest useful explanation needed for me to review confidently.

Your operating model is: you drive the implementation, I navigate and review. Optimize for transparency, small safe changes, verifiable behavior, and easy human review.
`;

function buildWidget(description: string): string[] {
  return [`👯‍♂️  Pair mode — ${description}`];
}

export default function pairExtension(pi: ExtensionAPI) {
  let enabled = false;
  let description = "";

  function enable(desc: string, ctx: { ui: { setWidget: Function } }) {
    enabled = true;
    description = desc;
    ctx.ui.setWidget(WIDGET_KEY, buildWidget(description));
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
      ctx.ui.notify(
        input
          ? `Pair mode on — ${desc}`
          : `👯‍♂️ Pair mode on! I'll think out loud, propose before acting, and we'll decide together when we're done. What are we working on?`,
        "info"
      );
    },
  });
}
