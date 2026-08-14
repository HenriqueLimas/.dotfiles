# Potato Mode

A sticky Pi engineering mode inspired by [pstack's Poteto Mode](https://github.com/cursor/plugins/tree/main/pstack), adapted to Pi's native extension and subagent model.

## Usage

```text
/potato-mode
/potato-mode implement a cached repository index
/potato-mode status
/potato-mode off
```

`/potato-mode <task>` enables the mode and sends the task to the active Pi session. The extension tells the active model to read the `potato-mode` router skill. That skill selects a playbook from intent and context, then reads linked workflow and principle skills. The mode remains enabled on the active session branch across turns, reloads, compaction, and resume until disabled.

You can also disable it with a plain message such as `turn off potato mode`.

The footer shows whether the mode and Pi's `subagent` tool are active:

```text
🥔 active · subagents
```

## Pi-native design

The extension itself only stores sticky state, displays status, and tells Pi to load the `potato-mode` skill. The skill and its references are the single source of behavior.

Potato Mode keeps pstack's core intent:

- understand before changing
- name the outcome and data shape
- subtract before adding abstractions
- fix root causes
- keep work in verifiable units
- prove the real artifact
- use independent review
- write concise, direct summaries

Cursor-specific mechanisms are intentionally not ported. The extension does not emulate Cursor Task calls, MCP routing, cloud agents, loop commands, or approval APIs.

Delegation uses Pi's installed `pi-subagents` package:

- `scout` for local reconnaissance
- `researcher` for external evidence
- `context-builder` for durable handoffs
- `planner` for larger implementation plans
- `oracle` for decision consistency
- `worker` as the sole writer
- `reviewer` for fresh adversarial review
- `workflowScript` for coordinated waves
- missions and Herdr project panes for durable or cross-project programs

The parent Pi session remains the decision-maker and reviews both child output and the actual repository.

The original pstack skill files are not loaded directly because they call Cursor-specific task, model-rule, MCP, cloud-agent, and loop APIs. The bundled skills preserve their engineering workflows but express orchestration through Pi and `pi-subagents`.

## Skills

Potato Mode exposes 40 explicit `/skill:*` commands, but all are hidden from automatic model invocation. Disabled Potato Mode adds no skill descriptions to ordinary prompts. When enabled, the extension injects the exact path of the `potato-mode` router; the router then reads linked workflow and principle files as needed.

The `potato-mode` skill owns semantic routing, authority, delegation, and the reply contract. Its playbook reference covers investigation, bugs, performance, hillclimbing, forensics, features, refactoring, prototypes, visual parity, skill authoring, evals, PR work, autonomous programs, session handoff, worktree cleanup, and PR creation.

Workflow skills:

- `how`
- `why`
- `architect`
- `arena`
- `swarm`
- `interrogate`
- `blast-radius`
- `figure-it-out`
- `no-comments`
- `unslop`
- `technical-writing`
- `show-me-your-work`
- `reflect`

The 21 `principle-*` leaf skills preserve pstack's progressive-disclosure design. Potato Mode reads only the principles that apply instead of flattening them into the extension prompt.

Additional guidance:

- `typescript-best-practices`
- `create-verification-skill`
- `maintain-verification-skill`
- `tdd`
- `teach`

The existing global `tdd` and `teach` skills were moved into Potato Mode so they no longer affect ordinary sessions. The mode continues to reuse global `domain-modeling`, `improve-codebase-architecture`, `gph`, `create-pr`, `review-pr`, and autoresearch because those names do not overlap pstack skills.

## Playbooks

The mode describes these playbook intents:

- investigation
- bug fix
- performance
- feature
- refactoring
- prototype
- review
- shipping
- program-scale orchestration
- general rigorous work

There is no keyword classifier. The active Pi model chooses semantically and follows the relevant skills.
