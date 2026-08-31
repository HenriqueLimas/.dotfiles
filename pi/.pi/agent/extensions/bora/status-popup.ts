import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { BoraStatus } from "./types.ts";
import { LogViewport } from "../_shared/log-viewport.ts";

const LOG_PANE_LINES = 12;

export interface BoraStatusSnapshot {
	id: string;
	status: BoraStatus;
	model: string;
	task: string;
	sessionFile?: string;
	artifactDir: string;
	logs: string[];
	streamingText: string;
	output: string;
	error?: string;
}

export class BoraStatusPopup {
	private readonly viewport = new LogViewport();

	constructor(
		private readonly theme: Theme,
		private readonly getSnapshot: () => BoraStatusSnapshot | undefined,
		private readonly close: () => void,
	) {}

	handleInput(data: string): boolean {
		if (matchesKey(data, "escape") || data === "q") {
			this.close();
			return true;
		}
		if (matchesKey(data, Key.ctrl("u")) || matchesKey(data, "pageUp")) {
			this.viewport.pageUp();
			return true;
		}
		if (matchesKey(data, Key.ctrl("d")) || matchesKey(data, "pageDown")) {
			this.viewport.pageDown();
			return true;
		}
		return false;
	}

	render(width: number): string[] {
		const run = this.getSnapshot();
		if (!run) return [];

		const outerWidth = Math.max(1, width);
		const innerWidth = Math.max(0, outerWidth - 2);
		const contentWidth = Math.max(1, innerWidth - 1);
		const border = (text: string) => this.theme.fg("border", text);
		const fit = (line: string) => truncateToWidth(line, outerWidth, "");
		const row = (content = "") => {
			const clipped = truncateToWidth(content, innerWidth, "");
			const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
			return fit(`${border("│")}${clipped}${padding}${border("│")}`);
		};
		const wrap = (text: string): string[] => wrapTextWithAnsi(text, contentWidth);

		const activity = [
			...run.logs.flatMap((line) => wrap(this.theme.fg("dim", line))),
			...wrap(run.streamingText || run.output || "(no output yet)"),
			...(run.error ? wrap(this.theme.fg("error", `Error: ${run.error}`)) : []),
		];
		this.viewport.setContent(activity.length, LOG_PANE_LINES);
		const range = this.viewport.range();

		const lines = [fit(border(`╭${"─".repeat(Math.max(0, innerWidth))}╮`))];
		lines.push(row(` ${this.theme.fg("accent", this.theme.bold(`Bora ${run.status} · ${run.id}`))}`));
		for (const [label, value] of [
			["Model", run.model],
			["Task", run.task],
			["Child session", run.sessionFile ?? "(not created)"],
			["Artifact directory", run.artifactDir],
		] as const) {
			for (const line of wrap(`${label}: ${value}`)) lines.push(row(` ${line}`));
		}
		lines.push(row());
		lines.push(row(` ${this.theme.fg("accent", this.theme.bold("Activity and output"))}`));
		for (const line of activity.slice(range.start, range.end)) lines.push(row(` ${line}`));
		for (let index = range.end - range.start; index < LOG_PANE_LINES; index++) lines.push(row());

		const position = range.total > LOG_PANE_LINES ? ` · ${range.start + 1}-${range.end}/${range.total}` : "";
		lines.push(row(` ${this.theme.fg("dim", `ctrl+u/d: logs  esc: close${position}`)}`));
		lines.push(fit(border(`╰${"─".repeat(Math.max(0, innerWidth))}╯`)));
		return lines;
	}

	invalidate(): void {}
}
