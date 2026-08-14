---
name: reflect
description: Extract durable lessons from a completed or difficult session and route them to existing skills, tests, scripts, checks, or backlog items. Use when the user asks to reflect or a repeatable workflow emerged.
disable-model-invocation: true
---

# Reflect

Capture only lessons that generalize. One-off facts do not become permanent instructions.

## Workflow

1. Write a compact evidence digest from the active conversation. Include the request, important decisions, failed paths, corrections, changed files, and validation. Do not inspect session storage or unrelated transcripts.
2. List available subagents. Pass the digest to fresh read-only reviewers in one `workflowScript` with distinct lenses: judgment, tooling and enforcement, and divergent alternatives.
3. Ask reviewers for evidence-backed lessons, failed approaches, missing guardrails, and existing skills that should have triggered.
4. Synthesize Accepted, Rejected, and Backlog groups. Reject preferences without repeated evidence.
5. Prefer structural enforcement. A test, lint rule, script, metadata field, or runtime check beats another instruction paragraph.
6. Present proposed permanent changes and wait for explicit approval before editing global or shared skills.
7. Apply approved edits narrowly and validate every changed `SKILL.md` by reloading Pi or running the available skill validator.

Report applied edits, structural checks, backlog, and rejected lessons with reasons.
