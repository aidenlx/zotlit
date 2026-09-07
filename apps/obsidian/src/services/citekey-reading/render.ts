// The citations one rendered reading-view section holds, and the swap that puts formatted text in their place.

import { scanPandocCitations } from "@zotlit/templates/pandoc-citation";
import type { PandocTextSpan as TextSpan } from "@zotlit/templates/pandoc-citation";

import type { CitationSource } from "@/services/citation-text/present";

/**
 * Elements whose text is never a citation. Code, math, and the frontmatter
 * table are the reading-view shape of the same exclusion zones the index masks
 * and the editor's token classes rule out; a link is left out because a
 * Literature Note wikilink is the Wikilink Reading Rendering's surface, and any
 * other link is Obsidian's.
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
    for (const { start, end, items } of scanPandocCitations(text.data)) {
      found.push({
        node: text,
        start,
        end,
        source: text.data.slice(start, end),
        keys: items.map((item) => ({
          citekey: item.citationKey,
          start: item.start - start,
          end: item.end - start,
        })),
      });
    }
  }
  return found;
}

/**
 * The node to put in a citation's place, or `null` to leave its source alone.
 *
 * `index` is the citation's place in the section's own document order, which is
 * what tells two identical sources of one section apart.
 */
export type FormatCitation = (
  citation: SectionCitation,
  index: number,
) => Node | null;

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
  for (let index = citations.length - 1; index >= 0; index -= 1) {
    const citation = citations[index]!;
    const formatted = format(citation, index);
    if (!formatted) continue;
    const { node, start, end } = citation;
    node.splitText(end);
    node.splitText(start).replaceWith(formatted);
  }
}
