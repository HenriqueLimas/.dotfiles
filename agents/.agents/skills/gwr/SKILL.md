---
name: gwr
description: Remove a git worktree by branch name or path, and kill any associated tmux pane or session. Use ONLY when the user invokes /gwr <branch-name|path>.
---

# Git Worktree Remove (`/gwr <branch-name|path>`)

Remove a git worktree and clean up any tmux pane or session that was opened for it.

## Input

```
/gwr <branch-name>
/gwr <path>
```

The user can pass either:
- A **branch name** (e.g. `my-feature`) — the skill resolves it to its worktree path via `git worktree list`
- A **path** (e.g. `../repo-my-feature` or an absolute path) — used directly

---

## Steps

### 1. Resolve the worktree path

```bash
git worktree list --porcelain
```

Parse the output to build a map of `branch → path` and `path → path`.

- If the user passed a branch name: find the entry where `branch refs/heads/<branch-name>` matches and extract its `worktree` path.
- If the user passed a path: resolve it to an absolute path (`realpath` or expand `..`) and confirm it appears in the list.

If no matching worktree is found, report it and stop. Show the full `git worktree list` output to help the user.

### 2. Confirm it is not the main worktree

```bash
git rev-parse --show-toplevel
```

If `WORKTREE_PATH` equals the main repo root, refuse and stop — removing the main worktree would destroy the repo checkout.

### 3. Kill any tmux pane tracking this path

Panes opened by `tmux-agent-pane` store the directory in the `@agent_dir` pane option. Find and kill them:

```bash
# Find panes whose @agent_dir matches the worktree path
tmux list-panes -a -F "#{pane_id} #{@agent_dir}" 2>/dev/null \
  | grep " $WORKTREE_PATH$" \
  | cut -d' ' -f1
```

For each matching `pane_id`:
```bash
tmux kill-pane -t "<pane_id>"
```

After killing panes, resize remaining ones:
```bash
tmux-resize-panes-equal 2>/dev/null || true
```

### 4. Kill any tmux session for this path

Sessions created outside an existing tmux session are named after `basename $WORKTREE_PATH | tr . _`. Check and kill:

```bash
session_name=$(basename "$WORKTREE_PATH" | tr . _ )
tmux has-session -t="$session_name" 2>/dev/null && tmux kill-session -t "$session_name"
```

### 5. Remove the worktree

```bash
git worktree remove "$WORKTREE_PATH"
```

If it fails because the worktree has uncommitted changes, report the error and ask the user:
> "The worktree has uncommitted changes. Remove anyway with `--force`?"

If the user confirms, run:
```bash
git worktree remove --force "$WORKTREE_PATH"
```

### 6. Prune stale worktree refs (optional cleanup)

```bash
git worktree prune
```

### 7. Report

Tell the user:
- ✅ Worktree removed at `$WORKTREE_PATH`
- How many tmux panes were killed (or "none found")
- Whether a tmux session was killed (or "none found")
- Whether `--force` was used

---

## Edge Cases

| Situation | Action |
|-----------|--------|
| User omits argument | Ask: "Which branch or path should I remove the worktree for?" |
| Branch / path not found in worktree list | Show `git worktree list` and stop |
| Argument matches the main worktree | Refuse — cannot remove the main checkout |
| Worktree has uncommitted changes | Warn and ask before using `--force` |
| No tmux running | Skip steps 3 & 4 silently |
| Pane is the currently active pane | Kill it — the user triggered this intentionally |
| Session name collision (unrelated session) | Check `session_path` or `pane_current_path` to confirm it's actually this worktree before killing |
