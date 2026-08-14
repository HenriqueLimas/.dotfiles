---
name: why
description: Investigate why code or a design has its current shape. Use for rationale, history, rejected alternatives, regressions, thresholds, incidents, and product or operational constraints. Use how for current mechanics.
disable-model-invocation: true
---

# Why

Recover intent from evidence. Code proves mechanics, not motivation.

## Workflow

1. Anchor the target with file paths, symbols, line ranges, blame, and recent commits.
2. Search source history first. Use `git log`, `git blame`, commit messages, tests, and `gh` PR or issue records when available.
3. Identify other evidence sources available in this session, such as project docs, ADRs, tickets, team chat, observability, error tracking, or analytics. Search only sources you can actually access.
4. For a broad history question, list available subagents and launch distinct read-only lanes in one `workflowScript`. Use `researcher` for external or hosted primary sources and `scout` for repository history. Give every lane the same code anchor and one evidence category.
5. Synthesize after evidence collection. Separate direct evidence, inference, competing hypotheses, and gaps. Preserve contradictions.

## Confidence rules

- Cite every claim about intent with a commit, PR, issue, document, permalink, or code comment.
- Put uncited claims under inference.
- Report null searches and unavailable evidence sources.
- Use confident language only for explicit records.

## Output

- The question
- The code in question
- Direct evidence
- Reasonable inferences
- Competing hypotheses
- Unknowns
- Sources consulted

If the investigation precedes a change, finish with Preserve, Change, Avoid, and Risk constraints.
