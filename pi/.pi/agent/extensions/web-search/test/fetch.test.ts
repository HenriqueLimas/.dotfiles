import assert from "node:assert/strict";
import test from "node:test";
import { convertHtmlToMarkdown, extractTextFromHtml } from "../fetch.ts";

const html = `
<!doctype html>
<html>
<head><title>Example</title><script>ignore()</script><style>.hidden {}</style></head>
<body>
  <h1>Heading</h1>
  <p>Hello <a href="https://example.com/docs">docs</a>.</p>
  <ul><li>First</li><li>Second</li></ul>
  <table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>Pi</td></tr></tbody></table>
  <iframe>unsafe</iframe>
</body>
</html>`;

test("extracts readable text and strips embedded content", () => {
	const text = extractTextFromHtml(html);
	assert.match(text, /Heading/);
	assert.match(text, /Hello docs\./);
	assert.doesNotMatch(text, /ignore|hidden|unsafe/);
});

test("converts HTML to Markdown with headings, links, lists, and tables", () => {
	const markdown = convertHtmlToMarkdown(html);
	assert.match(markdown, /^# Heading/m);
	assert.match(markdown, /\[docs\]\(https:\/\/example\.com\/docs\)/);
	assert.match(markdown, /-\s+First/);
	assert.match(markdown, /\| Name \|/);
	assert.doesNotMatch(markdown, /ignore|hidden|unsafe/);
});
