// The citations one rendered reading-view section holds, and the swap that puts formatted text in their place.

import { scanCitations, type TextSpan } from "@/lib/citation-grammar";
import { type CitationSource } from "@/services/citation-text/present";

/**
 * Elements whose text is never a citation. Code, math, and the frontmatter
 * table are the reading-view shape of the same exclusion zones the index masks
 * and the editor's token classes rule out; a link is left to Obsidian, so a
 * wikilink in reading mode stays plain Obsidian.
 */
const EXCLUDED_SELECTOR =
  "code, pre, a, .math, mjx-container, .frontmatter, .metadata-container";

/** One citation of a rendered section, as the text node that wrote it holds it. */
export interface SectionCitation extends TextSpan, CitationSource {
  node: Text;
}

/**
 * @param root one rendered section, as a Markdown post-processor receives it.
 * @returns every citation in `root`, in document order.
 */
export function sectionCitations(root: HTMLElement): SectionCitation[] {
  const found: SectionCitation[] = [];
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text.parentElement?.closest(EXCLUDED_SELECTOR)) continue;
    for (const { start, end, keys } of scanCitations(text.data)) {
      found.push({
        node: text,
        start,
        end,
        source: text.data.slice(start, end),
        keys: keys.map((key) => ({
          citekey: key.citekey,
          start: key.start - start,
          end: key.end - start,
        })),
      });
    }
  }
  return found;
}

/** The node to put in a citation's place, or `null` to leave its source alone. */
export type FormatCitation = (citation: SectionCitation) => Node | null;

/**
 * Replaces each citation's source text with what `format` returns for it.
 *
 * The swap runs back to front, so every citation still to come sits ahead of
 * the splits already made and keeps the offsets it was read at.
 */
export function replaceCitations(
  citations: readonly SectionCitation[],
  format: FormatCitation,
): void {
  for (const citation of [...citations].reverse()) {
    const formatted = format(citation);
    if (!formatted) continue;
    const { node, start, end } = citation;
    node.splitText(end);
    node.splitText(start).replaceWith(formatted);
  }
}
