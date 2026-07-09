import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BLOCK_REASON = [
	"Blocked git --no-verify.",
	"Git hooks exist for a reason: they catch formatting, linting, tests, secrets, and repository policy issues before bad changes land.",
	"Do not bypass them. Remove --no-verify, rerun the git command, read the hook output, fix the underlying issue, run the relevant validation locally, and then retry the git command.",
].join(" ");

const GIT_PATTERN = /\bgit\b/i;
const NO_VERIFY_FLAG = "--no-verify";

function isGitNoVerifyCommand(command: string): boolean {
	return GIT_PATTERN.test(command) && command.includes(NO_VERIFY_FLAG);
}

export default function gitNoVerifyGuard(pi: ExtensionAPI) {
	pi.on("tool_call", (event, ctx) => {
		if (isToolCallEventType("bash", event)) {
			const { command } = event.input;

			if (typeof command === "string" && isGitNoVerifyCommand(command)) {
				if (ctx.hasUI) {
					ctx.ui.notify("Blocked git --no-verify. Fix the hook failure instead of bypassing it.", "warning");
				}

				return { block: true, reason: BLOCK_REASON };
			}
		}
	});
}
