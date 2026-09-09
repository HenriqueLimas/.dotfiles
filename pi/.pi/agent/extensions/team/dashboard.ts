import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { LogViewport } from "../_shared/log-viewport.ts";
import { projectTeamTranscript, type TeamTranscriptBlock } from "./transcript.ts";
import type { AgentStatus, TeamMemberSnapshot, TeamRunSnapshot } from "./types.ts";

const STATUS_GLYPH: Record<AgentStatus, string> = {
	queued: "…",
	running: "●",
	completed: "✓",
	failed: "×",
	aborted: "×",
};

interface TranscriptCacheEntry {
	revision: number;
	width: number;
	lines: string[];
}

export class TeamDashboard {
	private selectedMemberName: string | undefined;
	private memberOrder: string[] = [];
	private tabOffset = 0;
	private inputExpanded = false;
	private transcriptPageLines = 8;
	private readonly viewport = new LogViewport();
	private readonly transcriptCache = new Map<string, TranscriptCacheEntry>();

	constructor(
		private readonly theme: Theme,
		private readonly getSnapshot: () => TeamRunSnapshot,
		private readonly close: () => void,
		private readonly keybindings: KeybindingsManager,
		private readonly getAvailableRows: () => number,
	) {}

	handleInput(data: string): boolean {
		const snapshot = this.getSnapshot();
		this.syncMemberOrder(snapshot);
		if (matchesKey(data, "escape") || data === "q") {
			this.close();
			return true;
		}
		if (matchesKey(data, Key.alt("left"))) {
			this.viewport.scrollToTop();
			return true;
		}
		if (matchesKey(data, Key.alt("right"))) {
			this.viewport.scrollToBottom();
			return true;
		}
		if (matchesKey(data, Key.left)) {
			this.selectRelative(-1);
			return true;
		}
		if (matchesKey(data, Key.right)) {
			this.selectRelative(1);
			return true;
		}
		if (matchesKey(data, Key.up)) {
			this.viewport.scrollUp();
			return true;
		}
		if (matchesKey(data, Key.down)) {
			this.viewport.scrollDown();
			return true;
		}
		if (matchesKey(data, Key.alt("up")) || matchesKey(data, Key.pageUp)) {
			this.viewport.pageUp(this.transcriptPageLines);
			return true;
		}
		if (matchesKey(data, Key.alt("down")) || matchesKey(data, Key.pageDown)) {
			this.viewport.pageDown(this.transcriptPageLines);
			return true;
		}
		if (this.keybindings.matches(data, "app.tools.expand")) {
			this.inputExpanded = !this.inputExpanded;
			return true;
		}
		return false;
	}

	render(width: number): string[] {
		const snapshot = this.getSnapshot();
		this.syncMemberOrder(snapshot);
		const outerWidth = Math.max(1, width);
		const innerWidth = Math.max(0, outerWidth - 2);
		const contentWidth = Math.max(1, innerWidth - 2);
		const availableRows = Math.max(12, this.getAvailableRows());
		const border = (text: string) => this.theme.fg("border", text);
		const fit = (line: string) => truncateToWidth(line, outerWidth, "");
		const row = (content = "") => {
			const clipped = truncateToWidth(content, innerWidth, "");
			const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
			return fit(`${border("│")}${clipped}${padding}${border("│")}`);
		};
		const divider = () => fit(border(`├${"─".repeat(innerWidth)}┤`));

		const promptLines = this.renderPrompt(snapshot.subject, contentWidth, availableRows);
		const transcriptRows = Math.max(3, availableRows - promptLines.length - 9);
		this.transcriptPageLines = transcriptRows;
		const selected = this.selectedMember(snapshot);
		const transcriptLines = selected ? this.renderTranscript(selected, contentWidth) : [];
		this.viewport.setContent(transcriptLines.length, transcriptRows);
		const range = this.viewport.range();

		const lines: string[] = [fit(border(`╭${"─".repeat(innerWidth)}╮`))];
		const progress = this.progressText(snapshot);
		lines.push(row(` ${this.theme.fg("accent", this.theme.bold(`Team ${snapshot.mode}`))} ${this.theme.fg("dim", snapshot.id)}${progress ? ` ${this.theme.fg("muted", `· ${progress}`)}` : ""}`));
		for (const promptLine of promptLines) lines.push(row(` ${promptLine}`));
		lines.push(divider());
		lines.push(row(` ${this.renderTabs(snapshot, contentWidth)}`));
		lines.push(row(` ${this.renderCollaborationFlow(snapshot, contentWidth)}`));
		lines.push(divider());
		lines.push(row(` ${selected ? this.renderTranscriptTitle(selected) : this.theme.fg("muted", "No team members")}`));
		for (const line of transcriptLines.slice(range.start, range.end)) lines.push(row(` ${line}`));
		for (let index = range.end - range.start; index < transcriptRows; index++) lines.push(row());

		const position = range.total > transcriptRows ? `${range.start + 1}-${range.end}/${range.total}` : "";
		const inputKeys = this.keybindings.getKeys("app.tools.expand").join("/");
		const help = [position, "←→ tabs", "↑↓ line", "⌥↑↓ page", "⌥←→ ends", `${inputKeys} input`, "esc"].filter(Boolean).join(" ");
		lines.push(row(` ${this.theme.fg("dim", help)}`));
		lines.push(fit(border(`╰${"─".repeat(innerWidth)}╯`)));
		return lines;
	}

	invalidate(): void {
		this.transcriptCache.clear();
	}

	private syncMemberOrder(snapshot: TeamRunSnapshot): void {
		const names = snapshot.members.map((member) => member.name);
		if (this.memberOrder.length === 0) {
			const attention = snapshot.latestActivityMember;
			this.memberOrder = attention && names.includes(attention)
				? [attention, ...names.filter((name) => name !== attention)]
				: names;
			this.selectedMemberName = this.memberOrder[0];
			return;
		}
		this.memberOrder = [
			...this.memberOrder.filter((name) => names.includes(name)),
			...names.filter((name) => !this.memberOrder.includes(name)),
		];
		if (!this.selectedMemberName || !names.includes(this.selectedMemberName)) {
			this.selectedMemberName = this.memberOrder[0];
			this.viewport.reset();
		}
	}

	private selectRelative(delta: number): void {
		if (this.memberOrder.length === 0) return;
		const current = Math.max(0, this.memberOrder.indexOf(this.selectedMemberName ?? ""));
		const selected = (current + delta + this.memberOrder.length) % this.memberOrder.length;
		this.selectedMemberName = this.memberOrder[selected];
		this.viewport.reset();
	}

	private selectedMember(snapshot: TeamRunSnapshot): TeamMemberSnapshot | undefined {
		return snapshot.members.find((member) => member.name === this.selectedMemberName) ?? snapshot.members[0];
	}

	private renderPrompt(subject: string, width: number, availableRows: number): string[] {
		const hint = this.keybindings.getKeys("app.tools.expand").join("/");
		const label = this.theme.fg("accent", this.theme.bold("Input"));
		const normalized = subject.replace(/\s+/g, " ").trim();
		if (!this.inputExpanded) {
			const suffix = this.theme.fg("dim", `  ${hint} expand`);
			const available = Math.max(1, width - visibleWidth(label) - visibleWidth(suffix) - 2);
			return [`${label} ${this.theme.fg("text", truncateToWidth(normalized, available, "…"))}${suffix}`];
		}

		const wrapped = wrapTextWithAnsi(this.theme.fg("text", subject), Math.max(1, width - 2));
		const maxPromptRows = Math.max(1, Math.floor(availableRows * 0.2) - 1);
		const visible = wrapped.slice(0, maxPromptRows);
		if (wrapped.length > maxPromptRows && visible.length > 0) {
			visible[visible.length - 1] = truncateToWidth(`${visible.at(-1)} ${this.theme.fg("dim", `… ${wrapped.length - maxPromptRows} more lines`)}`, width - 2, "");
		}
		return [
			`${label} ${this.theme.fg("dim", `${hint} collapse`)}`,
			...visible.map((line) => `  ${line}`),
		];
	}

	private renderTabs(snapshot: TeamRunSnapshot, width: number): string {
		const members = this.memberOrder.flatMap((name) => {
			const member = snapshot.members.find((candidate) => candidate.name === name);
			return member ? [member] : [];
		});
		if (members.length === 0) return "";
		const selectedIndex = Math.max(0, members.findIndex((member) => member.name === this.selectedMemberName));
		this.tabOffset = Math.min(this.tabOffset, selectedIndex);

		const rawLabels = members.map((member) => {
			const attention = snapshot.latestActivityMember === member.name ? "▶ " : "";
			return `${attention}${member.name} ${STATUS_GLYPH[member.status]}`;
		});
		const segmentWidth = (index: number) => visibleWidth(rawLabels[index]!) + 3;
		while (this.tabOffset < selectedIndex) {
			const required = rawLabels
				.slice(this.tabOffset, selectedIndex + 1)
				.reduce((total, _label, relative) => total + segmentWidth(this.tabOffset + relative), 0);
			if (required <= width - 2) break;
			this.tabOffset++;
		}

		const prefix = this.tabOffset > 0 ? this.theme.fg("dim", "‹ ") : "";
		let remaining = Math.max(1, width - visibleWidth(prefix));
		const rendered: string[] = [];
		let nextIndex = this.tabOffset;
		for (; nextIndex < members.length; nextIndex++) {
			const needsSuffix = nextIndex < members.length - 1;
			const budget = remaining - (needsSuffix ? 2 : 0);
			if (rendered.length > 0 && segmentWidth(nextIndex) > budget) break;
			const member = members[nextIndex]!;
			const label = truncateToWidth(rawLabels[nextIndex]!, Math.max(1, budget - 2), "…");
			const padded = ` ${label} `;
			const statusColor = member.status === "completed" ? "success" : member.status === "failed" || member.status === "aborted" ? "error" : member.status === "running" ? "warning" : "muted";
			const styledLabel = member.name === this.selectedMemberName
				? this.theme.bg("selectedBg", this.theme.fg("accent", this.theme.bold(padded)))
				: snapshot.latestActivityMember === member.name
					? this.theme.fg("accent", this.theme.bold(padded))
					: this.theme.fg(statusColor, padded);
			rendered.push(styledLabel);
			remaining -= visibleWidth(padded) + 1;
		}
		const suffix = nextIndex < members.length ? this.theme.fg("dim", " ›") : "";
		return truncateToWidth(`${prefix}${rendered.join(" ")}${suffix}`, width, "");
	}

	private renderCollaborationFlow(snapshot: TeamRunSnapshot, width: number): string {
		let text: string;
		if (snapshot.collaborationMode === "roundtable" && snapshot.currentRound > 1) {
			const sources = snapshot.roundSources.length > 0 ? snapshot.roundSources.join(" + ") : "successful peers";
			text = `Round ${snapshot.currentRound} broadcast: ${sources} → all successful participants · completion order is nondeterministic`;
		} else {
			text = `Round ${snapshot.currentRound}: parent input → ${snapshot.members.map((member) => member.name).join(" + ")} · concurrent`;
		}
		return this.theme.fg("muted", truncateToWidth(text, width, "…"));
	}

	private renderTranscriptTitle(member: TeamMemberSnapshot): string {
		const statusColor = member.status === "completed" ? "success" : member.status === "failed" || member.status === "aborted" ? "error" : member.status === "running" ? "warning" : "muted";
		return `${this.theme.fg("accent", this.theme.bold(member.name))} ${this.theme.fg("dim", member.model)} · ${this.theme.fg(statusColor, member.status)}`;
	}

	private renderTranscript(member: TeamMemberSnapshot, width: number): string[] {
		const cached = this.transcriptCache.get(member.name);
		if (cached && cached.revision === member.revision && cached.width === width) return cached.lines;
		const blocks = projectTeamTranscript(member.activity, member.messages, member.liveMessage);
		if (member.error && !blocks.some((block) => block.tone === "error" && block.text.includes(member.error!))) {
			blocks.push({ id: "member-error", timestamp: Date.now(), label: "ERROR", text: member.error, tone: "error" });
		}
		const lines = blocks.length > 0
			? blocks.flatMap((block) => this.renderTranscriptBlock(block, width))
			: [this.theme.fg("dim", member.status === "running" ? "Waiting for the first message…" : "No transcript recorded.")];
		this.transcriptCache.set(member.name, { revision: member.revision, width, lines });
		return lines;
	}

	private renderTranscriptBlock(block: TeamTranscriptBlock, width: number): string[] {
		const time = new Date(block.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
		const labelColor = block.tone === "error" ? "error" : block.tone === "assistant" ? "accent" : block.tone === "tool" ? "toolTitle" : "muted";
		const textColor = block.tone === "error" ? "error" : block.tone === "thinking" ? "dim" : block.tone === "tool" ? "toolOutput" : block.tone === "result" || block.tone === "activity" || block.tone === "prompt" ? "muted" : "text";
		const prefixText = `${time} ${block.label}`;
		const prefix = `${this.theme.fg("dim", time)} ${this.theme.fg(labelColor, block.label)}`;
		const indent = " ".repeat(Math.min(visibleWidth(prefixText) + 1, Math.max(0, width - 1)));
		const bodyWidth = Math.max(1, width - visibleWidth(indent));
		const wrapped = wrapTextWithAnsi(this.theme.fg(textColor, block.text), bodyWidth);
		if (wrapped.length === 0) return [prefix];
		const cursor = block.live ? this.theme.fg("warning", " ▌") : "";
		return wrapped.map((line, index) => index === 0 ? `${prefix} ${line}${index === wrapped.length - 1 ? cursor : ""}` : `${indent}${line}${index === wrapped.length - 1 ? cursor : ""}`);
	}

	private progressText(snapshot: TeamRunSnapshot): string {
		const running = snapshot.members.filter((member) => member.status === "running").length;
		const completed = snapshot.members.filter((member) => member.status === "completed").length;
		const failed = snapshot.members.filter((member) => member.status === "failed" || member.status === "aborted").length;
		return `round ${snapshot.currentRound}/${snapshot.totalRounds} · ${running} working · ${completed + failed}/${snapshot.members.length} done`;
	}
}
