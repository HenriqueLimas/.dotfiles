import { buildParentReviewPrompt } from "./prompts.ts";
import type { BoraResultDetails, BoraStatus } from "./types.ts";

export const RESULT_MESSAGE = "bora-results" as const;

export interface BoraPublicationRun {
	id: string;
	task: string;
	model: string;
	status: BoraStatus;
	error?: string;
	output: string;
}

export interface BoraResultPublication {
	message: {
		customType: typeof RESULT_MESSAGE;
		content: string;
		display: false;
		details: BoraResultDetails;
	};
	options: {
		deliverAs: "followUp";
		triggerTurn: true;
	};
}

export function buildBoraResultPublication(run: BoraPublicationRun): BoraResultPublication {
	return {
		message: {
			customType: RESULT_MESSAGE,
			content: buildParentReviewPrompt({
				task: run.task,
				status: run.status,
				error: run.error,
				output: run.output,
			}),
			display: false,
			details: {
				version: 1,
				id: run.id,
				task: run.task,
				model: run.model,
				status: run.status,
				error: run.error,
			},
		},
		options: {
			deliverAs: "followUp",
			triggerTurn: true,
		},
	};
}
