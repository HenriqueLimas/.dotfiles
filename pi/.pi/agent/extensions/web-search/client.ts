import { setTimeout as delay } from "node:timers/promises";

export const EXA_MCP_ENDPOINT = "https://mcp.exa.ai/mcp";
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_ATTEMPTS = 3;

export interface SearchOptions {
	query: string;
	numResults: number;
	livecrawl: "fallback" | "preferred";
	type: "auto" | "fast" | "deep";
	contextMaxCharacters: number;
}

export class ExaSearchClient {
	private nextRequestAt = 0;
	private queue: Promise<void> = Promise.resolve();

	async search(options: SearchOptions, signal?: AbortSignal): Promise<string> {
		await this.rateLimit(signal);
		const endpoint = new URL(EXA_MCP_ENDPOINT);
		if (process.env.EXA_API_KEY) endpoint.searchParams.set("exaApiKey", process.env.EXA_API_KEY);

		const request = {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: "web_search_exa",
				arguments: options,
			},
		};

		let lastError: unknown;
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			try {
				return await requestOnce(endpoint, request, signal);
			} catch (error) {
				lastError = error;
				if (signal?.aborted || attempt === MAX_ATTEMPTS || !isRetryable(error)) throw error;
				const retryAfter = error instanceof HttpError ? error.retryAfterMs : undefined;
				await delay(retryAfter ?? 500 * 2 ** (attempt - 1), undefined, { signal });
			}
		}
		throw lastError;
	}

	private async rateLimit(signal?: AbortSignal): Promise<void> {
		const previous = this.queue;
		let release!: () => void;
		this.queue = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			const waitMs = Math.max(0, this.nextRequestAt - Date.now());
			if (waitMs > 0) await delay(waitMs, undefined, { signal });
			this.nextRequestAt = Date.now() + 500;
		} finally {
			release();
		}
	}
}

async function requestOnce(endpoint: URL, payload: unknown, signal?: AbortSignal): Promise<string> {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
	let response: Response;
	try {
		response = await fetch(endpoint, {
			method: "POST",
			redirect: "error",
			signal: combinedSignal,
			headers: {
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
				"user-agent": userAgent(),
			},
			body: JSON.stringify(payload),
		});
	} catch (error) {
		if (timeout.aborted && !signal?.aborted) {
			throw new Error(`Exa search timed out after ${REQUEST_TIMEOUT_MS / 1_000} seconds`);
		}
		if (signal?.aborted) throw new Error("Web search was cancelled");
		throw new NetworkError(`Exa search network error: ${errorMessage(error)}`);
	}

	const body = await readLimitedBody(response, MAX_RESPONSE_BYTES);
	if (!response.ok) {
		throw new HttpError(
			`Exa search failed with HTTP ${response.status}${safeErrorDetail(body)}`,
			response.status,
			parseRetryAfter(response.headers.get("retry-after")),
		);
	}
	const result = parseMcpResponse(body);
	if (!result) return "No search results found. Try a different query.";
	return result;
}

export function parseMcpResponse(body: string): string | undefined {
	const candidates: string[] = [];
	const trimmed = body.trim();
	if (trimmed.startsWith("{")) candidates.push(trimmed);
	for (const line of body.split("\n")) {
		if (line.startsWith("data: ") && line.slice(6).trim() !== "[DONE]") candidates.push(line.slice(6));
	}

	for (const candidate of candidates) {
		try {
			const payload = JSON.parse(candidate) as {
				error?: { message?: unknown };
				result?: { content?: Array<{ type?: unknown; text?: unknown }> };
			};
			if (typeof payload.error?.message === "string") throw new Error(`Exa MCP error: ${payload.error.message}`);
			const text = payload.result?.content?.find((item) => typeof item.text === "string")?.text;
			if (typeof text === "string" && text.trim()) return text;
		} catch (error) {
			if (error instanceof Error && error.message.startsWith("Exa MCP error:")) throw error;
		}
	}
	return undefined;
}

async function readLimitedBody(response: Response, maximumBytes: number): Promise<string> {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maximumBytes) {
			await reader.cancel();
			throw new Error(`Exa search response exceeded ${Math.floor(maximumBytes / 1024)} KB`);
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString("utf8");
}

class NetworkError extends Error {}

class HttpError extends Error {
	readonly status: number;
	readonly retryAfterMs?: number;

	constructor(message: string, status: number, retryAfterMs?: number) {
		super(message);
		this.status = status;
		this.retryAfterMs = retryAfterMs;
	}
}

function isRetryable(error: unknown): boolean {
	return error instanceof NetworkError || (error instanceof HttpError && (error.status === 429 || error.status >= 500));
}

function parseRetryAfter(value: string | null): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(0, seconds * 1_000));
	const date = Date.parse(value);
	return Number.isFinite(date) ? Math.min(30_000, Math.max(0, date - Date.now())) : undefined;
}

function safeErrorDetail(body: string): string {
	try {
		const payload = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
		const message =
			typeof payload.error === "string"
				? payload.error
				: typeof payload.error?.message === "string"
					? payload.error.message
					: typeof payload.message === "string"
						? payload.message
						: undefined;
		return message ? `: ${message.replace(/[\r\n]+/g, " ").slice(0, 500)}` : "";
	} catch {
		return "";
	}
}

function userAgent(): string {
	return `pi-web-search/2.0 (pi coding agent; ${process.platform} ${process.arch}; +https://github.com/earendil-works/pi-mono)`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
