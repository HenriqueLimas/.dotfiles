# Tool safety guard

This pi extension applies deterministic hard-deny rules first, then sends configured tool calls to a separate model for synchronous safety review. The reviewer intervenes only for calls with a concrete, plausible high-risk effect on the machine, credentials, security boundaries, or broadly valuable data; normal low- and moderate-risk development activity is allowed by default.

Configuration lives at `~/.pi/agent/tool-safety.json`. Run `/reload` after changing it.

## Configuration

`reviewers` names available pi models. Each `tools` entry selects one reviewer, so different tools can use different providers or models:

```json
{
  "enabled": true,
  "reviewers": {
    "fast": {
      "provider": "openai-codex",
      "model": "gpt-5.6-luna",
      "thinkingLevel": "low"
    },
    "local": {
      "provider": "ollama",
      "model": "qwen3.8:27b",
      "thinkingLevel": "medium"
    }
  },
  "tools": {
    "bash": { "reviewer": "fast" },
    "write": { "reviewer": "local", "policy": "Only write inside the workspace." }
  },
  "failureMode": "block"
}
```

Use `"*"` as the fallback tool name. Set an exact tool entry to `false` to exempt it from a wildcard rule:

```json
{
  "tools": {
    "*": { "reviewer": "fast" },
    "read": false
  }
}
```

`failureMode` accepts `block` or `ask`. `ask` still blocks when pi has no interactive UI. Invalid configuration blocks tool execution until fixed. A missing config file disables model review but keeps deterministic hard-deny rules active.

The extension currently hard-blocks Git `--no-verify` and `--no-gpg-sign` regardless of model output or configuration. These deterministic repository safeguards remain active even when model review is disabled or the configuration is missing.
