/**
 * ebay-retry.ts
 *
 * Normalizes transient errors from the eBay Claude proxy into patterns that
 * pi's built-in auto-retry recognises ("overloaded_error: ...").
 *
 * The eBay gateway wraps Anthropic behind an Azure/Envoy proxy stack that
 * produces a set of error messages pi does not classify as retryable by
 * default.  This extension intercepts those messages on `message_end` and
 * rewrites errorMessage so pi's retry loop picks them up automatically.
 *
 * Behaviour:
 *  - Any error from the ebay provider is considered retryable (including
 *    "Invalid token" and other previously-permanent errors, which in practice
 *    are transient gateway/proxy failures on the eBay stack).
 *  - Up to MAX_RETRIES (3) attempts are made per agent turn.  On the 4th
 *    failure the error is left unchanged so pi surfaces it to the user.
 *  - A loading spinner / status message is always shown while retrying.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_RETRIES = 3;
const STATUS_KEY = "ebay-retry";

// ── Extension ────────────────────────────────────────────────────────────────

export default function ebayRetry(pi: ExtensionAPI) {
	// Per-turn retry counter: reset at the start of each LLM turn so every
	// turn gets a fresh 3-retry budget independently.
	let retryCount = 0;

	pi.on("turn_start", (_event, ctx) => {
		if (ctx.model?.provider !== "ebay") return;
		retryCount = 0;
	});

	pi.on("message_end", (event, ctx) => {
		const { message } = event;

		// Only act on failed assistant messages from the ebay provider
		if (message.role !== "assistant") return;
		if (message.stopReason !== "error") return;
		if (message.provider !== "ebay") return;

		const errorMessage = message.errorMessage ?? "";

		// Already in a format pi recognises – nothing to do
		if (errorMessage.startsWith("overloaded_error")) return;

		// Exhausted retries – surface the original error to the user
		if (retryCount >= MAX_RETRIES) {
			ctx.ui.setStatus(STATUS_KEY, "");
			if (ctx.hasUI) {
				ctx.ui.notify(
					`eBay proxy: giving up after ${MAX_RETRIES} retries. Last error: ${errorMessage.slice(0, 120)}`,
					"error",
				);
			}
			return;
		}

		retryCount++;

		const label = `eBay proxy error – retrying (${retryCount}/${MAX_RETRIES})…`;

		// Always show a loading spinner so the user knows something is happening
		ctx.ui.setStatus(STATUS_KEY, label);

		if (ctx.hasUI) {
			ctx.ui.notify(
				`${label} ${errorMessage.slice(0, 80)}`,
				"warning",
			);
		}

		// Rewrite to the canonical overloaded_error prefix so pi's retry
		// loop treats this the same as a 529 Anthropic overload.
		return {
			message: {
				...message,
				errorMessage: `overloaded_error: ${errorMessage}`,
			},
		};
	});

	pi.on("agent_end", (_event, ctx) => {
		if (ctx.model?.provider !== "ebay") return;
		// Clear the spinner once the agent finishes (success or final failure)
		ctx.ui.setStatus(STATUS_KEY, "");
		retryCount = 0;
	});
}
