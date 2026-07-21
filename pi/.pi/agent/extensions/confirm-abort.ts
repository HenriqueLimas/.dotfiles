import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";

class ConfirmAbortEditor extends CustomEditor {
	private confirmationPending = false;
	private extensionContext?: ExtensionContext;

	setExtensionContext(ctx: ExtensionContext): void {
		this.extensionContext = ctx;
	}

	override handleInput(data: string): void {
		const ctx = this.extensionContext;

		if (!ctx || !matchesKey(data, Key.escape) || this.isShowingAutocomplete() || ctx.isIdle()) {
			super.handleInput(data);
			return;
		}

		if (this.confirmationPending) return;

		this.confirmationPending = true;
		void this.confirmAbort(ctx);
	}

	private async confirmAbort(ctx: ExtensionContext): Promise<void> {
		try {
			const confirmed = await ctx.ui.confirm(
				"Abort current operation?",
				"The agent is still working. Abort it and restore any queued messages to the editor?",
			);

			if (confirmed && !ctx.isIdle()) {
				ctx.abort();
			}
		} finally {
			this.confirmationPending = false;
		}
	}
}

export default function confirmAbort(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = new ConfirmAbortEditor(tui, theme, keybindings);
			editor.setExtensionContext(ctx);
			return editor;
		});
	});
}
