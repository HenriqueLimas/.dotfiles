---
name: blast-radius
description: Find what a change could break outside its diff and prove the key safety assumptions by running real code. Use for blast-radius questions, risky small diffs, and pre-ship impact checks.
disable-model-invocation: true
---

# Blast radius

Caller lists are the start, not the result. Find hidden contracts and prove the facts that make the change safe.

## Workflow

1. Read the diff and name the behavior that changed.
2. Trace direct callers, transitive data flow, serialized formats, database fields, flags, cross-language consumers, lifecycle timing, pinned dependency behavior, and local patches.
3. Identify the one or two facts on which safety depends.
4. For wide changes, use fresh `scout` or `reviewer` lanes with distinct areas. Keep them read-only and reconcile their findings against source.
5. Rank each risk by likelihood and cost. Cite exact code or primary dependency source.
6. Prove the central safety fact with the cheapest real script, test, recorded baseline, or running-app reproduction. Mark anything short of execution as unproven.

## Output

- What changed
- The safety fact and proof level
- Confirmed risks
- Cleared risks
- Unproven assumptions
- Cheapest before-merge check

Do not replace proof with a convincing narrative.
