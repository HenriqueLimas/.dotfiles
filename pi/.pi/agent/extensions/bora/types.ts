import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export type BoraStatus = "running" | "completed" | "failed" | "aborted";

export interface BoraConfig {
	model: string;
	thinkingLevel?: ThinkingLevel;
	maxResultChars: number;
}

export interface PersistedBoraRun {
	version: 1;
	id: string;
	task: string;
	createdAt: string;
	cwd: string;
	artifactDir: string;
	sessionFile?: string;
	model: string;
	thinkingLevel?: ThinkingLevel;
	status: BoraStatus;
	error?: string;
	/** Bounded copy used for status after reload; the child JSONL remains complete. */
	latestOutput?: string;
	/** Result limit retained with the run so config changes affect only new runs. */
	maxResultChars?: number;
}

export interface BoraResultDetails {
	version: 1;
	id: string;
	task: string;
	model: string;
	status: BoraStatus;
	error?: string;
}