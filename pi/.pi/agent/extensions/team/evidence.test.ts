import assert from "node:assert/strict";
import test from "node:test";
import { neutralizeControlCharacters } from "./evidence.ts";

test("escape sequences in review evidence become visible caret notation", () => {
	const diff = "+expect(output).toBe(\"\u001b[31mred\u001b[0m\");";
	assert.equal(neutralizeControlCharacters(diff), "+expect(output).toBe(\"^[[31mred^[[0m\");");
});

test("C1 controls, DEL, and NUL are neutralized", () => {
	assert.equal(neutralizeControlCharacters("a\u009b31mb\u007fc\u0000"), "a\\u009b31mb^?c^@");
});

test("tabs, newlines, carriage returns, and printable Unicode are preserved", () => {
	const diff = "@@ -1 +1 @@\n-\told\r\n+\tnew ✓ ção\n";
	assert.equal(neutralizeControlCharacters(diff), diff);
});
