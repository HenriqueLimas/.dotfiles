import assert from "node:assert/strict";
import test from "node:test";
import {
	assertDomainAllowed,
	domainMatches,
	isUnsafeAddress,
	normalizeDomain,
	normalizeSourceUrl,
	validatePublicUrl,
	validateReference,
} from "../security.ts";

const unrestricted = { allowedDomains: [], blockedDomains: [] };

test("normalizes domains and source URLs", () => {
	assert.equal(normalizeDomain("*.Docs.Example.COM."), "docs.example.com");
	assert.equal(
		normalizeSourceUrl("https://Example.com/a?utm_source=test&x=1#section"),
		"https://example.com/a?x=1",
	);
});

test("matches a domain and its subdomains only", () => {
	assert.equal(domainMatches("docs.example.com", "example.com"), true);
	assert.equal(domainMatches("notexample.com", "example.com"), false);
});

test("enforces allowed and blocked domain policy", () => {
	const policy = { allowedDomains: ["example.com"], blockedDomains: ["private.example.com"] };
	assert.doesNotThrow(() => assertDomainAllowed("docs.example.com", policy));
	assert.throws(() => assertDomainAllowed("private.example.com", policy), /blocked/);
	assert.throws(() => assertDomainAllowed("example.org", policy), /not allowed/);
});

test("classifies unsafe IP ranges", () => {
	for (const address of [
		"127.0.0.1",
		"10.0.0.1",
		"169.254.1.1",
		"192.168.1.1",
		"::1",
		"::ffff:7f00:1",
		"fd00::1",
		"fe80::1",
	]) {
		assert.equal(isUnsafeAddress(address), true, address);
	}
	assert.equal(isUnsafeAddress("8.8.8.8"), false);
	assert.equal(isUnsafeAddress("2606:4700:4700::1111"), false);
});

test("rejects unsafe direct URLs before network access", async () => {
	await assert.rejects(validatePublicUrl("file:///etc/passwd", unrestricted), /Unsafe URL scheme/);
	await assert.rejects(validatePublicUrl("http://127.0.0.1/admin", unrestricted), /not allowed/);
	await assert.rejects(validatePublicUrl("http://[::1]/admin", unrestricted), /not allowed/);
	await assert.rejects(validatePublicUrl("https://user:pass@example.com", unrestricted), /credentials/);
});

test("validates opaque page references", () => {
	assert.equal(validateReference("turn0search1"), "turn0search1");
	assert.throws(() => validateReference("../../secret"), /Invalid page reference/);
});
