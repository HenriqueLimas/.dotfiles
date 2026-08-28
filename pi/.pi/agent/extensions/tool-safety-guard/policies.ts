export const BLOCKED_FLAGS = {
	"--no-verify": {
		notification: "Blocked git --no-verify. Fix the hook failure instead of bypassing it.",
		reason: [
			"Blocked git --no-verify.",
			"Git hooks exist for a reason: they catch formatting, linting, tests, secrets, and repository policy issues before bad changes land.",
			"Do not bypass them. Remove --no-verify, rerun the git command, read the hook output, fix the underlying issue, run the relevant validation locally, and then retry the git command.",
		].join(" "),
	},
	"--no-gpg-sign": {
		notification: "Blocked git --no-gpg-sign. Complete or fix commit signing instead of disabling it.",
		reason: [
			"Blocked git --no-gpg-sign.",
			"Commit signing must not be disabled.",
			"Remove --no-gpg-sign and retry the commit. If signing fails, stop and ask the user to complete or fix the signing step.",
		].join(" "),
	},
} as const;

const GIT_PATTERN = /\bgit\b/i;

type BlockedFlag = keyof typeof BLOCKED_FLAGS;

export function findBlockedFlag(command: string): BlockedFlag | undefined {
	if (!GIT_PATTERN.test(command)) return undefined;
	return (Object.keys(BLOCKED_FLAGS) as BlockedFlag[]).find((flag) => command.includes(flag));
}
