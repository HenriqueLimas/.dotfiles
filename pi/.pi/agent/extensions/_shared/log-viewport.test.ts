import assert from "node:assert/strict";
import test from "node:test";
import { LogViewport } from "./log-viewport.ts";

function lines(viewport: LogViewport) {
	const range = viewport.range();
	return Array.from({ length: range.end - range.start }, (_, index) => range.start + index + 1);
}

test("initial view starts at the bottom", () => {
	const viewport = new LogViewport();
	viewport.setContent(40, 12);

	assert.deepEqual(lines(viewport), [29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40]);
	assert.equal(viewport.getOffsetFromBottom(), 0);
	assert.equal(viewport.range().hasAbove, true);
	assert.equal(viewport.range().hasBelow, false);
});

test("Page Up reveals older lines", () => {
	const viewport = new LogViewport();
	viewport.setContent(40, 12);

	viewport.pageUp();

	assert.deepEqual(lines(viewport), [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
	assert.equal(viewport.range().hasBelow, true);
});

test("Page Down returns toward the bottom", () => {
	const viewport = new LogViewport();
	viewport.setContent(40, 12);
	viewport.pageUp();
	viewport.pageUp();
	viewport.pageDown();

	assert.deepEqual(lines(viewport), [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
});

test("excess Page Up clamps instead of producing a blank pane", () => {
	const viewport = new LogViewport();
	viewport.setContent(20, 12);

	for (let index = 0; index < 20; index++) viewport.pageUp();

	assert.deepEqual(lines(viewport), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
	assert.equal(viewport.range().hasAbove, false);
});

test("new lines auto-follow at the bottom", () => {
	const viewport = new LogViewport();
	viewport.setContent(20, 12);
	viewport.setContent(25, 12);

	assert.deepEqual(lines(viewport), [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
});

test("new lines do not displace the viewed region while scrolled up", () => {
	const viewport = new LogViewport();
	viewport.setContent(40, 12);
	viewport.pageUp();
	const before = lines(viewport);

	viewport.setContent(45, 12);

	assert.deepEqual(lines(viewport), before);
	assert.equal(viewport.range().hasBelow, true);
});

test("reset returns to the newest content", () => {
	const viewport = new LogViewport();
	viewport.setContent(40, 12);
	viewport.pageUp();
	viewport.reset();

	assert.deepEqual(lines(viewport), [29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40]);
	assert.equal(viewport.range().hasBelow, false);
});
