---
name: no-comments
description: Review changed comments and suppressions, remove narration and stale constraints, and encode important invariants in code, types, tests, or checks. Use before final review or when comments hide unclear design.
disable-model-invocation: true
---

# No comments

Comments must explain a non-obvious reason the code cannot express. Narration, phase labels, stale warnings, and commented-out code do not earn their place.

## Workflow

1. Scope the current diff or the files named by the user.
2. Launch one fresh read-only `reviewer` focused only on comments, docblocks, lint suppressions, TypeScript suppressions, disabled tests, and commented-out code.
3. For each finding, classify it as Delete, Encode, Keep, or Investigate.
4. Check authority before changing anything. For review-only or no-edit requests, report Delete and Encode recommendations without editing or launching a writer.
5. When edits are authorized, delete narration and stale text. Encode real invariants in a type, API boundary, assertion, test, lint rule, or generated metadata when practical.
6. Keep a comment only when it records a non-obvious external constraint, compatibility fact, or reason the code cannot show. Verify that fact with `how` or `why` when uncertain.
7. Give accepted authorized changes to one writer and run the affected checks.

Report recommended or completed deletions, encoded constraints, justified comments, suppressions, validation, and open constraints. Do not delete license headers or required generated-file notices.
