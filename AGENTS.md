# Repo Instructions

This repository is a personal dotfiles repo managed with GNU Stow. Each top-level package directory mirrors paths under `$HOME`; Stow creates symlinks from the package contents into the home directory.

## Mental model

- Treat top-level directories as Stow packages, not application source roots.
- A file path inside a package should match its final home-directory path:
  - `zsh/.zshrc` -> `~/.zshrc`
  - `nvim/.config/nvim/init.lua` -> `~/.config/nvim/init.lua`
  - `pi/.pi/settings.json` -> `~/.pi/settings.json`
  - `herdr/.config/herdr/config.toml` -> `~/.config/herdr/config.toml`
- `install.sh` currently restows these packages: `bin nvim zsh karabiner rust pi agents herdr`.

## Important workflow notes

- Check `git status --short` before editing. This repo often contains machine-local or in-progress config changes; do not overwrite unrelated user changes.
- Prefer narrow, explicit edits. Dotfiles are live personal configuration, so avoid broad rewrites unless requested.
- If adding a new top-level Stow package, update `install.sh` if it should be installed by the default restow command.
- Keep paths Stow-safe: add files under the package directory exactly where they should appear relative to `$HOME`.
- Do not use `git commit --no-verify`, `git push --no-verify`, or any other `--no-verify` flag unless the user explicitly asks for it.
- Never use `git commit --no-gpg-sign` or otherwise disable commit signing. If signing fails, stop and ask the user to complete or fix the signing step.

## Validation commands

There is no normal build/test suite. Use targeted checks instead:

- Dry-run a package before installing links:
  ```sh
  stow --no --verbose --target="$HOME" <package>
  ```
- Restow all default packages:
  ```sh
  ./install.sh
  ```
- Unstow a package:
  ```sh
  stow --delete --target="$HOME" <package>
  ```
- For `install.sh`, run `shellcheck` if available.
- For Neovim Lua changes, keep formatting consistent with the existing tabs/indentation and validate by starting `nvim` or checking the specific Lua module when practical.

## Sensitive/local files

- Do not inspect, print, or commit secrets. In particular, treat `pi/.pi/agent/auth.json` and session data under `pi/.pi/agent/sessions/` as sensitive/local.
- `.gitignore` already excludes several generated/local paths such as `.DS_Store`, `automatic_backups`, `bin/.local/share`, `bin/.local/state`, `pi/.pi/agent/auth.json`, and `pi/.pi/agent/sessions/`.

## Package context

- `zsh/`: Oh My Zsh config, aliases, PATH setup, fnm, Homebrew, Docker completions, and corporate CA bundle environment variables.
- `bin/`: Stow package for `~/.local`; it currently has no tracked executables.
- `nvim/`: Neovim config using `lazy.nvim`, Lua modules under `lua/hlimas`, LSP/completion setup, conform formatting, Treesitter/Marko support, and personal keymaps.
- `karabiner/`: Karabiner Elements JSON config.
- `rust/`: Cargo environment file.
- `pi/`: pi agent/settings config. Avoid touching auth/session files.
- `agents/`: global agent config/skills package, separate from this root `AGENTS.md` repo guide.
- `herdr/`: Herdr configuration and local workflow plugins.
