import assert from "node:assert/strict";
import test from "node:test";
import { EXA_MCP_ENDPOINT, parseMcpResponse } from "../client.ts";

test("uses Exa's stateless hosted MCP endpoint", () => {
	assert.equal(EXA_MCP_ENDPOINT, "https://mcp.exa.ai/mcp");
});

test("parses a direct JSON-RPC tool result", () => {
	const body = JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		result: { content: [{ type: "text", text: "Result https://example.com" }] },
	});
	assert.equal(parseMcpResponse(body), "Result https://example.com");
});

test("parses a server-sent JSON-RPC tool result", () => {
	const payload = JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		result: { content: [{ type: "text", text: "SSE result" }] },
	});
	assert.equal(parseMcpResponse(`event: message\ndata: ${payload}\n\n`), "SSE result");
});

test("reports MCP errors", () => {
	assert.throws(
		() => parseMcpResponse(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "bad query" } })),
		/Exa MCP error: bad query/,
	);
});
