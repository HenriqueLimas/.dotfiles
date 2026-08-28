import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export type TeamMode = "brainstorm" | "review" | "followup";
export type AgentStatus = "queued" | "running" | "completed" | "failed" | "aborted";

export interface TeamMemberConfig {
	name: string;
	model: string;
	thinkingLevel?: ThinkingLevel;
	perspective?: string;
}

export type TeamCollaborationMode = "independent" | "roundtable";

export interface TeamCollaborationConfig {
	mode: TeamCollaborationMode;
	rounds: number;
	maxTranscriptChars: number;
}

export interface TeamCollaborationByMode {
	brainstorm: TeamCollaborationConfig;
	review: TeamCollaborationConfig;
}

export interface TeamConfig {
	models: TeamMemberConfig[];
	maxConcurrency: number;
	autoSynthesize: boolean;
	maxResultChars: number;
	collaboration: TeamCollaborationByMode;
}

export interface TeamMemberSnapshot {
	name: string;
	model: string;
	status: AgentStatus;
	output: string;
	error?: string;
	logs: string[];
}

export interface TeamRunSnapshot {
	id: string;
	mode: TeamMode;
	subject: string;
	createdAt: string;
	members: TeamMemberSnapshot[];
}

export interface PersistedTeamMember {
	config: TeamMemberConfig;
	status: AgentStatus;
	sessionFile?: string;
	error?: string;
}

export interface PersistedTeamRun {
	version: 1;
	id: string;
	mode: Exclude<TeamMode, "followup">;
	subject: string;
	createdAt: string;
	artifactDir: string;
	maxConcurrency: number;
	autoSynthesize: boolean;
	maxResultChars: number;
	collaboration?: TeamCollaborationConfig;
	roundsCompleted?: number;
	members: PersistedTeamMember[];
}
