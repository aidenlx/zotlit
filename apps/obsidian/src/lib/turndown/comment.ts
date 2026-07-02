// HTML→Markdown conversion for Zotero annotation comments.

import type TurndownService from "turndown";

/**
 * Build a minimal Turndown for Zotero annotation comments.
 *
 * A comment is not rich note HTML: Zotero's reader comment editor stores "plain
 * text flavored with some HTML tags" — only attribute-free `<i>`/`<b>`/`<sub>`/
 * `<sup>` and literal `\n` line breaks, with no note-schema wrapper, math,
 * citations, lists, links, or images. So the converter needs only the inline
 * subset: bold/italic come from Turndown's defaults; `<sub>`/`<sup>` are kept as
 * inline HTML (Markdown has no equivalent), mirroring the note converter. This
 * is intentionally not `createNoteTurndown` — the note rules can never match a
 * comment, and reusing them would leak the note-import prepass protocol (the
 * callout sentinel) into a path that never runs it.
 *
 * Markdown escaping is disabled to match Obsidian's `htmlToMarkdown` and the
 * note converter, so a literal `*`/`_` renders identically whether it came from
 * a comment or a note body.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/reader/src/common/components/common/editor.js#L4 — the `supportedFormats` allowlist (`['i','b','sub','sup']`) and attribute-stripping `clean`.
 */
export function createCommentTurndown(
  Turndown: typeof TurndownService,
): TurndownService {
  const td = new Turndown();
  td.addRule("subscript", {
    filter: "sub",
    replacement: (content) => `<sub>${content}</sub>`,
  });
  td.addRule("superscript", {
    filter: "sup",
    replacement: (content) => `<sup>${content}</sup>`,
  });
  td.escape = (text) => text;
  return td;
}

/**
 * `\n` is promoted to `<br>` before conversion (mirroring Zotero's own
 * note-embed transform) so the converter keeps line breaks instead of
 * collapsing them as HTML whitespace. Pass one shared
 * {@link createCommentTurndown} instance across a batch rather than building one
 * per comment.
 */
export function commentToMarkdown(td: TurndownService, html: string): string {
  return td.turndown(html.replaceAll("\n", "<br>")).trim();
}
