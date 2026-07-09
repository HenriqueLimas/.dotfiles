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
 * Errors that ARE normalised (transient / infrastructure):
 *   - "Request timed out."
 *   - "Connection error."
 *   - CircuitBreaker OPEN / HALF_OPEN  (Azure load-balancer)
 *   - Connection error / PoolAcquirePendingLimitException (Netty pool)
 *   - 500 Re-thrown: OpenCircuitError  (Envoy upstream)
 *   - 503 upstream model provider high demand
 *
 * Errors that are NOT normalised (permanent / need human action):
 *   - 400  model not available for integrator
 *   - 401 / 403  invalid token / signature
 *   - Failed to resolve API key
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── Transient patterns that should trigger pi's auto-retry ──────────────────

const TRANSIENT_PATTERNS: RegExp[] = [
	// Generic timeouts and connection drops
	/^Request timed out\.$/i,
	/^Connection error\.$/i,

	// Azure circuit-breaker (OPEN or HALF_OPEN = upstream saturated)
	/CircuitBreaker .+ is (OPEN|HALF_OPEN)/i,

	// Netty connection pool exhaustion
	/Connection error.*PoolAcquirePendingLimitException/i,
	/reactor\.netty.*PoolAcquirePendingLimitException/i,

	// Envoy / gateway open-circuit error
	/OpenCircuitError/i,
	/Re-thrown:.*OpenCircuitError/i,

	// 503 upstream overloaded
	/upstream model provider is currently experiencing high demand/i,
	/OpenAI API error \(503\)/i,
];

// ── Permanent patterns – must NOT be rewritten ──────────────────────────────

const PERMANENT_PATTERNS: RegExp[] = [
	// 400 model-not-available-for-integrator
	/requested model is not available for integrator/i,
	// 401 / 403 auth failures
	/Invalid token/i,
	/signature verification failed/i,
	/Failed to resolve API key/i,
	// 400 invalid request body
	/invalid_request_body/i,
];

function isTransient(errorMessage: string): boolean {
	if (PERMANENT_PATTERNS.some((re) => re.test(errorMessage))) return false;
	return TRANSIENT_PATTERNS.some((re) => re.test(errorMessage));
}

// ── Extension ────────────────────────────────────────────────────────────────

export default function ebayRetry(pi: ExtensionAPI) {
	pi.on("message_end", (event, ctx) => {
		const { message } = event;

		// Only act on failed assistant messages from the ebay provider
		if (message.role !== "assistant") return;
		if (message.stopReason !== "error") return;
		if (message.provider !== "ebay") return;

		const errorMessage = message.errorMessage ?? "";

		// Already in a format pi recognises – nothing to do
		if (errorMessage.startsWith("overloaded_error")) return;

		if (!isTransient(errorMessage)) return;

		if (ctx.hasUI) {
			ctx.ui.notify(
				`eBay proxy transient error – will retry: ${errorMessage.slice(0, 80)}`,
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
}
