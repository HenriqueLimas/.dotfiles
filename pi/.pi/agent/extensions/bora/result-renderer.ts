import { Text } from "@earendil-works/pi-tui";
import type { BoraResultDetails } from "./types.ts";

const RESULT_STATUSES = new Set(["running", "completed", "failed", "aborted"]);

interface BoraResultMessage {
	details?: unknown;
	content?: unknown;
}

interface ResultRendererOptions {
	expanded?: boolean;
	outputPad: number;
}

interface ResultRendererTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

function isBoraResultDetails(value: unknown): value is BoraResultDetails {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const details = value as Partial<BoraResultDetails>;
	return (
		details.version === 1 &&
		typeof details.id === "string" &&
		typeof details.task === "string" &&
		typeof details.model === "string" &&
		typeof details.status === "string" &&
		RESULT_STATUSES.has(details.status) &&
		(details.error === undefined || typeof details.error === "string")
	);
}

export function renderBoraResult(
	message: BoraResultMessage,
	{ outputPad }: ResultRendererOptions,
	theme: ResultRendererTheme,
): Text {
	if (!isBoraResultDetails(message.details)) {
		return new Text(theme.fg("accent", theme.bold("Bora result")), outputPad, 0);
	}

	const details = message.details;
	let text = theme.fg("accent", theme.bold(`Bora ${details.status}`));
	text += ` ${theme.fg("dim", details.model)} · ${theme.fg("muted", details.id)}`;
	if (details.error) text += `\n${theme.fg("error", details.error)}`;
	return new Text(text, outputPad, 0);
}
