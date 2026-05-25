---
name: token-cost
description: Full agent cost report combining Claude Code, OpenCode, and pi-agent (with corrected pi pricing). Use when the user invokes "skill:token-cost", "token-cost", or asks for a total cost/token usage report across all agents. Accepts grouping modes (daily, weekly, monthly, session) and optional --since / --until date filters.
---

# Token Cost (`skill:token-cost`)

Generates a unified cost table across **Claude Code**, **OpenCode**, and **pi-agent**.

## Why this exists

`pnpx ccusage` always shows pi-agent cost as **$0.00** because pi stores
`cost: 0` in its JSONL session files (the `github-copilot` provider has no
per-token billing info at write time). This skill re-calculates pi costs from
raw token counts using the same LiteLLM pricing rates that ccusage uses for
Claude Code, then merges them into a single table.

## Usage

```
skill:token-cost [daily|weekly|monthly|session] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
```

Default mode: `daily`

### Examples

| Invocation | What it does |
|---|---|
| `skill:token-cost` | Daily breakdown, all time |
| `skill:token-cost daily` | Same as above |
| `skill:token-cost weekly` | Group by calendar week (Monday-based) |
| `skill:token-cost monthly` | Group by month |
| `skill:token-cost session` | Group by individual pi session (date-sorted) |
| `skill:token-cost daily --since 2026-05-01` | Daily from May 1 onwards |
| `skill:token-cost daily --since 2026-05-01 --until 2026-05-31` | May only |

## Steps

### 1. Parse the user's request

Extract:
- **mode** — one of `daily`, `weekly`, `monthly`, `session` (default: `daily`)
- **--since** — optional start date (`YYYY-MM-DD`)
- **--until** — optional end date (`YYYY-MM-DD`)

### 2. Run the script

```bash
python3 /Users/hlimas/.agents/skills/token-cost/scripts/token-cost.py <mode> [--since <date>] [--until <date>]
```

The script:
1. Calls `pnpx ccusage <mode> --json [--since ...] [--until ...]` to get real Claude Code + OpenCode costs
2. Parses `~/.pi/agent/sessions/**/*.jsonl` directly, grouping assistant messages by the requested period
3. Applies model-specific pricing to pi token counts
4. Merges both data sources and renders the table

### 3. Present the output

Show the table as-is. Optionally call out:
- The most expensive day/week/session
- Which agent dominates spend
- Any unusually large cache-read sessions (usually the biggest cost driver for pi)

## Pricing reference (per million tokens)

| Model | Input | Output | Cache Read | Cache Write |
|---|---|---|---|---|
| claude-opus-4-6 | $15.00 | $75.00 | $1.500 | $18.750 |
| claude-sonnet-4-6 | $3.00 | $15.00 | $0.300 | $3.750 |
| claude-haiku-4-6 | $0.80 | $4.00 | $0.080 | $1.000 |
| gpt-5.5 | $5.00 | $30.00 | $0.500 | — |
| gpt-5.4 | $5.00 | $30.00 | $0.500 | — |
| gpt-5.1 | $2.00 | $8.00 | $0.500 | — |

Unknown models fall back to claude-sonnet-4-6 pricing.

## Output columns

| Column | Description |
|---|---|
| Period | Date / week-start / month / session-id |
| Agents | Which agents contributed (claude, opencode, pi) |
| Input | Input tokens (K/M/B abbreviated) |
| Output | Output tokens |
| CacheWrite | Cache creation tokens |
| CacheRead | Cache read tokens |
| Total | Sum of all token types |
| CC+OC Cost | Claude Code + OpenCode cost (from ccusage) |
| Pi Cost | Pi cost (recalculated from tokens × pricing) |
| Total Cost | Combined cost |

## Edge cases

| Situation | Behaviour |
|---|---|
| `weekly` mode — pi has no `ccusage pi weekly` | Script parses pi files directly by week; no issue |
| `session` mode | Pi sessions grouped by session ID; CC/OC entries grouped by their period field |
| pi sessions dir missing | Script warns and shows only CC/OC data |
| ccusage not installed / fails | Script warns and shows only pi data |
| Mixed agents on same day | Both appear in the Agents column separated by `+` |
