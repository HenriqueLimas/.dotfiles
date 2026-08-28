import assert from "node:assert/strict";
import test from "node:test";
import { findBlockedFlag } from "./policies.ts";

test("hard-deny policy catches repository safeguard bypasses", () => {
	assert.equal(findBlockedFlag("git commit --no-verify"), "--no-verify");
	assert.equal(findBlockedFlag("git commit --no-gpg-sign"), "--no-gpg-sign");
	assert.equal(findBlockedFlag("git status"), undefined);
	assert.equal(findBlockedFlag("tool --no-verify"), undefined);
});
