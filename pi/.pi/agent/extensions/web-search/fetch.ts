import { lookup } from "node:dns/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Parser } from "htmlparser2";
import robotsParser from "robots-parser";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { Agent, request } from "undici";
import { isUnsafeAddress, type DomainPolicy, validatePublicUrl } from "./security.ts";

const USER_AGENT =
	"PiWebResearchBot/2.0 (pi coding agent; respectful page fetcher; +https://github.com/earendil-works/pi-mono)";
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_ROBOTS_BYTES = 512 * 1024;
const MAX_REDIRECTS = 5;
const MAX_ATTEMPTS = 3;

export type FetchFormat = "markdown" | "text";

export interface FetchedPage {
	url: string;
	contentType: string;
	format: FetchFormat;
	content: string;
}

export class WebFetcher {
	private readonly robotsCache = new Map<string, Promise<string | undefined>>();
	private nextRequestAt = 0;
	private queue: Promise<void> = Promise.resolve();

	clear(): void {
		this.robotsCache.clear();
		this.nextRequestAt = 0;
		this.queue = Promise.resolve();
	}

	async fetch(
		inputUrl: string,
		format: FetchFormat,
		timeoutSeconds: number,
		policy: DomainPolicy,
		signal?: AbortSignal,
	): Promise<FetchedPage> {
		const url = await validatePublicUrl(inputUrl, policy);
		await this.assertRobotsAllowed(url, policy, signal);
		await this.rateLimit(signal);

		const response = await fetchWithRedirects(url, MAX_RESPONSE_BYTES, timeoutSeconds * 1_000, policy, signal, accept(format));
		const mime = mimeFrom(response.contentType);
		if (!isTextualMime(mime)) {
			throw new Error(`Unsupported fetched content type: ${mime || "unknown"}`);
		}
		const decoded = new TextDecoder().decode(response.bytes);
		const content = response.contentType.toLowerCase().includes("text/html")
			? format === "markdown"
				? convertHtmlToMarkdown(decoded)
				: extractTextFromHtml(decoded)
			: decoded;
		return {
			url: response.finalUrl,
			contentType: response.contentType,
			format,
			content,
		};
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

	private async assertRobotsAllowed(url: string, policy: DomainPolicy, signal?: AbortSignal): Promise<void> {
		const target = new URL(url);
		let pending = this.robotsCache.get(target.origin);
		if (!pending) {
			pending = (async () => {
				try {
					const robotsUrl = new URL("/robots.txt", target.origin).toString();
					const response = await fetchWithRedirects(
						robotsUrl,
						MAX_ROBOTS_BYTES,
						15_000,
						policy,
						signal,
						"text/plain",
						true,
					);
					return new TextDecoder().decode(response.bytes);
				} catch (error) {
					if (error instanceof HttpStatusError && error.status === 404) return undefined;
					throw new Error(`Could not verify robots.txt for ${target.hostname}: ${errorMessage(error)}`);
				}
			})();
			this.robotsCache.set(target.origin, pending);
		}

		const robots = await pending;
		if (!robots) return;
		const parseRobots = robotsParser as unknown as (
			url: string,
			contents: string,
		) => {
			isAllowed(url: string, userAgent?: string): boolean | undefined;
			getCrawlDelay(userAgent?: string): number | undefined;
		};
		const rules = parseRobots(new URL("/robots.txt", target.origin).toString(), robots);
		if (rules.isAllowed(url, USER_AGENT) === false) throw new Error(`robots.txt disallows fetching ${url}`);
		const crawlDelay = rules.getCrawlDelay(USER_AGENT);
		if (typeof crawlDelay === "number" && crawlDelay > 0) {
			await delay(Math.min(crawlDelay * 1_000, 30_000), undefined, { signal });
		}
	}
}

async function fetchWithRedirects(
	initialUrl: string,
	maximumBytes: number,
	timeoutMs: number,
	policy: DomainPolicy,
	signal: AbortSignal | undefined,
	acceptHeader: string,
	allowAnyStatus = false,
): Promise<{ bytes: Uint8Array; contentType: string; finalUrl: string }> {
	let url = await validatePublicUrl(initialUrl, policy);
	for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
		const response = await requestWithRetries(url, maximumBytes, timeoutMs, signal, acceptHeader);
		if (response.status >= 300 && response.status < 400) {
			if (!response.location) throw new Error(`Redirect ${response.status} from ${url} omitted Location`);
			if (redirect === MAX_REDIRECTS) throw new Error(`Web fetch exceeded ${MAX_REDIRECTS} redirects`);
			url = await validatePublicUrl(new URL(response.location, url).toString(), policy);
			continue;
		}
		if (!allowAnyStatus && (response.status < 200 || response.status >= 300)) {
			throw new HttpStatusError(`Web fetch failed with HTTP ${response.status}`, response.status);
		}
		if (allowAnyStatus && (response.status < 200 || response.status >= 300)) {
			throw new HttpStatusError(`Request failed with HTTP ${response.status}`, response.status);
		}
		return { bytes: response.bytes, contentType: response.contentType, finalUrl: url };
	}
	throw new Error("Web fetch redirect handling failed");
}

async function requestWithRetries(
	url: string,
	maximumBytes: number,
	timeoutMs: number,
	signal: AbortSignal | undefined,
	acceptHeader: string,
): Promise<PinnedResponse> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const response = await requestPinned(url, maximumBytes, timeoutMs, signal, acceptHeader);
			if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
				await delay(response.retryAfterMs ?? 500 * 2 ** (attempt - 1), undefined, { signal });
				continue;
			}
			return response;
		} catch (error) {
			lastError = error;
			if (signal?.aborted || attempt === MAX_ATTEMPTS || !isTransient(error)) throw error;
			await delay(500 * 2 ** (attempt - 1), undefined, { signal });
		}
	}
	throw lastError;
}

interface PinnedResponse {
	status: number;
	bytes: Uint8Array;
	contentType: string;
	location?: string;
	retryAfterMs?: number;
}

async function requestPinned(
	urlString: string,
	maximumBytes: number,
	timeoutMs: number,
	signal: AbortSignal | undefined,
	acceptHeader: string,
): Promise<PinnedResponse> {
	const url = new URL(urlString);
	const addresses = await lookup(url.hostname, { all: true, verbatim: true });
	if (addresses.length === 0 || addresses.some(({ address }) => isUnsafeAddress(address))) {
		throw new Error(`Refused unsafe DNS resolution for ${url.hostname}`);
	}
	const selected = addresses[0];
	const dispatcher = new Agent({
		connect: {
			lookup(hostname, options, callback) {
				if (hostname !== url.hostname) {
					callback(new Error("Hostname changed during pinned request"), "", 0);
					return;
				}
				if (options.all) {
					(callback as unknown as (error: null, addresses: Array<{ address: string; family: number }>) => void)(
						null,
						[{ address: selected.address, family: selected.family }],
					);
				} else callback(null, selected.address, selected.family);
			},
		},
	});
	const timeout = AbortSignal.timeout(timeoutMs);
	const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
	try {
		let response: Awaited<ReturnType<typeof request>>;
		try {
			response = await request(url, {
				method: "GET",
				dispatcher,
				signal: combinedSignal,
				headers: {
					accept: acceptHeader,
					"accept-language": "en-US,en;q=0.9",
					"user-agent": USER_AGENT,
				},
			});
		} catch (error) {
			if (timeout.aborted && !signal?.aborted) throw new Error(`Web fetch timed out after ${timeoutMs / 1_000} seconds`);
			if (signal?.aborted) throw new Error("Web fetch was cancelled");
			throw new Error(`Web fetch network error: ${errorMessage(error)}`);
		}

		const chunks: Buffer[] = [];
		let total = 0;
		for await (const chunk of response.body) {
			const bytes = Buffer.from(chunk);
			total += bytes.byteLength;
			if (total > maximumBytes) {
				response.body.destroy();
				throw new Error(`Web response exceeded ${Math.ceil(maximumBytes / 1024 / 1024)} MB`);
			}
			chunks.push(bytes);
		}
		return {
			status: response.statusCode,
			bytes: Buffer.concat(chunks),
			contentType: String(response.headers["content-type"] ?? ""),
			...(response.headers.location ? { location: String(response.headers.location) } : {}),
			...(response.headers["retry-after"]
				? { retryAfterMs: parseRetryAfter(String(response.headers["retry-after"])) }
				: {}),
		};
	} finally {
		await dispatcher.close();
	}
}

export function extractTextFromHtml(html: string): string {
	let text = "";
	let skipDepth = 0;
	const skipped = new Set(["script", "style", "noscript", "iframe", "object", "embed", "svg"]);
	const parser = new Parser({
		onopentag(name) {
			if (skipDepth > 0 || skipped.has(name)) skipDepth++;
			else if (["p", "div", "section", "article", "header", "footer", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "br"].includes(name)) text += "\n";
		},
		ontext(value) {
			if (skipDepth === 0) text += value;
		},
		onclosetag(name) {
			if (skipDepth > 0) skipDepth--;
			else if (["p", "div", "section", "article", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"].includes(name)) text += "\n";
		},
	});
	parser.end(html);
	return text
		.split("\n")
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.join("\n");
}

export function convertHtmlToMarkdown(html: string): string {
	const turndown = new TurndownService({
		headingStyle: "atx",
		hr: "---",
		bulletListMarker: "-",
		codeBlockStyle: "fenced",
		emDelimiter: "*",
	});
	turndown.use(gfm);
	turndown.remove(["script", "style", "meta", "link", "noscript", "iframe", "object", "embed", "img"]);
	turndown.addRule("remove-svg", {
		filter: (node) => node.nodeName === "SVG",
		replacement: () => "",
	});
	return turndown.turndown(html);
}

function accept(format: FetchFormat): string {
	return format === "markdown"
		? "text/markdown;q=1.0, text/plain;q=0.9, text/html;q=0.8, */*;q=0.1"
		: "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
}

function mimeFrom(contentType: string): string {
	return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isTextualMime(mime: string): boolean {
	return (
		!mime ||
		mime.startsWith("text/") ||
		mime === "application/json" ||
		mime.endsWith("+json") ||
		mime === "application/xml" ||
		mime.endsWith("+xml")
	);
}

class HttpStatusError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

function parseRetryAfter(value: string): number | undefined {
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(0, seconds * 1_000));
	const date = Date.parse(value);
	return Number.isFinite(date) ? Math.min(30_000, Math.max(0, date - Date.now())) : undefined;
}

function isTransient(error: unknown): boolean {
	return error instanceof Error && /network|socket|connect|reset|timed out|other side closed/i.test(error.message);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
