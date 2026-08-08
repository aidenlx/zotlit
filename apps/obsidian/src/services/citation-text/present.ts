// How one Citation is presented once its text is known: the works it names, the summary it falls back to, and the element that shows it.

import type { TextSpan } from "@/lib/citation-grammar";
import type { CitedWork } from "@/services/citekey-navigation";

/** The class every formatted citation carries, for themes and snippets to reach. */
export const CITATION_CLASS = "zt-citation";

/** One `@citekey` of a citation, at its offset within the citation's own source. */
export interface CitationKey extends TextSpan {
  citekey: string;
}

/** One citation as a surface holds it, whichever surface read it. */
export interface CitationSource {
  /** The citation exactly as the note writes it. */
  source: string;
  keys: CitationKey[];
}

/** What one document's surfaces need to put text in their citations' place. */
export interface DocumentCitations {
  /** The formatted citation of one source, for every source the engine rendered. */
  formatted: ReadonlyMap<string, DocumentFragment>;
  /** `Creators (Year)` by citekey, the text a citation falls back to. */
  summaries: ReadonlyMap<string, string>;
}

/**
 * The `Creators (Year)` summary of one citekey, or `undefined` for a key that
 * reaches no Zotero Item.
 */
export type SummaryOf = (citekey: string) => string | undefined;

/**
 * The citation's own source with each key it names replaced by that work's
 * summary — the fallback for a citation no engine formatted, which keeps the
 * prefixes, locators, and brackets the author wrote.
 *
 * The summary names the creators, so Pandoc's author-suppression `-` goes with
 * the key it belongs to: only a style can suppress an author, and no style runs
 * here.
 *
 * @returns `null` when no key resolved, so the source stays as written.
 */
export function summarizeCitation(
  { source, keys }: CitationSource,
  summaryOf: SummaryOf,
): string | null {
  let text = "";
  let at = 0;
  let resolved = false;
  for (const key of keys) {
    const summary = summaryOf(key.citekey);
    if (summary === undefined) continue;
    text += source.slice(at, key.start) + summary;
    at = key.end;
    resolved = true;
  }
  return resolved ? text + source.slice(at) : null;
}

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
 * What one Citation shows: the text the engine formatted for its source, or —
 * with no engine, or with a source no render covered — the item summaries of
 * the works it names.
 *
 * @returns `null` when no key of the citation reaches a Zotero Item, which
 *   leaves its source as the author wrote it.
 */
export function citationContent(
  citation: CitationSource,
  { formatted, summaries }: DocumentCitations,
): DocumentFragment | string | null {
  return (
    formatted.get(citation.source) ??
    summarizeCitation(citation, (citekey) => summaries.get(citekey))
  );
}

/**
 * Wraps a citation's content in the element a surface shows.
 *
 * Formatted content is shared with every other surface showing the same
 * citation, so a fragment goes in as a clone rather than being moved out of the
 * held text.
 */
export function citationElement(
  doc: Document,
  content: Node | string,
): HTMLElement {
  const element = doc.createElement("span");
  element.className = CITATION_CLASS;
  element.append(
    typeof content === "string" ? content : content.cloneNode(true),
  );
  return element;
}
