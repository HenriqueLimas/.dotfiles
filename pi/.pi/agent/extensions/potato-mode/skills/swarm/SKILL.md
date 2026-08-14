---
name: swarm
description: Fan out parallel coverage, races, or independent work slices through pi-subagents and return one consolidated report. Use when work has real parallel seams.
disable-model-invocation: true
---

# Swarm

Parallelize independent work, not shared mutable state.

## Workflow

1. State the done predicate and final report or artifact.
2. Choose the shape: partitioned coverage, identical race, or mixed. Define the selection rule before launch.
3. List available agents. Build one `workflowScript` with stable, descriptive keys and lane-specific prompts.
4. Every lane gets a goal, exact scope, cwd, authority boundary, evidence, validation, output shape, and stop rules.
5. Keep lanes read-only by default. If lanes must write, give every writer a managed worktree and distinct files or repositories.
6. Launch asynchronously. Aggregate completed results instead of forwarding raw dumps.
7. For coverage, require a result for every required slice. For races, apply the declared selection rule. Record gaps and failed lanes.

Return a compact result table, evidence-backed findings, gaps, and the selection rule when applicable.
