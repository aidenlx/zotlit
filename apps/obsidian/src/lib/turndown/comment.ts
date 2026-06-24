// HTML→Markdown conversion for Zotero annotation comments.

import type TurndownService from "turndown";

/**
 * Convert a Zotero annotation comment to Markdown.
 *
 * Annotation comments are not rich note HTML: Zotero's comment editor stores
 * "plain text flavored with some HTML tags" — only `<i>`/`<b>`/`<sub>`/`<sup>`
 * and literal `\n` line breaks, with no note-schema wrapper, math, citations,
 * lists, or images. A note Turndown instance (`createNoteTurndown`) is therefore
 * safe to reuse — those four tags are a strict subset of note HTML and its extra
 * Zotero-note rules never match a comment. Pass one shared instance across a
 * batch rather than building one per comment. `\n` is promoted to `<br>` first
 * (mirroring Zotero's own note-embed transform) so the converter keeps line
 * breaks instead of collapsing them as HTML whitespace.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/editorInstance.js#L1761-L1816 — the `supportedFormats` allowlist (`['i','b','sub','sup']`) and the `\n`→`<br>` (`innerText`) transform.
 */
export function commentToMarkdown(td: TurndownService, html: string): string {
  // Literal newlines, promoted to `<br>` before conversion.
  return td.turndown(html.replaceAll("\n", "<br>")).trim();
}
