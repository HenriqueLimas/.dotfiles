# Team extension

`/team` runs a panel of pi agents. Each panelist uses its own model and persistent session. Panels can answer independently or use bounded roundtable rounds where members critique their peers before the parent session synthesizes their final positions. PR reviews use a separate roster when `reviewModels` is configured. Every reviewer in that roster works independently, and the parent agent merges their findings into the final review.

## Commands

```text
/team brainstorm "Should we replace the job queue?"
/team brainstorm --independent "List options without peer critique"
/team review uncommitted
/team review --roundtable uncommitted
/team review pr 123
/team review commit HEAD~1
/team review plan "Use an outbox table and a polling worker"
/team followup all "How would your recommendation change at 10x traffic?"
/team followup architect "Sketch the module boundaries"
/team status
/team abort
/team config
```

`/team status` opens a near-fullscreen live overlay. The initial input stays above a single horizontal agent tab row. Use Left/Right to switch tabs, Up/Down to scroll the selected transcript one line, Option+Up/Option+Down or Page Up/Page Down to jump by a full visible page, Option+Left/Option+Right to jump to the beginning or end, Ctrl+O to expand or collapse the input, and Escape to close. The latest working agent is selected and placed first when the overlay opens. `▶` marks the agent producing the latest activity, while `●`, `…`, `✓`, and `×` distinguish working, queued, completed, and failed agents.

Each tab renders the durable child-session transcript rather than a separate summary buffer. Previous rounds, prompts, assistant text, exposed thinking blocks, tool calls, tool results, retries, errors, and the current streaming message remain inspectable after completion and after restoring the parent session. Providers may keep private reasoning hidden; the overlay can only show thinking content delivered to pi. The collaboration row describes the real coordinator flow. Roundtable peer responses are broadcast to all successful participants between rounds, so completion order is nondeterministic rather than a sequential handoff.

While agents are queued or running, an animated widget stays below the editor and the footer reports active, queued, and completed worker counts.

For `review plan` with no argument, the extension reviews the latest assistant response in the parent session. A path may also be supplied as the plan text; panelists can read it from the project.

## Configuration

Edit `~/.pi/agent/team.json` and run another `/team` command. The extension reads this file for each new panel run.

```json
{
  "models": [
    {
      "name": "architect",
      "model": "openai-codex/gpt-5.6-sol",
      "thinkingLevel": "high",
      "perspective": "Focus on architecture and compatibility."
    }
  ],
  "reviewModels": [
    {
      "name": "ownership",
      "model": "openai-codex/gpt-5.6-sol",
      "thinkingLevel": "high",
      "perspective": "Decide whether the change belongs in this part of the codebase and is maintainable."
    }
  ],
  "maxConcurrency": 3,
  "maxResultChars": 30000,
  "collaboration": {
    "brainstorm": {
      "mode": "roundtable",
      "rounds": 2,
      "maxTranscriptChars": 30000
    },
    "review": {
      "mode": "independent",
      "rounds": 1,
      "maxTranscriptChars": 30000
    }
  }
}
```

Model references use pi's `provider/model` syntax and may include a thinking suffix. Each member name must be unique. `reviewModels` uses the same member object shape as `models`, and every entry runs on every review; the file is the only source of truth for the review roster. The default roster follows the three approvals in [Software Engineering at Google, chapter 9](https://abseil.io/resources/swe-book/html/ch09.html): `correctness` (correctness and comprehension), `ownership` (the change fits and can be maintained in this part of the codebase), and `readability` (language idioms and consistency). The parent always synthesizes the reviewer responses. If `reviewModels` is omitted, reviews retain the legacy `models` roster.

Every review model also receives guidance drawn from the chapter's [Code Review Best Practices](https://abseil.io/resources/swe-book/html/ch09.html#code-review-best-practices). Reviewers keep feedback professional, ask about unclear choices before assuming a mistake, defer to sound author preferences, check that a change and its description are focused and understandable, and use automated checks for mechanical issues. They report a concrete cost when scope or size makes a change hard to review; there is no fixed line limit. The parent applies the same standard when it consolidates findings.

After every panel round, the extension sends the raw responses to the parent agent and starts a synthesis turn. PR review uses a dedicated parent prompt that validates findings against the PR-head checkout, merges duplicates, resolves disagreements, filters severity and confidence, and returns the final review. Raw responses remain inspectable, but they are never delivered as the final review. The parent explicitly loads the global `unslop` skill and applies it while preserving the panel's technical meaning.

Collaboration is configured separately for `brainstorm` and `review`; either entry defaults to `independent` when omitted. A leading `--roundtable` or `--independent` command option overrides that command's configured default. Switching an independent command to roundtable uses two rounds and retains its configured transcript limit.

For `roundtable` mode, `rounds` is the total number of child turns per successful member, including the independent opening round. Later rounds run in parallel; each member receives the bounded responses of the other successful members and revises its position. Members that fail a round are excluded from later rounds rather than retried automatically. `rounds` may be 2–4 and `maxTranscriptChars` may be 3000–100000.

The previous single collaboration object remains valid and applies the same policy to both commands.

Manual `/team followup` commands remain a single targeted round. They do not recursively start another roundtable. A three-member, two-round panel makes six child model turns before parent synthesis, so increasing the round count directly increases cost and latency.

## Isolation and persistence

Child agents load project context files such as `AGENTS.md`, but they do not load extensions, skills, or prompt templates. Their only tools are `read`, `grep`, `find`, and `ls`. They cannot invoke a nested team, run shell commands, or edit files. The single-child runtime setup is shared with `/bora`, while `/team` retains its panel scheduling and collaboration orchestration.

Review commands capture a stable patch or plan under `~/.pi/agent/team-sessions/` before dispatching the panel. For PRs, the extension clones the repository into an isolated directory, checks out the PR head in detached mode, verifies its commit, and runs child reviewers from that directory. It never switches the user's checkout. The isolated clone remains until parent synthesis settles, then is removed. Restored interrupted runs remove stale clones before accepting another command. Child session JSONL files live in the team session directory too. The parent session stores references to those files, which allows follow-ups after `/reload` or after resuming the parent session.

The extension keeps only the latest team run active in a parent session. Starting a new run disposes the previous in-memory child sessions but leaves their JSONL files on disk.

## Collaboration limits

Roundtable communication is coordinator-mediated and asynchronous: panelists receive peer responses after the previous round settles. Models do not exchange tokens directly or run an unrestricted shared chat. This preserves deterministic round limits, concurrency control, cancellation, and read-only isolation.
