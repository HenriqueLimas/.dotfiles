import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { projectAgentTranscript, type AgentTranscriptBlock } from "../_shared/agent-transcript.ts";
import { LogViewport } from "../_shared/log-viewport.ts";
import type { BoraActivityEvent, BoraStatus } from "./types.ts";

export interface BoraStatusSnapshot {
	id: string;
	status: BoraStatus;
	model: string;
	task: string;
	sessionFile?: string;
	artifactDir: string;
	activity: readonly BoraActivityEvent[];
	messages: readonly AgentMessage[];
	liveMessage?: AgentMessage;
	revision: number;
	phase?: string;
	error?: string;
}

interface TranscriptCache {
	revision: number;
	width: number;
	lines: string[];
}

export class BoraStatusPopup {
	private readonly viewport = new LogViewport();
	private taskExpanded = false;
	private transcriptPageLines = 8;
	private transcriptCache: TranscriptCache | undefined;

	constructor(
		private readonly theme: Theme,
		private readonly getSnapshot: () => BoraStatusSnapshot | undefined,
		private readonly close: () => void,
		private readonly keybindings: KeybindingsManager,
		private readonly getAvailableRows: () => number,
	) {}

	handleInput(data: string): boolean {
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
			this.taskExpanded = !this.taskExpanded;
			return true;
		}
		return false;
	}

	render(width: number): string[] {
		const run = this.getSnapshot();
		if (!run) return [];

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

		const taskLines = this.renderTask(run.task, contentWidth, availableRows);
		const transcriptRows = Math.max(3, availableRows - taskLines.length - 10);
		this.transcriptPageLines = transcriptRows;
		const transcript = this.renderTranscript(run, contentWidth);
		this.viewport.setContent(transcript.length, transcriptRows);
		const range = this.viewport.range();

		const statusColor = run.status === "completed" ? "success" : run.status === "failed" || run.status === "aborted" ? "error" : "warning";
		const phase = run.phase ? ` · ${run.phase}` : "";
		const lines = [fit(border(`╭${"─".repeat(innerWidth)}╮`))];
		lines.push(row(` ${this.theme.fg("accent", this.theme.bold("Bora"))} ${this.theme.fg(statusColor, run.status)} ${this.theme.fg("dim", `· ${run.id}${phase}`)}`));
		for (const taskLine of taskLines) lines.push(row(` ${taskLine}`));
		lines.push(divider());
		lines.push(row(` ${this.theme.fg("muted", "Model")} ${this.theme.fg("text", truncateToWidth(run.model, Math.max(1, contentWidth - 7), "…"))}`));
		lines.push(row(` ${this.theme.fg("muted", "Child")} ${this.theme.fg("dim", truncateToWidth(run.sessionFile ?? "(not created)", Math.max(1, contentWidth - 7), "…"))}`));
		lines.push(row(` ${this.theme.fg("muted", "Artifacts")} ${this.theme.fg("dim", truncateToWidth(run.artifactDir, Math.max(1, contentWidth - 11), "…"))}`));
		lines.push(divider());
		lines.push(row(` ${this.theme.fg("accent", this.theme.bold("Complete child transcript"))}`));
		for (const line of transcript.slice(range.start, range.end)) lines.push(row(` ${line}`));
		for (let index = range.end - range.start; index < transcriptRows; index++) lines.push(row());

		const position = range.total > transcriptRows ? `${range.start + 1}-${range.end}/${range.total}` : "";
		const taskKeys = this.keybindings.getKeys("app.tools.expand").join("/");
		const help = [position, "↑↓ line", "⌥↑↓ page", "⌥←→ ends", `${taskKeys} task`, "esc"].filter(Boolean).join(" ");
		lines.push(row(` ${this.theme.fg("dim", help)}`));
		lines.push(fit(border(`╰${"─".repeat(innerWidth)}╯`)));
		return lines;
	}

	invalidate(): void {
		this.transcriptCache = undefined;
	}

	private renderTask(task: string, width: number, availableRows: number): string[] {
		const keys = this.keybindings.getKeys("app.tools.expand").join("/");
		const label = this.theme.fg("accent", this.theme.bold("Task"));
		if (!this.taskExpanded) {
			const suffix = this.theme.fg("dim", `  ${keys} expand`);
			const available = Math.max(1, width - visibleWidth(label) - visibleWidth(suffix) - 2);
			return [`${label} ${this.theme.fg("text", truncateToWidth(task.replace(/\s+/g, " ").trim(), available, "…"))}${suffix}`];
		}

		const wrapped = wrapTextWithAnsi(this.theme.fg("text", task), Math.max(1, width - 2));
		const maxTaskRows = Math.max(1, Math.floor(availableRows * 0.2) - 1);
		const visible = wrapped.slice(0, maxTaskRows);
		if (wrapped.length > maxTaskRows && visible.length > 0) {
			visible[visible.length - 1] = truncateToWidth(`${visible.at(-1)} ${this.theme.fg("dim", `… ${wrapped.length - maxTaskRows} more lines`)}`, width - 2, "");
		}
		return [
			`${label} ${this.theme.fg("dim", `${keys} collapse`)}`,
			...visible.map((line) => `  ${line}`),
		];
	}

	private renderTranscript(run: BoraStatusSnapshot, width: number): string[] {
		if (this.transcriptCache?.revision === run.revision && this.transcriptCache.width === width) {
			return this.transcriptCache.lines;
		}
		const blocks = projectAgentTranscript(run.activity, run.messages, run.liveMessage);
		if (run.error && !blocks.some((block) => block.tone === "error" && block.text.includes(run.error!))) {
			blocks.push({ id: "run-error", timestamp: Date.now(), label: "ERROR", text: run.error, tone: "error" });
		}
		const lines = blocks.length > 0
			? blocks.flatMap((block) => this.renderTranscriptBlock(block, width))
			: [this.theme.fg("dim", run.status === "running" ? "Waiting for the first child message…" : "No child transcript recorded.")];
		this.transcriptCache = { revision: run.revision, width, lines };
		return lines;
	}

	private renderTranscriptBlock(block: AgentTranscriptBlock, width: number): string[] {
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
}
