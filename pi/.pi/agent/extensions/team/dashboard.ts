import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
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
	private scrollFromBottom = 0;

	constructor(
		private readonly theme: Theme,
		private readonly getSnapshot: () => TeamRunSnapshot,
		private readonly close: () => void,
	) {}

	handleInput(data: string): void {
		const members = this.getSnapshot().members;
		if (matchesKey(data, "escape") || data === "q") {
			this.close();
			return;
		}
		if (matchesKey(data, "up") || data === "k") {
			this.selected = Math.max(0, this.selected - 1);
			this.scrollFromBottom = 0;
		} else if (matchesKey(data, "down") || data === "j") {
			this.selected = Math.min(Math.max(0, members.length - 1), this.selected + 1);
			this.scrollFromBottom = 0;
		} else if (matchesKey(data, "pageUp")) {
			this.scrollFromBottom += 8;
		} else if (matchesKey(data, "pageDown")) {
			this.scrollFromBottom = Math.max(0, this.scrollFromBottom - 8);
		}
	}

	render(width: number): string[] {
		const snapshot = this.getSnapshot();
		this.selected = Math.min(this.selected, Math.max(0, snapshot.members.length - 1));
		const outerWidth = Math.max(24, width);
		const innerWidth = outerWidth - 2;
		const lines: string[] = [];
		const border = (text: string) => this.theme.fg("border", text);
		const row = (content = "") => {
			const clipped = truncateToWidth(content, innerWidth, "");
			const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
			return `${border("│")}${clipped}${padding}${border("│")}`;
		};

		lines.push(border(`╭${"─".repeat(innerWidth)}╮`));
		lines.push(row(` ${this.theme.fg("accent", this.theme.bold(`Team ${snapshot.mode}`))} ${this.theme.fg("dim", snapshot.id)}`));
		lines.push(row(` ${this.theme.fg("muted", truncateToWidth(snapshot.subject.replace(/\s+/g, " "), innerWidth - 2))}`));
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
			lines.push(row(` ${this.theme.fg("accent", this.theme.bold(selected.name))} ${this.theme.fg("dim", "logs and latest response")}`));
			const text = [
				...selected.logs.map((line) => this.theme.fg("dim", line)),
				selected.error ? this.theme.fg("error", selected.error) : "",
				selected.output || (selected.status === "running" ? "Waiting for response..." : "No response yet."),
			]
				.filter(Boolean)
				.join("\n");
			const wrapped = wrapTextWithAnsi(text, Math.max(1, innerWidth - 2));
			const end = Math.max(0, wrapped.length - this.scrollFromBottom);
			const start = Math.max(0, end - 12);
			for (const line of wrapped.slice(start, end)) lines.push(row(` ${line}`));
			while (lines.length < snapshot.members.length + 19) lines.push(row());
		}

		lines.push(row(` ${this.theme.fg("dim", "up/down: member  page up/down: logs  esc: close")}`));
		lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
		return lines;
	}

	invalidate(): void {}
}
