import { rm } from "node:fs/promises";
import { join } from "node:path";

export type CaptureCommand = (command: string, args: string[], cwd: string) => Promise<string>;
export type RemoveCheckout = (path: string) => Promise<void>;

export interface PreparePullRequestCheckoutOptions {
	target?: string;
	headRefOid: string;
	preparationDir: string;
	sourceCwd: string;
	captureCommand: CaptureCommand;
	removeCheckout?: RemoveCheckout;
}

/**
 * Clone the source repository into a disposable directory, then let gh fetch
 * and detach at the requested PR head. The source checkout is never changed.
 */
export async function preparePullRequestCheckout(options: PreparePullRequestCheckoutOptions): Promise<string> {
	const checkoutPath = join(options.preparationDir, "pr-head");
	const removeCheckout = options.removeCheckout ?? ((path) => rm(path, { recursive: true, force: true }));
	try {
		const sourceOrigin = await options.captureCommand("git", ["remote", "get-url", "origin"], options.sourceCwd);
		await options.captureCommand("git", ["clone", "--no-local", "--no-checkout", options.sourceCwd, checkoutPath], options.sourceCwd);
		await options.captureCommand("git", ["remote", "set-url", "origin", sourceOrigin], checkoutPath);
		await options.captureCommand("gh", ["pr", "checkout", ...(options.target ? [options.target] : []), "--detach"], checkoutPath);
		const actualHead = await options.captureCommand("git", ["rev-parse", "HEAD"], checkoutPath);
		if (actualHead.toLowerCase() !== options.headRefOid.toLowerCase()) {
			throw new Error(`PR checkout resolved to ${actualHead}, expected ${options.headRefOid}`);
		}
		return checkoutPath;
	} catch (error) {
		try {
			await removeCheckout(checkoutPath);
		} catch (cleanupError) {
			throw new Error(
				`Cannot prepare isolated checkout for PR ${options.target ?? "on the current branch"}: ${error instanceof Error ? error.message : String(error)}. Cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
			);
		}
		throw new Error(
			`Cannot prepare isolated checkout for PR ${options.target ?? "on the current branch"}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
