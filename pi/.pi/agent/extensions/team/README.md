# Team extension

`/team` runs a panel of pi agents. Each panelist uses its own model and persistent session. Panels can answer independently or use bounded roundtable rounds where members critique their peers before the parent session synthesizes their final positions.

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

`/team status` opens a live overlay. Use up/down to select a panelist, Ctrl+U/Ctrl+D to scroll its logs by eight lines, Page Up/Page Down as alternatives, and Escape to close it. While agents are queued or running, an animated widget stays below the editor and the footer reports active, queued, and completed worker counts.

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
  "maxConcurrency": 3,
  "autoSynthesize": true,
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

Model references use pi's `provider/model` syntax and may include a thinking suffix. Each member name must be unique.

When `autoSynthesize` is true, the extension sends the collected responses to the parent agent and starts a synthesis turn. The moderator explicitly loads the global `unslop` skill and applies it to the final synthesis while preserving the panel's technical meaning. Set `autoSynthesize` to false to keep the panel output in the transcript without triggering the parent model.

Collaboration is configured separately for `brainstorm` and `review`; either entry defaults to `independent` when omitted. A leading `--roundtable` or `--independent` command option overrides that command's configured default. Switching an independent command to roundtable uses two rounds and retains its configured transcript limit.

For `roundtable` mode, `rounds` is the total number of child turns per successful member, including the independent opening round. Later rounds run in parallel; each member receives the bounded responses of the other successful members and revises its position. Members that fail a round are excluded from later rounds rather than retried automatically. `rounds` may be 2–4 and `maxTranscriptChars` may be 3000–100000.

The previous single collaboration object remains valid and applies the same policy to both commands.

Manual `/team followup` commands remain a single targeted round. They do not recursively start another roundtable. A three-member, two-round panel makes six child model turns before optional parent synthesis, so increasing the round count directly increases cost and latency.

## Isolation and persistence

Child agents load project context files such as `AGENTS.md`, but they do not load extensions, skills, or prompt templates. Their only tools are `read`, `grep`, `find`, and `ls`. They cannot invoke a nested team, run shell commands, or edit files.

Review commands capture a stable patch or plan under `~/.pi/agent/team-sessions/` before dispatching the panel. Child session JSONL files live there too. The parent session stores references to those files, which allows follow-ups after `/reload` or after resuming the parent session.

The extension keeps only the latest team run active in a parent session. Starting a new run disposes the previous in-memory child sessions but leaves their JSONL files on disk.

## Collaboration limits

Roundtable communication is coordinator-mediated and asynchronous: panelists receive peer responses after the previous round settles. Models do not exchange tokens directly or run an unrestricted shared chat. This preserves deterministic round limits, concurrency control, cancellation, and read-only isolation.
