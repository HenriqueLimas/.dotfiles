import type { AgentStatus } from "./types.ts";

export interface TeamProgress {
	running: number;
	queued: number;
	done: number;
	failed: number;
	total: number;
}

export function calculateTeamProgress(statuses: readonly AgentStatus[]): TeamProgress {
	return {
		running: statuses.filter((status) => status === "running").length,
		queued: statuses.filter((status) => status === "queued").length,
		done: statuses.filter((status) => status === "completed").length,
		failed: statuses.filter((status) => status === "failed" || status === "aborted").length,
		total: statuses.length,
	};
}

export function formatWorkingProgress(progress: TeamProgress): string {
	const parts = [`${progress.running}/${progress.total} working`];
	if (progress.queued > 0) parts.push(`${progress.queued} queued`);
	if (progress.done > 0 || progress.failed > 0) parts.push(`${progress.done + progress.failed}/${progress.total} done`);
	return parts.join(" · ");
}
