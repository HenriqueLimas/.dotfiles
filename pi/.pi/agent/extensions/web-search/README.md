# Pi web tools extension

Adds two provider-independent tools to pi:

- `websearch` — searches the web through Exa's public hosted MCP endpoint
- `webfetch` — securely fetches a specific page as Markdown or plain text

No Codex login and no general MCP support are required. `websearch` sends a stateless JSON-RPC `tools/call` request over ordinary HTTP, matching OpenCode's simple integration model. Exa's public endpoint works without authentication; `EXA_API_KEY` is used when present.

## Usage

Run `/reload` after changing the extension, then ask pi to search or fetch naturally. `websearch` and `webfetch` are model-callable tools, not slash commands, so `/websearch` is not expected to appear in command completion.

## Optional configuration

Use an Exa key if desired:

```sh
export EXA_API_KEY="..."
```

Restrict page fetching to selected public domains:

```sh
export PI_WEB_ALLOWED_DOMAINS="docs.example.com,example.org"
export PI_WEB_BLOCKED_DOMAINS="social.example"
```

## Security and behavior

`websearch` has a 25-second timeout, three transient retries, a 256 KB response limit, and a 500 ms request interval.

`webfetch`:

- allows only HTTP and HTTPS
- rejects credentials in URLs, localhost, private/link-local/reserved IPs, and mixed unsafe DNS answers
- pins the validated public address during each request to prevent DNS rebinding
- checks robots.txt and honors crawl delay
- validates every redirect, with a maximum of five
- retries transient network, 429, and 5xx failures
- has a 5 MB download limit and a 48 KB model-output limit
- accepts only textual response types
- removes scripts, styles, trackers, iframes, objects, embeds, and SVG content
- converts HTML to readable Markdown while preserving headings, lists, code, links, and GFM tables

Both tools cache identical calls for the current pi session. Their output is marked as untrusted external data, and the extension instructs the model to place Markdown citations next to supported claims.

## External dependency

Web search always needs access to a hosted search index. This extension depends on Exa for discovery, but not on the selected model provider or its OAuth session. Page retrieval remains local.
