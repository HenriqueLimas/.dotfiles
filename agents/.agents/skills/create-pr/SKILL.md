---
name: create-pr
description: Create a GitHub Pull Request for the current branch using the repo's PULL_REQUEST_TEMPLATE if present. Scopes the PR description to the current session's changes. Use when the user invokes /create-pr.
---

# Create PR (`/create-pr`)

Open a GitHub Pull Request for the current branch. For shared conventions (commit style inference, PR template discovery, filling the template, hook handling) read the reference file first:

> Read `/Users/hlimas/.agents/skills/shared/git-conventions.md` before proceeding.

## Steps

### 1. Check branch state

```bash
git branch --show-current
git status
git log --oneline origin/<base>..HEAD
git diff origin/<base>...HEAD --stat
```

Determine the base branch → see shared reference.

Check whether a PR already exists:

```bash
gh pr view --json url,title 2>/dev/null
```

If one exists, offer to update it with `gh pr edit` instead.

### 2. Scope the description to this session

Use only files and commits from this conversation. Cross-reference:
- Files mentioned or modified during this session
- `git log --oneline origin/<base>..HEAD`

Include additional files only if the user explicitly asks.

### 3. Find the PR template → see shared reference

### 4. Fill in the template → see shared reference

### 5. Create the PR

```bash
gh pr create \
  --title "<title matching repo commit style>" \
  --body "<filled template>" \
  --base <base-branch> \
  --head <current-branch>
```

Print the PR URL.

## Edge Cases

| Situation | Action |
|-----------|--------|
| PR already exists | Offer to update with `gh pr edit` |
| No `gh` CLI / not authenticated | Print the GitHub compare URL for manual creation |
| No PR template found | Write a clean freeform PR body |
| `--no-verify` was used during push (user-instructed) | Note it in the Notes section with reason |
| Detached HEAD | Warn; ask which branch to target |
| User provides issue number | Insert `Fixes #<number>` |
