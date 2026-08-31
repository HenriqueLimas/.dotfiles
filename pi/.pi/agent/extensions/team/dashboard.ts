import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { LogViewport } from "../_shared/log-viewport.ts";
import type { AgentStatus, TeamRunSnapshot } from "./types.ts";

const STATUS_LABEL: Record<AgentStatus, string> = {
	queued: "queued",
	running: "working",
	completed: "done",
	failed: "failed",
	aborted: "aborted",
};

export class TeamDashboard {
	private selected = 0;
	private selectedMemberName: string | undefined;
	private readonly viewport = new LogViewport();

	constructor(
		private readonly theme: Theme,
		private readonly getSnapshot: () => TeamRunSnapshot,
		private readonly close: () => void,
	) {}

	handleInput(data: string): boolean {
		const members = this.getSnapshot().members;
		if (matchesKey(data, "escape") || data === "q") {
			this.close();
			return true;
		}
		if (matchesKey(data, "up") || data === "k") {
			const selected = Math.max(0, this.selected - 1);
			if (selected !== this.selected) {
				this.selected = selected;
				this.viewport.reset();
			}
			return true;
		}
		if (matchesKey(data, "down") || data === "j") {
			const selected = Math.min(Math.max(0, members.length - 1), this.selected + 1);
			if (selected !== this.selected) {
				this.selected = selected;
				this.viewport.reset();
			}
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
		const snapshot = this.getSnapshot();
		const previousSelected = this.selected;
		this.selected = Math.min(this.selected, Math.max(0, snapshot.members.length - 1));
		if (this.selected !== previousSelected) this.viewport.reset();
		const outerWidth = Math.max(1, width);
		const innerWidth = Math.max(0, outerWidth - 2);
		const lines: string[] = [];
		const border = (text: string) => this.theme.fg("border", text);
		const fit = (line: string) => truncateToWidth(line, outerWidth, "");
		const row = (content = "") => {
			const clipped = truncateToWidth(content, innerWidth, "");
			const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
			return fit(`${border("│")}${clipped}${padding}${border("│")}`);
		};

		lines.push(fit(border(`╭${"─".repeat(innerWidth)}╮`)));
		lines.push(row(` ${this.theme.fg("accent", this.theme.bold(`Team ${snapshot.mode}`))} ${this.theme.fg("dim", snapshot.id)}`));
		lines.push(row(` ${this.theme.fg("muted", truncateToWidth(snapshot.subject.replace(/\s+/g, " "), Math.max(0, innerWidth - 1)))}`));
		lines.push(row());

		for (const [index, member] of snapshot.members.entries()) {
			const selected = index === this.selected;
			const marker = selected ? this.theme.fg("accent", ">") : " ";
			const color = member.status === "completed" ? "success" : member.status === "failed" || member.status === "aborted" ? "error" : member.status === "running" ? "warning" : "muted";
			const name = selected ? this.theme.fg("accent", member.name) : this.theme.fg("text", member.name);
			lines.push(row(` ${marker} ${name} ${this.theme.fg(color, STATUS_LABEL[member.status])} ${this.theme.fg("dim", member.model)}`));
		}

		lines.push(row());
		const selected = snapshot.members[this.selected];
		if (selected) {
			if (this.selectedMemberName !== selected.name) {
				this.selectedMemberName = selected.name;
				this.viewport.reset();
			}
			lines.push(row(` ${this.theme.fg("accent", this.theme.bold(selected.name))} ${this.theme.fg("dim", "logs and latest response")}`));
			const wrapWidth = Math.max(1, innerWidth - 1);
			const wrapped = [
				...selected.logs.flatMap((line) => wrapTextWithAnsi(this.theme.fg("dim", line), wrapWidth)),
				...(selected.error ? wrapTextWithAnsi(this.theme.fg("error", selected.error), wrapWidth) : []),
				...wrapTextWithAnsi(selected.output || (selected.status === "running" ? "Waiting for response..." : "No response yet."), wrapWidth),
			];
			this.viewport.setContent(wrapped.length, 12);
			const range = this.viewport.range();
			for (const line of wrapped.slice(range.start, range.end)) lines.push(row(` ${line}`));
			for (let index = range.end - range.start; index < 12; index++) lines.push(row());
			const position = range.total > 12 ? ` · ${range.start + 1}-${range.end}/${range.total}` : "";
			lines.push(row(` ${this.theme.fg("dim", `up/down: member  ctrl+u/d: logs  esc: close${position}`)}`));
		} else {
			this.selectedMemberName = undefined;
			this.viewport.setContent(0, 12);
			lines.push(row(` ${this.theme.fg("dim", "up/down: member  ctrl+u/d: logs  esc: close")}`));
		}
		lines.push(fit(border(`╰${"─".repeat(innerWidth)}╯`)));
		return lines;
	}

	invalidate(): void {}
}
