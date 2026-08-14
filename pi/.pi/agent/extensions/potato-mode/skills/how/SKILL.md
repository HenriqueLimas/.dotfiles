---
name: how
description: Explain how a subsystem works, trace runtime and data flow, map ownership, or critique layering. Use for "how does this work", walkthroughs, placement questions, and architecture understanding before a change.
disable-model-invocation: true
---

# How

Build a working mental model from source. Do not infer behavior from filenames.

## Workflow

1. Restate the question and bound the subsystem.
2. Find the entry point, core types, state owner, callers, effects, configuration, and tests.
3. For a narrow question, inspect directly. For a cross-cutting subsystem, list available subagents, then use one `workflowScript` with distinct read-only `scout` lanes. Split by data model, runtime path, boundaries, or validation instead of giving every child the same prompt.
4. Reconcile child findings against the source yourself. Follow contradictory claims to the exact code.
5. If the user asked whether the architecture is sound, add fresh `reviewer` passes for correctness and reader load. Do not edit.

## Output

Use only the sections the question needs:

- Overview
- Key concepts
- How it works
- Where things live
- Gotchas
- Critique and tradeoffs

Cite concrete files and symbols. Prefer a short end-to-end flow over annotated source.
