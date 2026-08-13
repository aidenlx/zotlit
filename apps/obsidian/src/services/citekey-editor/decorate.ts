// Pure decoration-range computation for the citekey editor treatment.

import { scanCitations, scanCitekeys } from "@/lib/citation-grammar";
import type { TextSpan } from "@/lib/citation-grammar";
import type { CitationSource } from "@/services/citation-text/present";

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
 * Obsidian's class for the superscript run of a footnote: the marker of a
 * `[^ref]`, and the whole body of an inline note `^[...]`. It carries the
 * smaller type and the raised baseline, so text that loses it drops out of the
 * note it is written in.
 */
const FOOTNOTE_CLASS = "footref";

/**
 * @param classes {@link isExcludedTokenClass}
 * @returns whether a span covered by that node is footnote text.
 */
export function isFootnoteTokenClass(classes: string): boolean {
  return classes.split(" ").includes(FOOTNOTE_CLASS);
}

/**
 * The class a widget standing in footnote text carries itself, when the run it
 * sits in passes nothing down — the same way the wikilink surface hands its
 * citation widget the classes of the text it hides. Only this one class
 * carries over: the rest describe the markup the widget takes the place of,
 * which it no longer shows.
 */
export const FOOTNOTE_WIDGET_CLASS = `cm-${FOOTNOTE_CLASS}`;

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

/** A citekey mark plus whether it resolves to a Literature Note. */
export interface ResolvedCitekeyMark extends CitekeyMark {
  resolved: boolean;
}

/**
 * Attaches resolution state to each mark, so the caller can style a broken
 * reference apart from one that resolves. Kept apart from {@link citekeyMarks}
 * so the click-target lookup, which needs no resolution state, stays free of a
 * resolver dependency.
 *
 * @param resolves {@link ../extension.ResolveCitekey}
 */
export function resolveCitekeyMarks(
  marks: readonly CitekeyMark[],
  resolves: (citekey: string) => boolean,
): ResolvedCitekeyMark[] {
  return marks.map((mark) => ({ ...mark, resolved: resolves(mark.citekey) }));
}

/** One Citation of a line, at the range a widget would replace. */
export interface CitationRange extends TextSpan, CitationSource {}

/**
 * A widget replaces a whole Citation — a Citation Cluster or a bare
 * author-in-text key — because that is the unit a style formats, and it carries
 * Pandoc's author-suppression `-` for the same reason.
 *
 * @param text one line of the document.
 * @param isExcluded decides, per candidate span in `text`'s own offsets,
 *   whether the editor's syntax tree rules it out.
 * @returns the citations to replace, in document order, each with its keys at
 *   their offsets within its own source.
 */
export function citationRanges(
  text: string,
  isExcluded: (span: TextSpan) => boolean,
): CitationRange[] {
  const found: CitationRange[] = [];
  for (const { start, end, keys } of scanCitations(text)) {
    if (isExcluded({ start, end })) continue;
    found.push({
      start,
      end,
      source: text.slice(start, end),
      keys: keys.map((key) => ({
        citekey: key.citekey,
        start: key.start - start,
        end: key.end - start,
      })),
    });
  }
  return found;
}

/**
 * A widget hides the text its citation covers, so the marks under it would show
 * nothing; leaving them out also keeps the decoration set free of ranges that
 * run into a replacement. A citation contains every key it names, so testing
 * containment drops exactly the marks a widget hides.
 *
 * @param replaced the citations a widget takes the place of, in line offsets.
 */
export function marksOutside(
  marks: readonly CitekeyMark[],
  replaced: readonly TextSpan[],
): CitekeyMark[] {
  return marks.filter(
    (mark) =>
      !replaced.some(
        ({ start, end }) => mark.start >= start && mark.end <= end,
      ),
  );
}
