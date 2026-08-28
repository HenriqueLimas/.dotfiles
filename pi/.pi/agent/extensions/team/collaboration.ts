import type {
	TeamCollaborationByMode,
	TeamCollaborationConfig,
	TeamCollaborationMode,
} from "./types.ts";

export function parseCollaborationConfig(value: unknown): TeamCollaborationConfig {
	if (value === undefined) {
		return { mode: "independent", rounds: 1, maxTranscriptChars: 30_000 };
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("collaboration must be an object");
	}

	const collaboration = value as Record<string, unknown>;
	const mode = collaboration.mode ?? "independent";
	if (mode !== "independent" && mode !== "roundtable") {
		throw new Error('collaboration.mode must be "independent" or "roundtable"');
	}

	const rounds = collaboration.rounds ?? (mode === "roundtable" ? 2 : 1);
	if (!Number.isInteger(rounds) || (rounds as number) < 1 || (rounds as number) > 4) {
		throw new Error("collaboration.rounds must be an integer between 1 and 4");
	}
	if (mode === "independent" && rounds !== 1) {
		throw new Error("collaboration.rounds must be 1 in independent mode");
	}
	if (mode === "roundtable" && (rounds as number) < 2) {
		throw new Error("collaboration.rounds must be at least 2 in roundtable mode");
	}

	const maxTranscriptChars = collaboration.maxTranscriptChars ?? 30_000;
	if (
		!Number.isInteger(maxTranscriptChars) ||
		(maxTranscriptChars as number) < 3_000 ||
		(maxTranscriptChars as number) > 100_000
	) {
		throw new Error("collaboration.maxTranscriptChars must be an integer between 3000 and 100000");
	}

	return {
		mode,
		rounds: rounds as number,
		maxTranscriptChars: maxTranscriptChars as number,
	};
}

export function parseCollaborationByMode(value: unknown): TeamCollaborationByMode {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		const record = value as Record<string, unknown>;
		if ("mode" in record || "rounds" in record || "maxTranscriptChars" in record) {
			const shared = parseCollaborationConfig(record);
			return { brainstorm: shared, review: { ...shared } };
		}
		return {
			brainstorm: parseCollaborationConfig(record.brainstorm),
			review: parseCollaborationConfig(record.review),
		};
	}

	const shared = parseCollaborationConfig(value);
	return { brainstorm: shared, review: { ...shared } };
}

export function resolveCollaborationForMode(
	collaboration: TeamCollaborationByMode,
	panelMode: keyof TeamCollaborationByMode,
	override?: TeamCollaborationMode,
): TeamCollaborationConfig {
	const configured = collaboration[panelMode];
	if (!override || override === configured.mode) return { ...configured };
	if (override === "independent") return { ...configured, mode: "independent", rounds: 1 };
	return { ...configured, mode: "roundtable", rounds: 2 };
}

export function takeCollaborationOverride(input: string): { mode?: TeamCollaborationMode; rest: string } {
	const source = input.trimStart();
	const match = /^--(roundtable|independent)(?:\s+|$)/.exec(source);
	if (!match) return { rest: input };
	return {
		mode: match[1] as TeamCollaborationMode,
		rest: source.slice(match[0].length),
	};
}

export interface PeerResponse {
	name: string;
	output: string;
}

export function formatPeerTranscript(peers: PeerResponse[], maxChars: number): string {
	if (peers.length === 0 || maxChars <= 0) return "";

	const separator = "\n\n---\n\n";
	const headers = peers.map((peer) => `## ${peer.name}\n\n`);
	const fixedChars = headers.reduce((total, header) => total + header.length, 0) + separator.length * (peers.length - 1);
	const outputBudget = Math.max(0, maxChars - fixedChars);
	const budgetPerPeer = Math.floor(outputBudget / peers.length);
	let remainder = outputBudget % peers.length;

	const sections = peers.map((peer, index) => {
		const extra = remainder > 0 ? 1 : 0;
		if (remainder > 0) remainder--;
		return `${headers[index]}${peer.output.slice(0, budgetPerPeer + extra)}`;
	});
	return sections.join(separator).slice(0, maxChars);
}
