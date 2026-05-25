#!/usr/bin/env python3
"""
token-cost.py — Full agent cost report with corrected pi-agent pricing.

Usage:
  python3 token-cost.py [daily|weekly|monthly|session] [--since YYYY-MM-DD] [--until YYYY-MM-DD]

Rationale:
  ccusage always reports pi-agent cost as $0 because pi stores cost=0 in its
  JSONL session files (the github-copilot provider has no per-token billing).
  This script re-calculates pi costs from token counts using the same pricing
  rates as Claude Code / ccusage's embedded LiteLLM table, then merges them
  with the real costs ccusage reports for Claude Code and OpenCode.
"""

import json
import os
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta

# ── Pricing (matches ccusage embedded LiteLLM rates) ────────────────────────
PRICING: dict[str, dict[str, float]] = {
    "claude-opus-4-6":   {"input": 15e-6,  "output": 75e-6,  "cacheWrite": 18.75e-6, "cacheRead": 1.5e-6},
    "claude-sonnet-4-6": {"input": 3e-6,   "output": 15e-6,  "cacheWrite": 3.75e-6,  "cacheRead": 0.3e-6},
    "claude-haiku-4-6":  {"input": 0.8e-6, "output": 4e-6,   "cacheWrite": 1e-6,     "cacheRead": 0.08e-6},
    "claude-opus-4":     {"input": 15e-6,  "output": 75e-6,  "cacheWrite": 18.75e-6, "cacheRead": 1.5e-6},
    "claude-sonnet-4":   {"input": 3e-6,   "output": 15e-6,  "cacheWrite": 3.75e-6,  "cacheRead": 0.3e-6},
    "gpt-5.5":           {"input": 5e-6,   "output": 30e-6,  "cacheWrite": 0,         "cacheRead": 0.5e-6},
    "gpt-5.4":           {"input": 5e-6,   "output": 30e-6,  "cacheWrite": 0,         "cacheRead": 0.5e-6},
    "gpt-5.4-mini":      {"input": 0.15e-6,"output": 0.6e-6, "cacheWrite": 0,         "cacheRead": 0.075e-6},
    "gpt-5.1":           {"input": 2e-6,   "output": 8e-6,   "cacheWrite": 0,         "cacheRead": 0.5e-6},
}
# Fallback: treat unknown models as claude-sonnet-4-6
DEFAULT_PRICING = PRICING["claude-sonnet-4-6"]

PI_SESSIONS_DIR = os.path.expanduser("~/.pi/agent/sessions")


# ── Helpers ──────────────────────────────────────────────────────────────────

def model_pricing(raw_model: str) -> dict[str, float]:
    """Match a raw model string to a pricing entry (longest suffix match)."""
    m = raw_model.replace("[1m]", "").strip().lower()
    for key in PRICING:
        if key.lower() in m or m.startswith(key.lower()):
            return PRICING[key]
    # partial match
    for key in PRICING:
        if any(part in m for part in key.lower().split("-")):
            return PRICING[key]
    return DEFAULT_PRICING


def calc_cost(tokens: dict, pricing: dict) -> float:
    return (
        tokens.get("input", 0) * pricing["input"]
        + tokens.get("output", 0) * pricing["output"]
        + tokens.get("cacheRead", 0) * pricing["cacheRead"]
        + tokens.get("cacheWrite", 0) * pricing["cacheWrite"]
    )


def week_start(date_str: str) -> str:
    """Return the ISO date of Monday of the week containing date_str."""
    dt = datetime.strptime(date_str, "%Y-%m-%d").date()
    return (dt - timedelta(days=dt.weekday())).isoformat()


def period_key(iso_ts: str, mode: str) -> str:
    """Convert an ISO timestamp to the grouping key for the given mode."""
    d = iso_ts[:10]  # YYYY-MM-DD
    if mode == "daily":
        return d
    if mode == "monthly":
        return d[:7]
    if mode == "weekly":
        return week_start(d)
    if mode == "session":
        return d  # session mode uses date; session IDs come from filenames
    return d


def fmt_tokens(n: int) -> str:
    if n >= 1_000_000_000:
        return f"{n/1_000_000_000:.2f}B"
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.0f}K"
    return str(n)


def in_range(period: str, since: str | None, until: str | None) -> bool:
    """Check if a period string (YYYY-MM-DD or YYYY-MM) falls within range."""
    # Normalize to comparable prefix
    p = period[:10]
    if since and p < since[:10]:
        return False
    if until and p > until[:10]:
        return False
    return True


# ── Pi session parsing ───────────────────────────────────────────────────────

def parse_pi_sessions(
    mode: str,
    since: str | None,
    until: str | None,
) -> dict[str, dict]:
    """
    Parse pi JSONL session files and return:
      period -> {
        input, output, cacheRead, cacheWrite, cost, total,
        models: set[str]
      }
    For session mode, period = session_id.
    """
    if not os.path.isdir(PI_SESSIONS_DIR):
        return {}

    results: dict[str, dict] = defaultdict(lambda: {
        "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,
        "cost": 0.0, "total": 0, "models": set(),
    })

    for root, _dirs, files in os.walk(PI_SESSIONS_DIR):
        for fname in sorted(files):
            if not fname.endswith(".jsonl"):
                continue

            # filename: 2026-05-04T17-49-06-826Z_<sid>.jsonl
            parts = fname.replace(".jsonl", "").split("_", 1)
            file_date = parts[0][:10]  # YYYY-MM-DD (from filename)
            session_id = parts[1] if len(parts) > 1 else "unknown"

            fpath = os.path.join(root, fname)
            try:
                with open(fpath) as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            obj = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        if obj.get("type") != "message":
                            continue
                        msg = obj.get("message", {})
                        if msg.get("role") != "assistant":
                            continue

                        # Determine period
                        ts = obj.get("timestamp", file_date + "T00:00:00Z")
                        if mode == "session":
                            period = session_id
                        else:
                            period = period_key(ts[:10], mode)

                        if not in_range(period, since, until):
                            continue

                        raw_model = msg.get("model", "unknown")
                        pricing = model_pricing(raw_model)
                        usage = msg.get("usage", {})

                        inp = usage.get("input", 0)
                        out = usage.get("output", 0)
                        cr  = usage.get("cacheRead", 0)
                        cw  = usage.get("cacheWrite", 0)

                        cost = calc_cost(
                            {"input": inp, "output": out, "cacheRead": cr, "cacheWrite": cw},
                            pricing,
                        )

                        r = results[period]
                        r["input"]     += inp
                        r["output"]    += out
                        r["cacheRead"] += cr
                        r["cacheWrite"] += cw
                        r["cost"]      += cost
                        r["total"]     += inp + out + cr + cw
                        r["models"].add(raw_model.replace("[1m]", "").strip())

            except OSError:
                pass

    return results


# ── ccusage fetching ─────────────────────────────────────────────────────────

def fetch_ccusage(mode: str, since: str | None, until: str | None) -> dict[str, dict]:
    """
    Run `pnpx ccusage <mode> --json` (excluding pi) and return:
      period -> { input, output, cacheRead, cacheWrite, cost, total, agents: set }
    """
    cmd = ["pnpx", "ccusage", mode, "--json"]
    if since:
        cmd += ["--since", since]
    if until:
        cmd += ["--until", until]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        raw = proc.stdout.strip()
        if not raw:
            return {}
        data = json.loads(raw)
    except Exception as e:
        print(f"[warn] ccusage failed: {e}", file=sys.stderr)
        return {}

    # Find the list key (daily/weekly/monthly/sessions)
    list_key = next(
        (k for k in data if isinstance(data[k], list) and k != "totals"),
        None,
    )
    if not list_key:
        return {}

    results: dict[str, dict] = defaultdict(lambda: {
        "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,
        "cost": 0.0, "total": 0, "agents": set(),
    })

    for entry in data[list_key]:
        # Determine period key from entry fields
        period = (
            entry.get("period")
            or entry.get("date")
            or entry.get("month")
            or entry.get("week")
            or entry.get("sessionId")
            or "unknown"
        )

        agents = entry.get("metadata", {}).get("agents", [])
        # Skip pi entries (cost=$0 anyway; we handle pi ourselves)
        non_pi_agents = [a for a in agents if a != "pi-agent"]
        if not non_pi_agents and agents:
            continue  # pure pi entry, skip

        r = results[period]
        r["input"]      += entry.get("inputTokens", 0)
        r["output"]     += entry.get("outputTokens", 0)
        r["cacheRead"]  += entry.get("cacheReadTokens", 0)
        r["cacheWrite"] += entry.get("cacheCreationTokens", 0)
        r["cost"]       += entry.get("totalCost", 0.0)
        r["total"]      += entry.get("totalTokens", 0)
        for a in non_pi_agents:
            r["agents"].add(a)

    return results


# ── Table rendering ──────────────────────────────────────────────────────────

def render_table(
    mode: str,
    ccusage_data: dict[str, dict],
    pi_data: dict[str, dict],
) -> None:
    all_periods = sorted(set(ccusage_data.keys()) | set(pi_data.keys()))

    if not all_periods:
        print("No data found.")
        return

    label = "Period" if mode != "session" else "Session/Date"

    # Column widths
    W = {"period": 14, "agents": 18, "input": 10, "output": 10,
         "cw": 11, "cr": 13, "total": 13, "cc_cost": 11, "pi_cost": 11, "total_cost": 12}

    header = (
        f"{'Period':<{W['period']}} {'Agents':<{W['agents']}} "
        f"{'Input':>{W['input']}} {'Output':>{W['output']}} "
        f"{'CacheWrite':>{W['cw']}} {'CacheRead':>{W['cr']}} "
        f"{'Total':>{W['total']}} {'CC+OC Cost':>{W['cc_cost']}} "
        f"{'Pi Cost':>{W['pi_cost']}} {'Total Cost':>{W['total_cost']}}"
    )
    sep = "─" * len(header)

    print()
    print(f"  Agent Cost Report — {mode.capitalize()}")
    print(f"  Pi costs recalculated using Claude/OpenAI pricing rates")
    print()
    print(sep)
    print(header)
    print(sep)

    grand = {k: 0 for k in ["input", "output", "cw", "cr", "total"]}
    grand_cc = 0.0
    grand_pi = 0.0

    for period in all_periods:
        cc  = ccusage_data.get(period, {})
        pi  = pi_data.get(period, {})

        inp   = cc.get("input", 0)   + pi.get("input", 0)
        out   = cc.get("output", 0)  + pi.get("output", 0)
        cw    = cc.get("cacheWrite", 0) + pi.get("cacheWrite", 0)
        cr    = cc.get("cacheRead", 0)  + pi.get("cacheRead", 0)
        total = cc.get("total", 0)   + pi.get("total", 0)

        cc_cost = cc.get("cost", 0.0)
        pi_cost = pi.get("cost", 0.0)
        row_cost = cc_cost + pi_cost

        agents: set[str] = set(cc.get("agents", set()))
        if pi.get("total", 0) > 0:
            agents.add("pi")
        agents_str = "+".join(sorted(agents)) if agents else "-"
        agents_str = agents_str[:W["agents"]]

        print(
            f"{period:<{W['period']}} {agents_str:<{W['agents']}} "
            f"{fmt_tokens(inp):>{W['input']}} {fmt_tokens(out):>{W['output']}} "
            f"{fmt_tokens(cw):>{W['cw']}} {fmt_tokens(cr):>{W['cr']}} "
            f"{fmt_tokens(total):>{W['total']}} ${cc_cost:>{W['cc_cost']-1}.2f} "
            f"${pi_cost:>{W['pi_cost']-1}.2f} ${row_cost:>{W['total_cost']-1}.2f}"
        )

        grand["input"] += inp
        grand["output"] += out
        grand["cw"]    += cw
        grand["cr"]    += cr
        grand["total"] += total
        grand_cc       += cc_cost
        grand_pi       += pi_cost

    grand_total = grand_cc + grand_pi
    print(sep)
    print(
        f"{'TOTAL':<{W['period']}} {'':<{W['agents']}} "
        f"{fmt_tokens(grand['input']):>{W['input']}} {fmt_tokens(grand['output']):>{W['output']}} "
        f"{fmt_tokens(grand['cw']):>{W['cw']}} {fmt_tokens(grand['cr']):>{W['cr']}} "
        f"{fmt_tokens(grand['total']):>{W['total']}} ${grand_cc:>{W['cc_cost']-1}.2f} "
        f"${grand_pi:>{W['pi_cost']-1}.2f} ${grand_total:>{W['total_cost']-1}.2f}"
    )
    print(sep)

    print()
    print(f"  Claude Code + OpenCode: ${grand_cc:>10.2f}")
    print(f"  Pi (recalculated):      ${grand_pi:>10.2f}")
    print(f"  ─────────────────────────────────")
    print(f"  GRAND TOTAL:            ${grand_total:>10.2f}")
    print()
    print("  Pricing used for pi:")
    for model, p in sorted(PRICING.items()):
        print(f"    {model:<28}  in=${p['input']*1e6:.2f}  out=${p['output']*1e6:.2f}  "
              f"cacheR=${p['cacheRead']*1e6:.3f}  cacheW=${p['cacheWrite']*1e6:.3f}  (per MTok)")
    print()


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    args = sys.argv[1:]

    # Parse mode
    valid_modes = {"daily", "weekly", "monthly", "session"}
    mode = "daily"
    since: str | None = None
    until: str | None = None

    i = 0
    while i < len(args):
        a = args[i]
        if a in valid_modes:
            mode = a
        elif a in ("--since", "-s") and i + 1 < len(args):
            i += 1
            since = args[i].replace("/", "-")
        elif a in ("--until", "-u") and i + 1 < len(args):
            i += 1
            until = args[i].replace("/", "-")
        elif a in ("--help", "-h"):
            print(__doc__)
            sys.exit(0)
        i += 1

    # ccusage doesn't support weekly for pi, so we always parse pi ourselves
    print(f"Fetching ccusage {mode} data...", file=sys.stderr)
    cc_data = fetch_ccusage(mode, since, until)

    print(f"Parsing pi session files from {PI_SESSIONS_DIR}...", file=sys.stderr)
    pi_data = parse_pi_sessions(mode, since, until)

    render_table(mode, cc_data, pi_data)


if __name__ == "__main__":
    main()
