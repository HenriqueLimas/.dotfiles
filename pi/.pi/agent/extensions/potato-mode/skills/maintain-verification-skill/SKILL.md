---
name: maintain-verification-skill
description: Audit and update a project-local verification skill and feature map against current source and one real live pass. Use when a verify-* skill may have drifted.
license: MIT
disable-model-invocation: true
---

# Maintain a verification skill

This skill is explicit-invocation-only. Confirm whether the user authorized corrections or requested an audit only. Audit-only, review-only, no-edit, and no-artifact requests create no files and return recommendations instead.

Keep the verification skill honest without changing product behavior.

## Outcomes

Return exactly one outcome:

- CLEAN. Every mapped feature received source and live coverage; no correction is needed.
- CHANGED. Proven corrections were made inside the verification skill directory.
- BLOCKED. Coverage or a safe correction could not finish; name the exact blocker.

## Scope

When corrections are authorized, edit only the selected `verify-*` skill, its feature map, and helpers it owns. Product defects are findings, not permission to edit product code.

## Workflow

1. Locate project-local `.pi/skills/verify-*/SKILL.md` files. If several exist, ask which one. If none exists, stop and recommend `create-verification-skill`.
2. Compare `features/README.md` with its sibling feature files. Find missing, extra, duplicate, and dead entries.
3. List available subagents. Launch one asynchronous `workflowScript` with read-only `scout` lanes split by feature or bounded feature groups. Each lane traces current source, cites entry points, flags likely drift, and returns one live verification recipe. Do not launch one worker per tiny bullet.
4. Reconcile every mapped feature and inspect recent source churn for user-visible behavior missing from the map.
5. Run the verification skill's Doctor step. Use one controlled live instance where the skill requires it and drive every mapped feature serially. For web or Electron, follow the installed `agent-browser` skill and keep one isolated browser session.
6. After surprising behavior or a failed drive, rerun Doctor or reset to a known state before continuing. Preserve evidence and remove only owned residue.
7. Classify findings:
   - Documentation drift. Correct the feature map.
   - Harness drift. Correct the owned helper and prove it live.
   - Product regression. Report it without changing product code.
   - Environment blocker. Record the exact prerequisite and attempted path.
8. Rerun every changed instruction or helper. Finish with cleanup and confirm evidence remains.

Do not create a branch, commit, push, or PR unless the user requested it. Report feature coverage, unreachable prerequisites, confirmed drift, changed files, live evidence, cleanup, product gaps, and the final outcome.
