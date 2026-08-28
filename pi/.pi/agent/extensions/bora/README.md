# Bora

`/bora` delegates repository implementation work to one persistent Luna child session. The child uses the current working directory, loads applicable `AGENTS.md` files, and has only the fixed implementation tools `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`.

## Commands

```text
/bora
/bora <task>
/bora followup <message>
/bora followup
/bora status
/bora abort
/bora config
```

Bare `/bora` delegates the latest non-empty assistant response from the active parent-session branch as the implementation task. The command itself authorizes delegation, so no confirmation is requested. If no suitable assistant response exists, Bora reports an error. An explicit `/bora <task>` always uses the provided task.

The first command creates one child JSONL session under:

```text
~/.pi/agent/bora-sessions/<parent-session-id>/<run-id>/
```

Follow-ups reuse that child session, including after `/reload` or resuming the parent session once the previous child turn has settled. `/bora followup` without a message selects the latest non-empty assistant response, but only after TUI confirmation; use an explicit message in headless modes. Explicit tasks and follow-ups always win.

`/bora status` shows the run, child session path, artifact directory, and bounded latest output. `/bora abort` stops active work without deleting the child JSONL session. `/bora config` reports the resolved configuration path and values.

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
