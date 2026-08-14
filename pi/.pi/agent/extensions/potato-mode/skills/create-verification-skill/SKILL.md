---
name: create-verification-skill
description: Generate a project-local Pi skill that launches and drives the real web, Electron, CLI, TUI, API, mobile, or library surface and captures repeatable proof. Use when a project lacks a reliable user-level verification workflow.
license: MIT
disable-model-invocation: true
---

# Create a verification skill

This skill is explicit-invocation-only. Confirm that the invocation authorizes creating project-local verification files. If the request is review-only, no-edit, or no-artifact, return a proposed skill outline and create no files anywhere.

With authority, create `.pi/skills/verify-<app>/SKILL.md` plus only the helpers and feature references it needs. The generated skill is for future agents arriving without this conversation.

## 1. Interview the repository

Observe before asking:

- Surface. Identify what users touch and choose the primary surface.
- Launch. Find the repository's real development, preview, build, or executable command.
- Readiness. Identify a port, log line, prompt, process state, or health endpoint.
- Drive. Prefer existing Playwright, Cypress, PTY, integration, or smoke harnesses. For web and Electron, load the installed `agent-browser` skill. For services use real HTTP. For CLIs and TUIs use an isolated PTY or existing harness.
- Evidence. Identify screenshots, terminal transcripts, response bodies, logs, exit codes, files, database state, or emitted events that prove behavior.
- Isolation. Determine ports, profiles, data directories, and teardown ownership so concurrent runs cannot corrupt user state.

Do not generate against a checkout that cannot launch. Report the blocker or fix it only when product-code edits are authorized.

## 2. Generate the skill

The skill must contain concrete repository-specific instructions with no placeholders:

- Launch. Exact commands, readiness condition, and teardown.
- Doctor. One read-only check that confirms the right instance, build, auth state, and port before driving it.
- Drive. Stable selectors, commands, routes, prompts, or APIs from this repository. Avoid coordinates and tab order when semantic handles exist.
- Evidence. The action and resulting state, plus external side effects. A final screenshot alone is not proof of the path.
- Cleanup. Stop only processes and scratch state the verification run created. Preserve evidence.
- Helpers. Document every shipped helper and make it safe to rerun.

For `agent-browser`, use one worktree-scoped session ID, snapshot before interactions, refresh refs after navigation, and close the session after the run. Never expose cookies, tokens, or saved browser state.

## 3. Seed the feature map

Create `features/README.md` and three to five initial feature files derived from routes, commands, menus, or public docs. Each feature records:

- What the user can do
- How the user reaches it
- How the harness drives it
- The observable state that proves success
- Preconditions and gotchas

## 4. Prove the generated skill

Run one complete feature through launch, doctor, drive, evidence capture, and cleanup. Confirm evidence survives cleanup and no owned process or scratch state remains. Fix the skill and rerun when any step fails.

## Guardrails

- Do not edit product code unless separately authorized.
- Do not use test-only setters or private endpoints as proof of a user path.
- Do not trust a command named `dry-run`; observe what it actually writes or sends.
- Do not kill by process name. Track what the run started.
- Keep generated evidence outside Git unless the user requested committed fixtures.

Report the generated skill path, mapped features, command executed, evidence path, cleanup result, and remaining coverage gaps.
