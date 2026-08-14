---
name: figure-it-out
description: Design a rigorous auditable workflow when no narrower playbook fits, especially for large migrations, multi-part work, or unattended execution reviewed later.
disable-model-invocation: true
---

# Figure it out

Design the workflow before code. Reuse a narrower Potato Mode playbook when one fits.

## Workflow

1. Define done as a falsifiable predicate. Quantify scope, unknowns, blast radius, time, and verification cost.
2. Choose the rigor level. One-way doors and wide migrations require more independent evidence than reversible local edits.
3. Build the verification mechanism and capture the baseline before changing behavior.
4. Decompose work into independently verifiable units. Order the riskiest unknown first.
5. Use `architect` or `arena` for unsettled shapes. Skip design fanout for mechanical work with a known target.
6. Decide parallel seams. Use one asynchronous `workflowScript` for read-only research or isolated worktrees. Keep one writer per checkout.
7. Snapshot repository status before each writing unit. Run the unit as an experiment: state the hypothesis, make the smallest change, measure the real artifact, and keep proven progress. If it fails, undo only the exact changes created by that unit. Never reset, restore, or overwrite unrelated dirty work.
8. Use `show-me-your-work` for a durable decision trail when the user will review the run later.
9. Finish with fresh review, whole-system verification, and explicit VERIFIED, NOT VERIFIED, or INCONCLUSIVE results.

Return the designed playbook, rigor choice, decision-trail path, verified predicate, and open work.
