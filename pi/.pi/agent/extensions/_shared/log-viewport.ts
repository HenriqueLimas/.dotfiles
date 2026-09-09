export const LOG_VIEWPORT_PAGE_SIZE = 8;

export interface LogViewportRange {
	/** Zero-based index of the first visible wrapped line. */
	start: number;
	/** Exclusive zero-based index of the last visible wrapped line. */
	end: number;
	total: number;
	offsetFromBottom: number;
	hasAbove: boolean;
	hasBelow: boolean;
}

/**
 * Keeps a fixed-height view over a growing list of wrapped log lines.
 *
 * The public position is an offset from the bottom. While the user is at the
 * bottom, content changes follow the newest line. Once the user scrolls up,
 * updates preserve the first visible line whenever the content still contains
 * it.
 */
export class LogViewport {
	private totalLines = 0;
	private viewportLines = 1;
	private offsetFromBottom = 0;

	setContent(totalLines: number, viewportLines: number): void {
		const previousStart = this.range().start;
		const wasAtBottom = this.offsetFromBottom === 0;
		this.totalLines = Math.max(0, Math.floor(totalLines));
		this.viewportLines = Math.max(1, Math.floor(viewportLines));

		if (wasAtBottom) {
			this.offsetFromBottom = 0;
		} else {
			this.offsetFromBottom = this.totalLines - this.viewportLines - previousStart;
		}
		this.clamp();
	}

	scrollUp(lines = 1): boolean {
		const before = this.offsetFromBottom;
		this.offsetFromBottom += Math.max(1, Math.floor(lines));
		this.clamp();
		return this.offsetFromBottom !== before;
	}

	scrollDown(lines = 1): boolean {
		const before = this.offsetFromBottom;
		this.offsetFromBottom -= Math.max(1, Math.floor(lines));
		this.clamp();
		return this.offsetFromBottom !== before;
	}

	pageUp(lines = LOG_VIEWPORT_PAGE_SIZE): boolean {
		return this.scrollUp(lines);
	}

	pageDown(lines = LOG_VIEWPORT_PAGE_SIZE): boolean {
		return this.scrollDown(lines);
	}

	scrollToTop(): boolean {
		const before = this.offsetFromBottom;
		this.offsetFromBottom = Math.max(0, this.totalLines - this.viewportLines);
		return this.offsetFromBottom !== before;
	}

	scrollToBottom(): boolean {
		const before = this.offsetFromBottom;
		this.offsetFromBottom = 0;
		return this.offsetFromBottom !== before;
	}

	reset(): void {
		this.scrollToBottom();
	}

	getOffsetFromBottom(): number {
		return this.offsetFromBottom;
	}

	range(): LogViewportRange {
		const end = Math.max(0, this.totalLines - this.offsetFromBottom);
		const start = Math.max(0, end - this.viewportLines);
		return {
			start,
			end,
			total: this.totalLines,
			offsetFromBottom: this.offsetFromBottom,
			hasAbove: start > 0,
			hasBelow: end < this.totalLines,
		};
	}

	private clamp(): void {
		this.offsetFromBottom = Math.min(
			Math.max(0, this.offsetFromBottom),
			Math.max(0, this.totalLines - this.viewportLines),
		);
	}
}
