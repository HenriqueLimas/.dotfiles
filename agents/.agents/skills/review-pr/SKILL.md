---
name: review-pr
description: Review a GitHub Pull Request for bugs ranked by critical/high/medium/low severity. Performs multi-pass analysis, rules out false positives through research, and writes a final report. Use when the user invokes /review-pr or asks to review a PR.
---

# Review PR (`/review-pr #{PR number or URL}`)

Review the PR `#{arguments}` to find bugs in this PR ranked by critical/high/medium/low. Once you're all done, review the findings, do your own research to rule out false positives, and write a final report.

## Steps

### 1. Fetch the PR

```bash
gh pr view {PR} --json title,body,baseRefName,headRefName,files,commits,url
gh pr diff {PR}
```

If `{PR}` is a URL, extract the number from it. If no argument was given, use the current branch's open PR:

```bash
gh pr view --json number,url 2>/dev/null
```

### 2. Understand the change

- Read the PR title, description, and linked issues for intent.
- Identify the files changed and their roles in the codebase.
- Read any relevant surrounding code (not just the diff) using the `read` tool.

### 3. First-pass bug hunt

Scan the diff for bugs across all severity levels. For each finding record:

| Field | Value |
|-------|-------|
| Severity | `critical` / `high` / `medium` / `low` |
| File & line | e.g. `src/auth/token.ts:42` |
| Category | e.g. logic error, race condition, null deref, security, perf regression |
| Description | What is wrong and why it's a bug |
| Snippet | Relevant diff lines |

Common bug categories to check:
- Off-by-one errors, incorrect loop bounds
- Null / undefined dereferences
- Race conditions, missing awaits, incorrect async patterns
- Incorrect error handling or swallowed exceptions
- Security issues (injection, exposure of secrets, missing auth checks)
- Data-loss paths (writes without transactions, missing rollbacks)
- Broken edge cases (empty input, max values, concurrent access)
- Regressions introduced by the change (side-effects on callers)

### 4. Rule out false positives

For each finding from step 3:

1. **Read the surrounding code** — confirm the bug exists in context, not just the diff.
2. **Check call sites** — verify whether the issue can actually be reached.
3. **Look for existing safeguards** — middleware, validators, type guards upstream.
4. **Check tests** — does a passing test already cover and validate the behaviour?

Discard or downgrade findings that are clearly handled elsewhere. Note the reason.

### 5. Write the final report

Output a structured report:

---

## PR Review: {PR title} ({PR URL})

### Summary

One paragraph: what the PR does and overall risk assessment.

### Bugs Found

#### 🔴 Critical

> No critical bugs found. *(or list them)*

- **[C1] {Short title}** — `{file}:{line}`
  {Description of the bug and its impact.}
  ```diff
  {relevant snippet}
  ```
  **Suggested fix:** {brief fix or direction}

#### 🟠 High

*(same format)*

#### 🟡 Medium

*(same format)*

#### 🔵 Low

*(same format)*

### False Positives Ruled Out

List findings from step 3 that were dismissed and why.

### Verdict

`Approve` / `Request Changes` / `Needs Discussion` — one sentence rationale.

---

## Notes

- If the PR has no bugs at any severity, say so explicitly — do not manufacture findings.
- Do not comment on style, formatting, or non-bug nits unless they mask a real bug.
- If you cannot fetch the PR (permissions, no `gh` CLI), ask the user to paste the diff.
