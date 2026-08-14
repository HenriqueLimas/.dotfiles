---
name: potato-mode
description: Rigorous engineering router loaded only by the Potato Mode extension hook or explicit /skill:potato-mode invocation. Do not auto-load for ordinary engineering requests.
license: MIT
disable-model-invocation: true
---

# Potato Mode

Read this skill in full at the start of every substantive task while Potato Mode is active. Use the task's intent and context to choose a playbook from [`references/playbooks.md`](references/playbooks.md). Do not route by keyword.

## Non-negotiables

- Loading Potato Mode or any linked skill never expands the user's authority. Read-only, review-only, no-edit, no-artifact, publication, Git, destructive, and repository boundaries continue to apply.
- Read every applicable `principle-*` leaf skill before using that principle. A principle name in the final summary must point to a decision it changed.
- Understand the affected system before changing it. Use [`how`](../how/SKILL.md) for mechanics and ownership. Use [`why`](../why/SKILL.md) for rationale and historical constraints.
- Name the user-visible outcome and verification surface before implementation.
- Before stateful or branching code, name the domain shape and load [`principle-model-the-domain`](../principle-model-the-domain/SKILL.md).
- Before a change crosses an important function, module, package, process, or protocol boundary, load [`architect`](../architect/SKILL.md).
- Use [`arena`](../arena/SKILL.md) for competing implementations or designs. Use [`swarm`](../swarm/SKILL.md) for independent coverage slices or races. Use [`interrogate`](../interrogate/SKILL.md) for adversarial review.
- Reproduce bugs on the matching surface before editing. Load [`principle-fix-root-causes`](../principle-fix-root-causes/SKILL.md) and prove the original reproduction passes after the fix.
- Load [`blast-radius`](../blast-radius/SKILL.md) before shipping a small-looking change with hidden downstream risk.
- Load [`no-comments`](../no-comments/SKILL.md) only for authorized cleanup. Review-only requests produce recommendations, not edits.
- Apply [`unslop`](../unslop/SKILL.md) to prose. Load [`technical-writing`](../technical-writing/SKILL.md) for documentation, RFCs, READMEs, PR descriptions, and commit messages.
- For TypeScript, load [`typescript-best-practices`](../typescript-best-practices/SKILL.md). Use [`tdd`](../tdd/SKILL.md) for authorized test-first work with a practical test path. Load [`teach`](../teach/SKILL.md) only when the user explicitly wants a persistent teaching workspace.
- Create or maintain a project verification skill only when the user explicitly invokes [`create-verification-skill`](../create-verification-skill/SKILL.md) or [`maintain-verification-skill`](../maintain-verification-skill/SKILL.md).
- Use existing installed skills instead of duplicates. Reach for `domain-modeling`, `improve-codebase-architecture`, `review-pr`, `create-pr`, `gph`, and autoresearch skills when they match.
- Do not stage, commit, push, open or merge a PR, deploy, publish, force-push, delete data, or send external messages unless the user explicitly requested that action.

## Principles

The leaf skills are the source of truth. Load only the ones that apply.

### Core

- [`principle-laziness-protocol`](../principle-laziness-protocol/SKILL.md). Prefer deletion and the smallest maintainable change.
- [`principle-foundational-thinking`](../principle-foundational-thinking/SKILL.md). Choose data structures and useful scaffold before downstream logic.
- [`principle-redesign-from-first-principles`](../principle-redesign-from-first-principles/SKILL.md). Integrate a requirement as if it existed from day one.
- [`principle-subtract-before-you-add`](../principle-subtract-before-you-add/SKILL.md). Remove dead complexity before construction.
- [`principle-minimize-reader-load`](../principle-minimize-reader-load/SKILL.md). Reduce indirection and hidden mutable state.
- [`principle-outcome-oriented-execution`](../principle-outcome-oriented-execution/SKILL.md). Converge on the authorized end state without permanent transition machinery.
- [`principle-experience-first`](../principle-experience-first/SKILL.md). Optimize for the end user, API consumer, and next maintainer.
- [`principle-exhaust-the-design-space`](../principle-exhaust-the-design-space/SKILL.md). Compare structurally different prototypes for unsettled one-way choices.
- [`principle-build-the-lever`](../principle-build-the-lever/SKILL.md). Build the smallest rerunnable tool that performs or proves non-trivial work.

### Architecture

- [`principle-model-the-domain`](../principle-model-the-domain/SKILL.md). Encode domain rules in data structures instead of scattered conditionals.
- [`principle-boundary-discipline`](../principle-boundary-discipline/SKILL.md). Parse and validate at boundaries; keep internal logic typed and direct.
- [`principle-type-system-discipline`](../principle-type-system-discipline/SKILL.md). Make illegal states unrepresentable and handle variants exhaustively.
- [`principle-make-operations-idempotent`](../principle-make-operations-idempotent/SKILL.md). Make retries and partial runs converge.
- [`principle-migrate-callers-then-delete-legacy-apis`](../principle-migrate-callers-then-delete-legacy-apis/SKILL.md). Migrate internal callers and remove the old path in one authorized wave.
- [`principle-separate-before-serializing-shared-state`](../principle-separate-before-serializing-shared-state/SKILL.md). Remove shared writes before adding locks or queues.

### Verification

- [`principle-prove-it-works`](../principle-prove-it-works/SKILL.md). Inspect and exercise the real artifact.
- [`principle-fix-root-causes`](../principle-fix-root-causes/SKILL.md). Reproduce, instrument, and fix mechanisms rather than symptoms.
- [`principle-sequence-verifiable-units`](../principle-sequence-verifiable-units/SKILL.md). End every meaningful unit in a check before advancing.

### Delegation and learning

- [`principle-guard-the-context-window`](../principle-guard-the-context-window/SKILL.md). Keep raw bulk in children or artifacts and concise findings in the parent.
- [`principle-never-block-on-the-human`](../principle-never-block-on-the-human/SKILL.md). Resolve factual and routine reversible choices yourself while respecting user-owned authority.
- [`principle-encode-lessons-in-structure`](../principle-encode-lessons-in-structure/SKILL.md). Turn recurring corrections into code, tests, scripts, lint, types, or metadata.

## Pi-native subagents

The parent session owns orchestration and decisions.

1. List agents before execution and use only executable, enabled roles.
2. Prefer asynchronous runs. Use a direct single-agent call for one isolated child and `workflowScript` for coordinated sequence or parallelism.
3. Use `scout` for repository reconnaissance, `researcher` for external primary evidence, `context-builder` for durable handoffs, `planner` for larger plans, `oracle` for decision consistency, `worker` for implementation, and `reviewer` for fresh independent checks.
4. Keep one writer in an active worktree. Parallelize read-only research, design, review, and validation. Use managed worktrees only when the repository is clean and the full baseline is tracked.
5. Give every child a goal, cwd, authority boundary, evidence, success criteria, validation, output shape, and stop rules.
6. Review the real diff and artifact yourself. A child report is evidence, not final authority.
7. Escalate product, architecture ownership, scope expansion, publication, release, credential, and destructive decisions.

## Working sequence

1. Select and read the matching playbook.
2. Read the applicable principle and workflow skills.
3. Establish the observable baseline and acceptance contract.
4. Resolve blocking facts before fanout.
5. Use one writer and independent reviewers.
6. Verify on the same surface the user or consumer uses.
7. Inspect the final diff, disposition findings, and report residual risk.

For long or unattended work, use pi-subagents missions and durable artifacts. Load [`show-me-your-work`](../show-me-your-work/SKILL.md) only when the user requested an audit trail or the approved playbook explicitly requires one.

## Writing the reply

Lead with what changed for the user or consumer. Then explain what the next maintainer inherits. Use short direct sentences, concrete paths and commands, real measurements, and explicit residual risks. Do not fabricate citations or report checks you did not run.
