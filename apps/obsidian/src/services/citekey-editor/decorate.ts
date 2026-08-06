// Pure decoration-range computation for the citekey editor treatment.

import { scanCitekeys, type TextSpan } from "@/lib/citation-grammar";

/** A citekey span to mark, with the key the click flow resolves. */
export interface CitekeyMark extends TextSpan {
  citekey: string;
}

/**
 * Token and line classes of Obsidian's Markdown stream parser that hold text
 * ZotLit never reads as a citation: code, math, `%%` comments, frontmatter, and
 * the autolinked URLs and bare emails that Pandoc's own `notAfterString` guard
 * cannot see. A span carrying any of them stays plain text.
 *
 * The vocabulary is an Obsidian internal pinned to 1.13, so an unknown class
 * decorates rather than skips — a renamed class costs styling, never correctness
 * of the text itself.
 *
 * @see docs/research/pandoc-citekey-cm6-live-preview.md — section 6.3
 */
const EXCLUDED_CLASSES: ReadonlySet<string> = new Set([
  "hmd-codeblock",
  "hmd-indented-code",
  "HyperMD-codeblock",
  "inline-code",
  "math",
  "math-block",
  "comment",
  "hmd-frontmatter",
  "url",
]);

/**
 * @param classes space-separated token or line classes of one syntax-tree node,
 *   as `tokenClassNodeProp` and `lineClassNodeProp` carry them.
 * @returns whether a span covered by that node stays undecorated.
 */
export function isExcludedTokenClass(classes: string): boolean {
  return classes.split(" ").some((name) => EXCLUDED_CLASSES.has(name));
}

/**
 * The mark covers `@citekey` itself, leaving Pandoc's author-suppression `-`
 * outside it: the `@` and the key are the text a click resolves.
 *
 * @param text one line of the document.
 * @param isExcluded decides, per candidate span in `text`'s own offsets,
 *   whether the editor's syntax tree rules it out.
 * @returns the spans to mark, in document order.
 */
export function citekeyMarks(
  text: string,
  isExcluded: (span: TextSpan) => boolean,
): CitekeyMark[] {
  const marks: CitekeyMark[] = [];
  for (const key of scanCitekeys(text)) {
    const span = {
      start: key.suppressAuthor ? key.start + 1 : key.start,
      end: key.end,
    };
    if (isExcluded(span)) continue;
    marks.push({ ...span, citekey: key.citekey });
  }
  return marks;
}
