import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	DEFAULT_BORA_MAX_RESULT_CHARS,
	DEFAULT_BORA_MODEL,
	loadBoraConfigFrom,
	parseBoraConfig,
} from "./config.ts";

test("missing config uses the Luna defaults", () => {
	const config = parseBoraConfig({});
	assert.equal(config.model, DEFAULT_BORA_MODEL);
	assert.equal(config.maxResultChars, DEFAULT_BORA_MAX_RESULT_CHARS);
	assert.equal(config.thinkingLevel, undefined);
});

test("valid model and thinking level values are normalized", () => {
	assert.deepEqual(parseBoraConfig({ model: "  provider/model  ", thinkingLevel: "high", maxResultChars: 12_000 }), {
		model: "provider/model",
		thinkingLevel: "high",
		maxResultChars: 12_000,
	});
});

test("malformed JSON is rejected with the config path", async () => {
	const dir = await mkdtemp(join(tmpdir(), "bora-config-"));
	const path = join(dir, "bora.json");
	try {
		await writeFile(path, "{", "utf8");
		await assert.rejects(loadBoraConfigFrom(path), /Invalid JSON/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("missing files fall back to defaults", async () => {
	const config = await loadBoraConfigFrom(join(tmpdir(), "bora-config-does-not-exist", "bora.json"));
	assert.equal(config.model, DEFAULT_BORA_MODEL);
});

test("unknown keys are rejected", () => {
	assert.throws(() => parseBoraConfig({ thinkngLevel: "high" }), /Unknown Bora config key/);
});

test("invalid thinking levels are rejected", () => {
	assert.throws(() => parseBoraConfig({ thinkingLevel: "turbo" }), /thinkingLevel/);
});

test("invalid result limits are rejected", () => {
	assert.throws(() => parseBoraConfig({ maxResultChars: 0 }), /maxResultChars/);
	assert.throws(() => parseBoraConfig({ maxResultChars: 1.5 }), /maxResultChars/);
	assert.throws(() => parseBoraConfig({ maxResultChars: 100_001 }), /maxResultChars/);
});
