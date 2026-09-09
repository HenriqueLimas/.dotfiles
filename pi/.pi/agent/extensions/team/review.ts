import type { TeamMemberConfig } from "./types.ts";

export const DEFAULT_REVIEWER_NAMES = ["domain-expert", "correctness", "design", "fresh-eyes"] as const;
export const SPECIALIST_NAMES = ["security", "reliability", "performance", "api-compatibility"] as const;

export type ReviewSpecialistName = (typeof SPECIALIST_NAMES)[number];
export type ReviewRisk = "low" | "medium" | "high";

export interface ReviewScope {
	changedFiles: string[];
	specialists: ReviewSpecialistName[];
	risk: ReviewRisk;
}

interface SpecialistSignal {
	name: ReviewSpecialistName;
	file: RegExp;
	content: RegExp;
}

const SPECIALIST_SIGNALS: SpecialistSignal[] = [
	{
		name: "security",
		file: /(^|[/._-])(auth|oauth|security|permission|permissions|acl|credential|secret|token|crypto|identity)([/._-]|[A-Z]|$)|\.pem$|\.key$/i,
		content: /\b(auth(?:entication|orization)?|oauth|permission|privilege|credential|secret|password|token|jwt|cryptograph|encrypt|decrypt|injection|xss|csrf)\b/i,
	},
	{
		name: "reliability",
		file: /(^|[/._-])(deploy|deployment|docker|k8s|helm|terraform|migration|migrations|queue|worker|job|retry|timeout|transaction|lock|cache|database|db|network|webhook|cron)([/._-]|[A-Z]|$)/i,
		content: /\b(retry|timeout|transaction|rollback|queue|worker|job|idempot(?:ent|ency)|dead.?letter|circuit.?breaker|migration|fail(?:ure|over)|backoff)\b/i,
	},
	{
		name: "performance",
		file: /(^|[/._-])(perf|performance|benchmark|query|queries|database|db|cache|index|batch|stream|pagination)([/._-]|[A-Z]|$)|\.(sql|graphql)$/i,
		content: /\b(n\s*\+\s*1|query|queries|database|cache|pagination|batch|benchmark|performance|memory|cpu|allocation|complexity)\b/i,
	},
	{
		name: "api-compatibility",
		file: /(^|[/._-])(api|apis|schema|schemas|openapi|graphql|proto|event|events|cli|config|configuration|public)([/._-]|[A-Z]|$)|\.(proto|graphql|gql)$/i,
		content: /\b(public api|backward compatibility|breaking change|schema|serialization|deserialization|openapi|graphql|protobuf|event|webhook|cli|configuration|contract)\b/i,
	},
];

export function determineReviewScope(changedFiles: string[], evidence: string): ReviewScope {
	const files = [...new Set(changedFiles.map((file) => file.trim()).filter(Boolean))];
	const specialists = SPECIALIST_SIGNALS.filter((signal) =>
		files.some((file) => signal.file.test(file)) || signal.content.test(evidence),
	).map((signal) => signal.name);

	const risk: ReviewRisk = specialists.includes("security") || files.length >= 20 ? "high" : specialists.length > 0 || files.length >= 5 ? "medium" : "low";
	return { changedFiles: files, specialists, risk };
}

export function selectReviewMembers(roster: TeamMemberConfig[], scope: ReviewScope): TeamMemberConfig[] {
	const wanted = new Set<string>([...DEFAULT_REVIEWER_NAMES, ...scope.specialists]);
	return roster.filter((member) => wanted.has(member.name.toLowerCase()));
}
