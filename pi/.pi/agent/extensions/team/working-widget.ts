import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { formatWorkingProgress, type TeamProgress } from "./progress.ts";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class TeamWorkingWidget {
	private frame = 0;
	private readonly timer: ReturnType<typeof setInterval>;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly getProgress: () => TeamProgress,
	) {
		this.timer = setInterval(() => {
			this.frame = (this.frame + 1) % FRAMES.length;
			this.tui.requestRender();
		}, 80);
		this.timer.unref?.();
	}

	render(width: number): string[] {
		const progress = this.getProgress();
		const spinner = this.theme.fg("warning", FRAMES[this.frame]!);
		const text = this.theme.fg("muted", `Team ${formatWorkingProgress(progress)}. Use /team status for logs.`);
		return [truncateToWidth(` ${spinner} ${text}`, width)];
	}

	invalidate(): void {}

	dispose(): void {
		clearInterval(this.timer);
	}
}
