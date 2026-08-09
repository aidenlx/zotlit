// How one Citation is presented once its formatted text is known.

import type { CitationSource } from "@/lib/citation-fragment";
import { themeHook } from "@/lib/theme-hooks";
import type { CitedWork } from "@/services/citekey-navigation";

// One citation as a surface holds it: the same shape whether a note wrote it or
// a wikilink derivation did, which is what lets the two syntaxes share a render.
export type { CitationKey, CitationSource } from "@/lib/citation-fragment";

/** What one document's surfaces need to put text in their citations' place. */
export interface DocumentCitations {
  /** The formatted citation of one source, for every source the engine rendered. */
  formatted: ReadonlyMap<string, DocumentFragment>;
  /** `Creators (Year)` by citekey, used for navigation labels. */
  summaries: ReadonlyMap<string, string>;
}

/**
 * The `Creators (Year)` summary of one citekey, or `undefined` for a key that
 * reaches no Zotero Item.
 */
export type SummaryOf = (citekey: string) => string | undefined;

/**
 * The works one rendered citation names, in the order it names them.
 *
 * A citation that writes the same key twice names one work, so a menu built
 * from these lists each work once.
 */
export function citedWorks(
  { source, keys }: CitationSource,
  summaryOf: SummaryOf,
): CitedWork[] {
  const works = new Map<string, CitedWork>();
  for (const key of keys) {
    const { citekey } = key;
    if (works.has(citekey)) continue;
    works.set(citekey, {
      citekey,
      label: summaryOf(citekey) ?? source.slice(key.start, key.end),
    });
  }
  return [...works.values()];
}

/**
 * What one Citation shows: the text the engine formatted for its source.
 *
 * @returns `null` until a complete document render supplies this citation,
 *   which leaves its native source presentation unchanged.
 */
export function citationContent(
  citation: CitationSource,
  { formatted }: DocumentCitations,
): DocumentFragment | string | null {
  return formatted.get(citation.source) ?? null;
}

/**
 * A citation's content, ready for one surface to insert.
 *
 * Formatted content is shared with every other surface showing the same
 * citation, so a fragment goes in as a clone rather than being moved out of the
 * held text.
 */
export function citationInsert(content: Node | string): Node | string {
  return typeof content === "string" ? content : content.cloneNode(true);
}

/** Wraps a citation's content in the element a surface shows. */
export function citationElement(
  doc: Document,
  content: Node | string,
  themeClasses: readonly string[] = [],
): HTMLElement {
  const element = doc.createElement("span");
  element.classList.add(themeHook.citation, ...themeClasses);
  element.append(citationInsert(content));
  return element;
}
