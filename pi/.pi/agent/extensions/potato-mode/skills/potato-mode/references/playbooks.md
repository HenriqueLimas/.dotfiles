# Potato Mode playbooks

Choose from intent and context. Read the linked skills before acting. A skipped step remains explicit with a reason.

## Investigation

For a read-only question. Load `how`, `why`, or both. Gather evidence, state confidence and gaps, and stop before implementation unless the user authorizes a change.

## Bug fix

Reproduce on the matching surface. Build and eliminate hypotheses until one mechanism survives. Load `principle-fix-root-causes`; use `tdd` when a cheap focused failing test exists. Give the fix to one writer, rerun the original reproduction, and use fresh review.

## Performance issue

Name the metric and capture a baseline. Trace or instrument the real runtime. Change one causal mechanism at a time. Keep only measured improvements and report before and after values.

## Hillclimb

For sustained optimization of one metric, keep one hypothesis per iteration and compare against the baseline. Use the installed autoresearch skills only when the user explicitly authorizes their branch-and-commit workflow. Otherwise run a commit-free local loop within the existing write authority and report each accepted or rejected experiment.

## Runtime forensics

Diagnose a live leak, idle spin, glitch, or runtime symptom. Instrument the running system and return a mechanism with evidence. Do not turn diagnosis into a fix unless requested.

## Trace forensics

Analyze an existing CPU profile, trace, spindump, or heap snapshot. Validate the capture, identify dominant paths and correlations, and separate direct evidence from hypotheses. Return a diagnosis, not an unrequested patch.

## Feature

Name the user outcome, acceptance checks, and core data shape. Load `how`, `principle-model-the-domain`, and `architect` when boundaries are unsettled. Use one worker, verify the real flow, then run fresh correctness and simplicity review.

## Refactoring

Pin current behavior with a test, snapshot, equivalence script, or observed baseline. Name the target shape and reader-load reduction. Subtract first. Migrate internal callers and remove the old API in one authorized wave. Prove equivalence.

## Prototype

State the decision the prototype must settle. Use `arena` for structurally distinct isolated attempts. Compare observed results against a rubric. Keep prototypes disposable until the user authorizes production implementation.

## Visual parity

Define the reference and tolerance. Use `agent-browser` for web or Electron surfaces. Capture comparable viewport, state, fonts, and data. Change one visual mechanism at a time and report image evidence. Coordinates are a last resort.

## Authoring a skill

Follow Pi's Agent Skills format. Write a specific trigger description, keep the core workflow in `SKILL.md`, move optional detail to references, and use Pi-native tools and paths. Reload Pi and confirm the `/skill:<name>` command appears in the interactive command catalog.

## Eval

State the behavior being evaluated, cases, baseline, and scoring rule before changing a skill or prompt. Blind comparisons when possible. Preserve raw outputs outside model context, synthesize results, and promote only measured improvements.

## Babysit

For an explicit PR-status or merge-readiness request. Use `review-pr`, `gh`, and CI evidence. Classify review threads, conflicts, and failures. Fix only when edit authority exists. Do not merge or force-push without explicit authorization.

## Shipping

Green CI is an input, not a verdict. Verify the exact head and real artifact, disposition findings, and confirm repository state. Use `gph` or `create-pr` only when requested. Merge, deploy, publish, and release remain explicit user actions.

## Autonomous run

For one bounded task driven to an observable predicate. Create a mission, use asynchronous subagents, maintain one writer, checkpoint durable artifacts, and continue until VERIFIED, NOT VERIFIED, INCONCLUSIVE, or a user-owned decision blocks progress.

## Orchestrate

For a program that outlives one worker. Use missions, stable unit briefs, durable outputs, rolling asynchronous waves, and one writer per repository or isolated worktree. Use Herdr project panes for substantial cross-project ownership. The parent coordinates and decides; it does not become another parallel writer.

## Autopilot full

For an explicitly authorized queue of independent PRs through merge. One owner per PR, isolated worktrees, independent verification of every exact head, and serial publication authority per repository. Stop at any unapproved merge, release, or destructive decision.

## Autopilot stack

For an explicitly authorized linear stack prepared for the user to land. Keep one stack owner, verify each ordered unit, preserve base relationships, and hand back the reviewed stack. Do not land it unless requested.

## Session pickup

Recover from the active Pi session, mission, branch, and subagent artifacts. Verify live Git and PR state instead of trusting stale summaries. Reconstruct the next predicate and continue with the existing authority boundary.

## Pause safely

Stop spawning new work. Ask active writers for a checkpoint after their current tool returns. Record changed files, validation, remaining work, branch and PR state, run IDs, and user-owned decisions in durable mission artifacts. Do not stop a writer mid-mutation merely to produce a neat pause.

## Multi-phase plan

Define phases as independently verifiable outcomes. Put shared scaffold and baseline capture first. State dependencies and handoff artifacts. Use serial writers and parallel read-only support. Revalidate at every phase boundary.

## Worktree cleanup

Inventory worktrees and classify them as active, merged, abandoned, or unknown. Never infer safety from age alone. Preserve dirty or unpushed work. Use Herdr or `git worktree` removal only after explicit confirmation for destructive cleanup.

## Opening a PR

Use the installed `create-pr` skill. Confirm the intended branch and commits, inspect the final diff, use the repository template, report validation and residual risk, and never bypass hooks or signing.
