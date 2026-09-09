import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { determineReviewScope, selectReviewMembers } from "./review.ts";

const member = (name: string) => ({ name, model: "provider/model" });

test("review scope activates specialists from changed paths", () => {
	const scope = determineReviewScope(["src/auth/session.ts", "db/query.sql", "docs/api.md"], "");

	assert.deepEqual(scope.specialists, ["security", "reliability", "performance", "api-compatibility"]);
	assert.equal(scope.risk, "high");
});

test("review scope does not activate specialists for an ordinary small change", () => {
	const scope = determineReviewScope(["src/greeting.ts"], "return greeting;");

	assert.deepEqual(scope.specialists, []);
	assert.equal(scope.risk, "low");
});

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

test("review member selection keeps defaults and adds relevant specialists", () => {
	const roster = [
		member("domain-expert"),
		member("correctness"),
		member("design"),
		member("fresh-eyes"),
		member("security"),
		member("reliability"),
		member("performance"),
		member("api-compatibility"),
	];
	const scope = determineReviewScope(["src/auth/session.ts"], "");

	const selected = selectReviewMembers(roster, scope);
	assert.deepEqual(selected.map((member) => member.name), ["domain-expert", "correctness", "design", "fresh-eyes", "security"]);
	assert.equal(selected.some((member) => member.name === "synthesizer"), false);
});
