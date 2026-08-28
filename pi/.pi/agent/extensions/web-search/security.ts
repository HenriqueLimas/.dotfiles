import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface DomainPolicy {
	allowedDomains: string[];
	blockedDomains: string[];
}

const TRACKING_PARAMETERS = [
	"fbclid",
	"gclid",
	"mc_cid",
	"mc_eid",
	"ref_src",
];

export function normalizeDomain(value: string): string {
	const candidate = value.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
	if (!candidate || candidate.length > 253 || candidate.includes(":") || candidate.includes("/")) {
		throw new Error(`Invalid domain filter: ${JSON.stringify(value)}`);
	}

	let hostname: string;
	try {
		hostname = new URL(`https://${candidate}`).hostname.toLowerCase();
	} catch {
		throw new Error(`Invalid domain filter: ${JSON.stringify(value)}`);
	}
	if (!hostname.includes(".") || hostname === "localhost" || isIP(hostname) !== 0) {
		throw new Error(`Domain filters must be public DNS names: ${JSON.stringify(value)}`);
	}
	return hostname;
}

export function parseDomainList(value: string | undefined): string[] {
	if (!value) return [];
	return [...new Set(value.split(",").filter(Boolean).map(normalizeDomain))];
}

export function domainMatches(hostname: string, domain: string): boolean {
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function assertDomainAllowed(hostname: string, policy: DomainPolicy): void {
	const normalized = hostname.toLowerCase().replace(/\.$/, "");
	if (policy.blockedDomains.some((domain) => domainMatches(normalized, domain))) {
		throw new Error(`Domain is blocked by PI_WEB_BLOCKED_DOMAINS: ${normalized}`);
	}
	if (
		policy.allowedDomains.length > 0 &&
		!policy.allowedDomains.some((domain) => domainMatches(normalized, domain))
	) {
		throw new Error(`Domain is not allowed by PI_WEB_ALLOWED_DOMAINS: ${normalized}`);
	}
}

export function normalizeSourceUrl(value: string): string | undefined {
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		if (url.username || url.password) return undefined;
		url.hash = "";
		for (const key of [...url.searchParams.keys()]) {
			if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.includes(key.toLowerCase())) {
				url.searchParams.delete(key);
			}
		}
		return url.toString();
	} catch {
		return undefined;
	}
}

export async function validatePublicUrl(value: string, policy: DomainPolicy): Promise<string> {
	if (value.length > 8_192) throw new Error("URL exceeds the 8,192-character limit");

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Malformed URL: ${JSON.stringify(value)}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Unsafe URL scheme ${JSON.stringify(url.protocol)}; only http and https are allowed`);
	}
	if (url.username || url.password) throw new Error("URLs containing credentials are not allowed");

	const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
	if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
		throw new Error(`Localhost URLs are not allowed: ${hostname || "(empty hostname)"}`);
	}
	assertDomainAllowed(hostname, policy);

	if (isIP(hostname)) {
		if (isUnsafeAddress(hostname)) throw new Error(`Private, local, or reserved IP addresses are not allowed: ${hostname}`);
	} else {
		let addresses: Array<{ address: string; family: number }>;
		try {
			addresses = await lookup(hostname, { all: true, verbatim: true });
		} catch (error) {
			throw new Error(`DNS lookup failed for ${hostname}: ${errorMessage(error)}`);
		}
		if (addresses.length === 0) throw new Error(`DNS lookup returned no addresses for ${hostname}`);
		for (const { address } of addresses) {
			if (isUnsafeAddress(address)) {
				throw new Error(`DNS for ${hostname} resolves to a private, local, or reserved address`);
			}
		}
	}

	url.hostname = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
	url.hash = "";
	return url.toString();
}

export function validateReference(value: string): string {
	const ref = value.trim();
	if (!ref) throw new Error("Reference ID must not be empty");
	if (ref.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(ref)) {
		throw new Error(`Invalid page reference: ${JSON.stringify(value)}`);
	}
	return ref;
}

export function isUnsafeAddress(address: string): boolean {
	const version = isIP(address);
	if (version === 4) return isUnsafeIpv4(address);
	if (version !== 6) return true;

	const bytes = ipv6Bytes(address);
	if (!bytes) return true;
	const allZeroPrefix = bytes.slice(0, 10).every((byte) => byte === 0);
	if (allZeroPrefix && bytes[10] === 0xff && bytes[11] === 0xff) {
		return isUnsafeIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
	}
	const unspecifiedOrLoopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] <= 1;
	return (
		unspecifiedOrLoopback ||
		(bytes[0] & 0xfe) === 0xfc ||
		(bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) ||
		bytes[0] === 0xff ||
		(bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8)
	);
}

function ipv6Bytes(address: string): number[] | undefined {
	let normalized = address.toLowerCase();
	const ipv4 = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
	if (ipv4) {
		const octets = ipv4.split(".").map(Number);
		normalized =
			normalized.slice(0, -ipv4.length) +
			`${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
	}
	const halves = normalized.split("::");
	if (halves.length > 2) return undefined;
	const left = halves[0] ? halves[0].split(":") : [];
	const right = halves[1] ? halves[1].split(":") : [];
	const missing = 8 - left.length - right.length;
	if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined;
	const groups = [...left, ...Array(missing).fill("0"), ...right].map((part) => Number.parseInt(part, 16));
	if (groups.length !== 8 || groups.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) {
		return undefined;
	}
	return groups.flatMap((part) => [part >> 8, part & 0xff]);
}

function isUnsafeIpv4(address: string): boolean {
	const octets = address.split(".").map(Number);
	if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
		return true;
	}
	const [a, b] = octets;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0 && (octets[2] === 0 || octets[2] === 2)) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && octets[2] === 100) ||
		(a === 203 && b === 0 && octets[2] === 113) ||
		a >= 224
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
