---
name: gph
description: Stage the session's relevant changes, commit using the repo's commit message style, and push to origin. Does not create a PR — use /create-pr for that. Use when the user invokes /gph
---

# Git Push (`/gph`)

Stage the session's relevant changes, commit, and push. For shared conventions (commit style inference, hook handling, scoping changes to the session) read the reference file first:

> Read `/Users/hlimas/.agents/skills/shared/git-conventions.md` before proceeding.

## Steps

### 1. Check repo state

```bash
git status
git diff --stat
git branch --show-current
git log --oneline -5
```

### 2. Infer commit style → see shared reference

### 3. Stage session-relevant files → see shared reference

### 4. Commit

```bash
git commit -m "<message matching repo style>"
```

Handle hook failures per the shared reference.

### 5. Push

```bash
git push origin <branch>
```

Handle hook failures per the shared reference. Report what was committed, pushed, and whether any hooks were bypassed.

## Edge Cases

| Situation | Action |
|-----------|--------|
| Nothing to commit | Tell the user; stop |
| Unrelated dirty files | Stage only session files; list skipped files |
| Hook failure | Report it and stop; ask the user how to proceed |
| Detached HEAD | Warn; ask which branch to push to |
| User says "include everything" | Use `git add -A` |
