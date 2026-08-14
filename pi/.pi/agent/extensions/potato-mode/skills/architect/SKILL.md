---
name: architect
description: Design types, signatures, ownership, and module boundaries before implementation. Use for architecture work, contested shapes, new stateful systems, or changes crossing important function or package boundaries.
disable-model-invocation: true
---

# Architect

Settle the caller-facing shape before implementation.

## Workflow

1. Ground the existing system with the `how` skill. Use `why` when existing rationale constrains the design.
2. State the caller's desired usage first. Name the core data shape, ownership, invariants, and failure boundaries.
3. List available subagents. Use the `arena` skill or one `workflowScript` to produce at least two structurally different read-only designs. Suitable roles are `planner`, `oracle`, and `context-builder`. Do not ask parallel writers to edit the same checkout.
4. Require each candidate to include the caller example, types or signatures, module map, state owner, rejected alternative, migration shape, and validation plan.
5. Compare candidates on illegal states, boundary clarity, interface depth, reader load, migration cost, and how directly they satisfy the caller.
6. Choose one coherent base. Graft only ideas that fit its mental model.
7. If implementation is authorized, hand the synthesized contract to one `worker`. Treat repeated deviations from the design as evidence that the design is wrong, not friction to patch around.
8. Verify the real artifact and use a fresh reviewer when the boundary is high risk.

A checkpoint is required only when the user requested one or the choice is a genuine product, irreversible, or high-cost decision.
