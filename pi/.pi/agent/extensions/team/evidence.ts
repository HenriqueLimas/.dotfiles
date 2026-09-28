/**
 * Review evidence is untrusted repository content. It is written to
 * review-evidence.md, embedded in prompts, and may later be printed by a
 * terminal (`cat`, a pager, or a reviewer's bash call). Rewrite C0/C1 control
 * characters, including ESC, to visible caret notation so escape sequences in a
 * diff stay reviewable as text but can never drive a terminal. Tab, newline,
 * and carriage return are kept because diffs legitimately contain them.
 */
export function neutralizeControlCharacters(text: string): string {
	return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, (char) => {
		const code = char.charCodeAt(0);
		if (code === 0x7f) return "^?";
		if (code < 0x20) return `^${String.fromCharCode(code + 0x40)}`;
		return `\\u${code.toString(16).padStart(4, "0")}`;
	});
}
