import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";

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
	reviewModels?: TeamMemberConfig[];
	maxConcurrency: number;
	maxResultChars: number;
	collaboration: TeamCollaborationByMode;
}

export type TeamActivityKind = "round" | "activity" | "retry" | "status" | "error";

export interface TeamActivityEvent {
	timestamp: number;
	kind: TeamActivityKind;
	text: string;
}

export interface TeamMemberSnapshot {
	name: string;
	model: string;
	status: AgentStatus;
	error?: string;
	activity: readonly TeamActivityEvent[];
	messages: readonly AgentMessage[];
	liveMessage?: AgentMessage;
	revision: number;
}

export interface TeamRunSnapshot {
	id: string;
	mode: TeamMode;
	subject: string;
	createdAt: string;
	collaborationMode: TeamCollaborationMode;
	currentRound: number;
	totalRounds: number;
	roundsCompleted: number;
	maxConcurrency: number;
	roundSources: readonly string[];
	latestActivityMember?: string;
	members: TeamMemberSnapshot[];
}

export interface PersistedTeamMember {
	config: TeamMemberConfig;
	status: AgentStatus;
	sessionFile?: string;
	error?: string;
	activity?: TeamActivityEvent[];
}

export interface PersistedTeamRun {
	version: 1;
	id: string;
	mode: Exclude<TeamMode, "followup">;
	subject: string;
	createdAt: string;
	cwd?: string;
	gitCwd?: string;
	reviewEvidencePath?: string;
	reviewCheckoutPath?: string;
	reviewPrTarget?: string;
	reviewHeadRefOid?: string;
	artifactDir: string;
	maxConcurrency: number;
	maxResultChars: number;
	collaboration?: TeamCollaborationConfig;
	roundsCompleted?: number;
	currentRound?: number;
	roundSources?: string[];
	members: PersistedTeamMember[];
}
