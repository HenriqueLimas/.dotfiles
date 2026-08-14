---
name: show-me-your-work
description: Keep an append-only evidence trail for long, multi-phase, or unattended work that a human will review later. Use when decisions and verification must survive compaction or handoff.
disable-model-invocation: true
---

# Show me your work

Keep one TSV decision log. Log decisions and checkpoints, not every command.

## Format

Use these columns:

```text
ts	phase	decision	why	evidence	result
```

- `ts` is an ISO 8601 timestamp.
- `phase` names the current unit or workstream.
- `decision` says what changed or what was chosen.
- `why` gives the concrete reason.
- `evidence` points to a commit, PR, file and line, command output, test, screenshot, or trace.
- `result` records VERIFIED, NOT VERIFIED, INCONCLUSIVE, reverted, blocked, or another precise state.

Keep every cell on one line. Prefix cells beginning with `=`, `+`, `-`, or `@` with a single quote if spreadsheet software may open the file.

## Rules

- Do not create a trail during a review-only, read-only, or no-artifact request.
- Default to a temporary path outside the repository. Create `.audit/<task-slug>.tsv` only when the user explicitly wants a repository-local trail.
- Commit the trail only when the user explicitly requested a committed audit artifact.
- Append corrections as new rows. Never rewrite history.
- Verify every evidence pointer before handoff.
- Before completion, use a fresh reviewer to compare the trail with the actual diff, tests, and session evidence.

Finish with the trail path, predicate status, weak evidence, abandoned paths, and anything the user should inspect.
