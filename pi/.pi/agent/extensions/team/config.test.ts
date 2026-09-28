import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

test("review config has no auto synthesis setting or child synthesizer", async () => {
	const [configSource, config] = await Promise.all([
		readFile(new URL("./config.ts", import.meta.url), "utf8"),
		readFile(new URL("../../team.json", import.meta.url), "utf8").then((source) => JSON.parse(source)),
	]);
	const removedSetting = "auto" + "Synthesize";
	assert.doesNotMatch(configSource, new RegExp(removedSetting));
	assert.equal(removedSetting in config, false);
	assert.equal(config.reviewModels.some((member: { name: string }) => member.name === "synthesizer"), false);
});
