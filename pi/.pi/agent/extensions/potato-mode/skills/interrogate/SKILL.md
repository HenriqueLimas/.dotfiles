---
name: interrogate
description: Run adversarial independent review of a diff, design, plan, or implementation, then synthesize a pragmatic verdict. Use for "interrogate", stress tests, blind spots, and high-risk review.
disable-model-invocation: true
---

# Interrogate

The deliverable is a verdict, not automatic edits.

## Workflow

1. Define the scope and state the intended outcome in one paragraph.
2. Collect the actual diff or artifact plus only the context reviewers need.
3. List available agents. Launch fresh-context `reviewer` lanes in one asynchronous `workflowScript`. Use distinct angles such as correctness and regressions, validation quality, simplicity and reader load, security, performance, or user behavior. Use different configured models when available without inventing unavailable model IDs.
4. Reviewers do not edit. They report evidence-backed findings with severity and file or line references.
5. Deduplicate findings and note consensus, lone findings, and explicit disagreement.
6. Apply lead judgment. Classify each finding as Act on, Consider, Noted, or Dismissed. Explain why.
7. If fixes are already authorized, give only accepted fixes to one `worker`, then re-review non-trivial changes. Otherwise stop at the verdict.

Return Intent, Reviewers, Act on, Consider, Noted, Dismissed, and Agreement map.
