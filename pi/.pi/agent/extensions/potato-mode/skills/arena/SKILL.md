---
name: arena
description: Generate several independent solutions to the same design, code, or writing task, judge them against one rubric, then synthesize the strongest coherent result. Use for bakeoffs and one-way design choices.
disable-model-invocation: true
---

# Arena

Use parallel attempts to explore the design space. Do not average incompatible designs.

## Workflow

1. Define one artifact and a rubric with three to six checkable criteria.
2. Choose two to four independent candidates. List available agents first.
3. Launch the candidates together with `workflowScript` and stable keys. Use fresh context and identical task contracts. Give each a distinct output path. For designs, keep them read-only. Before code candidates use `worktree: true`, confirm the repository is clean and the complete candidate baseline is tracked in `HEAD`. Otherwise keep the arena read-only or use one writer in the active checkout.
4. Require a rationale with alternatives considered and rejected.
5. After every candidate finishes, run a fresh read-only `reviewer` or `oracle` as cross-judge while the parent reads every candidate.
6. Score each criterion. Pick the most extensible coherent base, not the most verbose answer.
7. Graft only compatible ideas from losing candidates. Record what was accepted and rejected.
8. Verify the synthesized artifact normally. If candidates diverged because the brief was vague, rewrite the brief and rerun instead of blending them.

Return the selected base, rubric scores, grafts, rejections, dropouts, and verification evidence.
