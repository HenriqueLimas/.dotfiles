import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { parseCollaborationByMode } from "./collaboration.ts";
import type { TeamConfig, TeamMemberConfig } from "./types.ts";

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function expectRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function parseMember(value: unknown, label: string, index: number): TeamMemberConfig {
	const member = expectRecord(value, `${label}[${index}]`);
	if (typeof member.name !== "string" || member.name.trim() === "") {
		throw new Error(`${label}[${index}].name must be a non-empty string`);
	}
	if (typeof member.model !== "string" || member.model.trim() === "") {
		throw new Error(`${label}[${index}].model must be a non-empty string`);
	}
	if (
		member.thinkingLevel !== undefined &&
		(typeof member.thinkingLevel !== "string" || !THINKING_LEVELS.has(member.thinkingLevel as ThinkingLevel))
	) {
		throw new Error(`${label}[${index}].thinkingLevel is invalid`);
	}
	if (member.perspective !== undefined && typeof member.perspective !== "string") {
		throw new Error(`${label}[${index}].perspective must be a string`);
	}

	return {
		name: member.name.trim(),
		model: member.model.trim(),
		thinkingLevel: member.thinkingLevel as ThinkingLevel | undefined,
		perspective: member.perspective?.trim(),
	};
}

function parseMembers(value: unknown, label: string): TeamMemberConfig[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label} must be a non-empty array`);
	}

	const members = value.map((member, index) => parseMember(member, label, index));
	const names = new Set<string>();
	for (const member of members) {
		const key = member.name.toLowerCase();
		if (names.has(key)) throw new Error(`Duplicate team member name in ${label}: ${member.name}`);
		names.add(key);
	}
	return members;
}

export function parseTeamConfig(value: unknown): TeamConfig {
	const config = expectRecord(value, "team config");
	const models = parseMembers(config.models, "models");
	const reviewModels = config.reviewModels === undefined ? undefined : parseMembers(config.reviewModels, "reviewModels");

	const maxConcurrency = config.maxConcurrency ?? models.length;
	if (!Number.isInteger(maxConcurrency) || (maxConcurrency as number) < 1 || (maxConcurrency as number) > 16) {
		throw new Error("maxConcurrency must be an integer between 1 and 16");
	}
	const maxResultChars = config.maxResultChars ?? 30_000;
	if (!Number.isInteger(maxResultChars) || (maxResultChars as number) < 1_000 || (maxResultChars as number) > 100_000) {
		throw new Error("maxResultChars must be an integer between 1000 and 100000");
	}

	return {
		models,
		reviewModels,
		maxConcurrency: maxConcurrency as number,
		maxResultChars: maxResultChars as number,
		collaboration: parseCollaborationByMode(config.collaboration),
	};
}

export function getTeamConfigPath(): string {
	return join(getAgentDir(), "team.json");
}

export async function loadTeamConfig(): Promise<TeamConfig> {
	const path = getTeamConfigPath();
	let source: string;
	try {
		source = await readFile(path, "utf8");
	} catch (error) {
		throw new Error(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}

	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch (error) {
		throw new Error(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}

	return parseTeamConfig(value);
}
