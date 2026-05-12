# Shared Git Conventions

Shared reference used by the `gph` and `create-pr` skills. Load with `read` when needed.

---

## Infer commit message style

Never assume a style. Always check recent history first:

```bash
git log --oneline -20
```

Match whatever format the repo uses:

| Pattern seen in log | Style |
|---------------------|-------|
| `feat(scope): msg`, `fix: msg`, `chore: msg` | Conventional Commits |
| `Add X`, `Fix Y`, `Remove Z` | Plain imperative |
| `PROJ-123: msg` | Jira-prefixed |
| `[component] msg` | Bracket-prefixed |

Use that same style for new commit messages and PR titles.

---

## Scope changes to the current session

**Do not blindly `git add -A`** unless the user explicitly asks or every dirty file is session work.

Stage only files that were touched during this conversation:

```bash
git add <file1> <file2> ...
```

If unrelated dirty files exist, leave them unstaged and tell the user which ones were skipped.

---

## Handle hook failures

**Never use `--no-verify` on commit or push unless the user explicitly asks for it.**

### Pre-commit hook

- Failure **related to session code** → fix it, then commit normally
- Failure **unrelated to session code** → report the failure to the user and ask how they want to proceed; do not bypass automatically

### Pre-push hook

- Same rule: report the failure clearly and stop; let the user decide whether to bypass
- Only use `--no-verify` if the user explicitly instructs it

---

## Determine the base branch

```bash
git remote show origin | grep "HEAD branch"
# or fall back to: main → master → develop
```

---

## Find the PR template

```bash
find . -maxdepth 3 \( \
  -name "PULL_REQUEST_TEMPLATE.md" -o \
  -name "pull_request_template.md" \
  \) -not -path "*/node_modules/*" | head -3
```

Read it if found. Use its exact section structure. If absent, write a clean freeform body.

---

## Fill in a PR template

| Section | How to fill it |
|---------|---------------|
| Issue reference (`Fixes #`) | Only if the user provided a number; otherwise leave blank |
| Description | Summarise what changed and why, from this session |
| Notes | `--no-verify` bypasses, pre-existing failures, out-of-scope items |
| Screenshots | "N/A — no visual changes" when nothing visual changed |
| Checklist | Leave **unchecked** — the author verifies, not the AI |
