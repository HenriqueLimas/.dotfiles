# Bora

`/bora` delegates repository implementation work to one persistent Luna child session. The child uses the current working directory, loads applicable `AGENTS.md` files, and has only the fixed implementation tools `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.

## Commands

```text
/bora
/bora <task>
/bora create-handoff
/bora create-handoff <optional focus>
/bora followup <message>
/bora followup
/bora status
/bora abort
/bora config
```

Bare `/bora` delegates the latest non-empty assistant response from the active parent-session branch as the implementation task. The command itself authorizes delegation, so no confirmation is requested. If no suitable assistant response exists, Bora reports an error. An explicit `/bora <task>` always uses the provided task.

## Babysat handoff workflow

Use `/bora create-handoff` or `/bora create-handoff <optional focus>` to ask the current parent agent for an implementation-ready handoff brief. The parent builds the brief from what the conversation already established and inspects the repository read-only only to fill a specific gap, because Luna explores the code itself. The brief asks for acceptance criteria and exact paths, symbols, and validation commands so Luna does not have to search for them. The request prohibits implementation and repository modifications. Review or refine the resulting brief in the parent conversation, then run bare `/bora` yourself when it is ready. Refinements must reproduce the complete revised brief because bare `/bora` delegates only the latest assistant response.

Bare `/bora` is the explicit approval and delegation step. `/bora create-handoff` returns the brief directly without asking whether to delegate it, and it never launches Luna automatically.

## Review loop

When Luna finishes, Bora sends a hidden review prompt to the parent and starts a parent-agent turn. The parent reviews the actual repository state without editing it. To send that review back to Luna, run bare `/bora followup`:

```text
/bora
[parent review]
/bora followup
[parent review]
```

Bora never sends a follow-up automatically. Invoking bare `/bora followup` authorizes sending the latest parent response to Luna without another confirmation. Historical result cards stay compact; use `/bora status` to inspect the child transcript.

## Review evidence

Parent turns carry the whole parent conversation, so each tool call the parent makes during review costs far more than a Luna turn. Bora therefore collects review evidence itself and puts it in the review prompt:

- Before each Luna turn, Bora snapshots the working tree, including untracked non-ignored files, as a git tree object. It uses a temporary index, so the user's index, stash, and files stay untouched. The only side effect is unreferenced git objects, which `git gc` prunes.
- After the turn, Bora diffs that snapshot against a new one. The parent gets `git diff --stat` for changes made during this turn only, so work that already existed in the tree is excluded. The full patch is inlined up to 8000 characters. Above that the parent gets only the stat and reads the files it needs.
- Luna ends every turn with a fixed report: `Changed files`, `Validation`, `Deviations from the handoff`, and `Risks and open questions`. Bora checks each backticked command in `Validation` against the child's bash calls. It reports each command as passed, failed with an output tail, stale when `edit` or `write` ran afterwards, or not found in the transcript. It also counts failed bash calls Luna did not report.

The review prompt tells the parent to start from this evidence and not rerun validation that passed and is not stale. The evidence has limits. Staleness only notices `edit` and `write` calls, not files changed by bash commands. Changes made by other processes during the turn appear in the diff. Outside a git repository, or when git fails, Bora says the evidence is unavailable and the parent inspects the repository directly.

The first command creates one child JSONL session under:

```text
~/.pi/agent/bora-sessions/<parent-session-id>/<run-id>/
```

Follow-ups reuse that child session, including after `/reload` or resuming the parent session once the previous child turn has settled. `/bora followup` without a message selects the latest non-empty assistant response in both interactive and headless modes. An explicit follow-up message always wins.

`/bora status` opens a near-fullscreen live view. The task stays above the child transcript and starts on one line; use the configured expand binding (Ctrl+O by default) to toggle more of it without letting it take over the popup. Use Up/Down to scroll one transcript line, Option+Up/Option+Down or Page Up/Page Down to jump by a full visible page, and Option+Left/Option+Right to jump to the beginning or end.

The popup renders the durable child-session transcript rather than a capped activity buffer. Prompts, assistant text, exposed thinking blocks, tool calls, tool results, retries, errors, completed responses, and the current streaming message remain inspectable after completion and after restoring the parent session. Providers may keep private reasoning hidden; the popup can only show thinking content delivered to pi. `/bora abort` stops active work without deleting the child JSONL session. `/bora config` reports the resolved configuration path and values.

## Configuration

Edit `~/.pi/agent/bora.json`:

```json
{
  "model": "openai-codex/gpt-5.6-luna",
  "thinkingLevel": "high",
  "maxResultChars": 30000
}
```

All keys are optional. The defaults are Luna, the model's default thinking level, and `30000` result characters. Unknown keys and invalid values are rejected. Configuration is read for each new run; a follow-up keeps the model, thinking level, and result limit captured by its existing run.

Bora loads global and trusted-project skills along with global and repository context files. Skills remain progressively disclosed: the child sees their names and descriptions, then reads the matching `SKILL.md` when needed. Extensions, prompt templates, and themes remain disabled, so the child cannot invoke parent extension commands.
