import assert from "node:assert/strict";
import test from "node:test";
import { parseToolSafetyConfig, resolveToolRule } from "./config.ts";

const validConfig = {
	reviewers: {
		luna: { provider: "openai-codex", model: "gpt-5.6-luna" },
	},
	tools: {
		"*": { reviewer: "luna" },
		read: false,
	},
};

test("config applies safe defaults and resolves wildcard rules", () => {
	const config = parseToolSafetyConfig(validConfig);
	assert.equal(config.enabled, true);
	assert.equal(config.failureMode, "block");
	assert.equal(config.reviewers.luna.thinkingLevel, "low");
	assert.equal(resolveToolRule(config, "bash")?.reviewer, "luna");
	assert.equal(resolveToolRule(config, "read"), undefined);
});

test("config rejects unknown fields", () => {
	assert.throws(
		() => parseToolSafetyConfig({ ...validConfig, typo: true }),
		/tool-safety config\.typo is not supported/,
	);
});

test("config rejects tool rules that reference missing reviewers", () => {
	assert.throws(
		() =>
			parseToolSafetyConfig({
				reviewers: validConfig.reviewers,
				tools: { bash: { reviewer: "missing" } },
			}),
		/references unknown reviewer missing/,
	);
});

test("config supports a different model for each tool", () => {
	const config = parseToolSafetyConfig({
		reviewers: {
			luna: { provider: "openai-codex", model: "gpt-5.6-luna", thinkingLevel: "low" },
			local: { provider: "ollama", model: "qwen3.8:27b", thinkingLevel: "medium" },
		},
		tools: {
			bash: { reviewer: "luna" },
			write: { reviewer: "local", policy: "Only write inside the workspace." },
		},
	});
	assert.equal(config.reviewers[resolveToolRule(config, "bash")!.reviewer].model, "gpt-5.6-luna");
	assert.equal(config.reviewers[resolveToolRule(config, "write")!.reviewer].model, "qwen3.8:27b");
});
