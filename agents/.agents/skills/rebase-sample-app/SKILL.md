---
name: rebase-sample-app
description: Rebase a feature branch (fgql, rsc, etc.) of sample-app-react-ebay onto the latest main from the ../sample-react-app-ebay-new worktree. Keeps exactly one commit ahead of main, amends in place, and force-pushes. Use when the user invokes /rebase-sample-app.
---

# Rebase Sample App Branch (`/rebase-sample-app`)

Rebases a long-lived feature branch (e.g. `fgql`, `rsc`) of `sample-app-react-ebay` onto the latest `main`, which lives in the sibling worktree `../sample-react-app-ebay-new`. The branch must always end up exactly **one commit ahead** of main; all changes are squashed/amended into that single commit.

## Context

- Repo: `github.corp.ebay.com:nodejs/sample-app-react-ebay.git`
- Worktrees:
  - `../sample-react-app-ebay-new` → `main` branch
  - Current dir → feature branch (`fgql`, `rsc`, …)
- The feature branch adds new packages and files on top of main, so `package.json` and `yarn.lock` **always** conflict.
- `vite.config.ts` may also conflict if main changed the Vite plugin configuration.
- Pre-push hook runs Playwright e2e (requires VPN/eBay network); bypass with `--no-verify` after confirming unit tests pass locally.

## Steps

### 1. Verify preconditions

```bash
git status           # must be clean — no uncommitted changes
git log --oneline -3 # confirm there is exactly 1 commit ahead of main
```

If the working tree is dirty, stash or discard before proceeding.

### 2. Start the rebase

```bash
git rebase main
```

Expect conflicts in: `package.json`, `yarn.lock`, and possibly `vite.config.ts`.

### 3. Resolve `package.json` conflicts

**Rule**: take **main's version** for every shared package; keep **branch-specific packages** that don't exist in main.

For the `fgql` branch, the packages that must be preserved (not in main) are:
- `@ebay/react-fgql`
- `@ebay/web-fgql`
- `@conform-to/react`, `@conform-to/zod`
- `zod`

For version conflicts on shared packages (e.g. `@ebay/react`, `react-router`, `vite`, `vite-plugin-cjs-interop`, `@ebay/swu-ebay`, `@ebay/react-cli`): **always take main's (newer) version**.

After editing, verify no conflict markers remain:
```bash
grep -n "<<<<<<\|======\|>>>>>>" package.json
```

### 4. Resolve `vite.config.ts` conflicts (if present)

- Remove any `tsconfigPaths()` import/call — main dropped `vite-tsconfig-paths`.
- Keep `i18nEbay({ framework: "react" })` — the `framework: "react"` option is required by the feature branch to enable the `T` React component export from i18n typegen. **Do not use the bare `i18nEbay()` call from main.**

After editing, verify no conflict markers:
```bash
grep -n "<<<<<<\|======\|>>>>>>" vite.config.ts
```

### 5. Mark files resolved

```bash
git add package.json vite.config.ts   # add any other manually resolved files
```

### 6. Regenerate `yarn.lock`

Do **not** manually resolve `yarn.lock` — let Yarn handle it:

```bash
yarn install
```

Yarn will detect the merge conflict in `yarn.lock`, auto-merge it, and regenerate it cleanly. Then:

```bash
git add yarn.lock
```

### 7. Continue the rebase

```bash
GIT_EDITOR=true git rebase --continue
```

`GIT_EDITOR=true` skips the interactive commit message editor since we're amending an existing message.

### 8. Verify the result

```bash
git log --oneline -4     # exactly 1 commit ahead of main
git status               # clean working tree
git diff main --name-only  # shows all files added/changed by the feature branch
```

### 9. Amend if there are additional fixups needed

If the rebase revealed any other issues (e.g. stale imports, wrong package versions), fix them and amend into the single commit:

```bash
git add <files>
git commit --amend --no-edit
```

### 10. Force push

```bash
git push --force-with-lease --no-verify origin <branch>
```

Use `--no-verify` to skip the pre-push Playwright hook (which requires eBay VPN). Unit tests (`yarn test run`) and type-check (`yarn type:check`) should be confirmed passing before pushing.

## Known Gotchas

| Gotcha | Fix |
|---|---|
| `"T" is not exported by "#i18n/..."` build error | `vite.config.ts` is missing `framework: "react"` in `i18nEbay()` — the bare call disables the React `T` component export |
| `yarn install` fails on lock conflict | Yarn 1.x auto-merges lock conflicts — just run `yarn install` and it resolves itself |
| Pre-push hook times out (Playwright needs VPN) | Use `--no-verify`; unit tests + type-check are sufficient local validation |
| `fgql typegen` fails with `socket hang up` | Expected outside eBay VPN — the generated `.d.ts` files are committed and don't need regeneration locally |

## Branches this applies to

- `fgql` — FGQL (Federated GraphQL) setup example
- `rsc` — React Server Components setup example (similar conflict pattern)
