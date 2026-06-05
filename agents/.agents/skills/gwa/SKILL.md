---
name: gwa
description: Create a git worktree for a branch, install dependencies if package.json is present, and open the worktree folder in a new tmux agent pane. Use ONLY when the user invokes /gwa <branch-name>.
---

# Git Worktree Add (`/gwa <branch-name>`)

Create a git worktree for the given branch, install dependencies if needed, and open a tmux pane for the new worktree.

## Input

The user invokes this as:

```
/gwa <branch-name>
```

Where `<branch-name>` is the target branch (e.g. `my-feature`). The worktree folder will be placed at `../<repo-name>-<branch-name>` relative to the current repo root (mirroring the `gwa ../<project>-<branch-name> -b <branch-name>` shell alias convention).

---

## Steps

### 1. Resolve context

```bash
# Get the repo root and name
git rev-parse --show-toplevel
git rev-parse --show-toplevel | xargs basename

# Confirm we're inside a git repo
git rev-parse --git-dir
```

Derive:
- `REPO_ROOT` → output of `git rev-parse --show-toplevel`
- `REPO_NAME` → basename of `REPO_ROOT`
- `BRANCH`    → the `<branch-name>` the user passed
- `WORKTREE_PATH` → `$REPO_ROOT/../$REPO_NAME-$BRANCH`

### 2. Check whether the branch already exists

```bash
git branch --list "<branch-name>"
git branch -r --list "origin/<branch-name>"
```

- If the branch exists locally or remotely → use `git worktree add` **without** `-b` (checkout existing branch).
- If the branch does **not** exist → create it from `main` (fetch latest first), unless the user explicitly specifies a different base.

### 3. Create the worktree

**Branch already exists:**
```bash
git worktree add "$WORKTREE_PATH" "<branch-name>"
```

**Branch does not exist (create it from `main`):**
```bash
# Ensure main is up to date
git fetch origin main

git worktree add -b "<branch-name>" "$WORKTREE_PATH" origin/main
```

If the user specified a different base (e.g. `/gwa my-feature from develop`), substitute that branch for `origin/main` in the command above.

If the command fails (e.g. the worktree path already exists), report the error and stop. Do not attempt to recover silently.

### 4. Install dependencies (if `package.json` present)

```bash
# Check for package.json in the new worktree root
test -f "$WORKTREE_PATH/package.json" && echo "found" || echo "none"
```

If `package.json` is found, run:

```bash
cd "$WORKTREE_PATH" && ni
```

`ni` automatically picks the right package manager (npm / pnpm / yarn / bun) based on lockfile. Wait for it to complete before continuing.

If `ni` is not installed or fails, warn the user and continue — do not stop the skill.

### 5. Open the worktree in a new tmux agent pane

```bash
tmux-agent-pane "$WORKTREE_PATH"
```

`tmux-agent-pane` accepts an optional path argument — when provided it skips the fzf picker and goes straight to opening the pane or session.

### 6. Report

Tell the user:
- ✅ Worktree path created at `$WORKTREE_PATH`
- Whether the branch was **new** or **existing**
- Whether `ni` ran and succeeded (or was skipped / failed)
- Whether the tmux pane was opened (or a new session was created)

---

## Edge Cases

| Situation | Action |
|-----------|--------|
| Not inside a git repo | Warn and stop immediately |
| Worktree path already exists | Report the conflict and stop; suggest `gwr` to remove it first |
| Branch exists locally **and** remotely | Prefer local; use `git worktree add` without `-b` |
| User specifies a base branch (e.g. "from develop") | Use `origin/<base>` instead of `origin/main`; fetch it first |
| Branch exists in another worktree already | Git will error; report it and stop |
| `ni` command not found | Warn the user; skip install step; continue to tmux step |
| `ni` fails (install errors) | Report the failure; continue to tmux step |
| `tmux` not running and not in a tmux session | Create a new tmux session named after the worktree folder |
| User omits the branch name | Ask: "Which branch should I create the worktree for?" |
