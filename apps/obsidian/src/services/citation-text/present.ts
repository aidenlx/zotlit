// How one Citation is presented once its formatted text is known.

import type { CitationSource } from "@/lib/citation-fragment";
import { themeHook } from "@/lib/theme-hooks";
import type { CitedWork } from "@/services/citekey-navigation";

// One citation as a surface holds it: the same shape whether a note wrote it or
// a wikilink derivation did, which is what lets the two syntaxes share a render.
export type { CitationKey, CitationSource } from "@/lib/citation-fragment";

/**
 * One citation as a surface holds it, with the works it names when its own
 * syntax cannot tell two citations apart without them.
 *
 * A literal citekey names one work: the citekey resolution snapshot decides
 * what a spelling reaches, so every occurrence of that spelling reaches the
 * same Item and the source alone identifies the citation. A wikilink derivation
 * names its works itself, because two Items can derive the same citekey text.
 */
export interface HeldCitation extends CitationSource {
  /** Indexed Key of each of `keys`, or absent when the source alone identifies. */
  works?: readonly string[];
}

/**
 * The identity one formatted citation is held under — the source a surface
 * shows, and the works it names when the surface names them.
 *
 * Neither a Pandoc source of one citation nor an Indexed Key carries a line
 * break, so the join is unambiguous.
 */
export function citationKey({
  source,
  works,
}: Pick<HeldCitation, "source" | "works">): string {
  return works === undefined ? source : [source, ...works].join("\n");
}

/** What one document's surfaces need to put text in their citations' place. */
export interface DocumentCitations {
  /** The formatted citation of one {@link citationKey}, for every one the engine rendered. */
  formatted: ReadonlyMap<string, DocumentFragment>;
  /**
   * `Creators (Year)` by Indexed Key, used for navigation labels. A summary
   * belongs to the work, not to the citekey a document spells it with: one
   * spelling can name two works, so a surface joins through the identity its
   * own syntax knows.
   */
  summaries: ReadonlyMap<string, string>;
  /**
   * The Item each literal citekey of the document names, which is the join a
   * literal surface reaches a summary through. A derived citekey is left out —
   * a wikilink surface names its works itself, and letting a derivation claim a
   * spelling would answer for a literal key that reaches nothing.
   */
  literalWorks: ReadonlyMap<string, string>;
}

/**
 * The `Creators (Year)` summary of one citekey, or `undefined` for a key that
 * reaches no Zotero Item.
 */
export type SummaryOf = (citekey: string) => string | undefined;

/** {@link SummaryOf} for the literal citekeys one document writes. */
export function literalSummaryOf({
  summaries,
  literalWorks,
}: DocumentCitations): SummaryOf {
  return (citekey) => {
    const indexedKey = literalWorks.get(citekey);
    return indexedKey === undefined ? undefined : summaries.get(indexedKey);
  };
}

/**
 * How many of one citation's keys reach no Zotero Item, which is what decides
 * between the resolved, partly unresolved, and wholly unresolved theme hooks.
 */
export function unresolvedKeys(
  { keys }: CitationSource,
  summaryOf: SummaryOf,
): number {
  return keys.filter((key) => summaryOf(key.citekey) === undefined).length;
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
 * What one Citation shows: the text the engine formatted for its source.
 *
 * @returns `null` until a complete document render supplies this citation,
 *   which leaves its native source presentation unchanged.
 */
export function citationContent(
  citation: HeldCitation,
  { formatted }: DocumentCitations,
): DocumentFragment | string | null {
  return formatted.get(citationKey(citation)) ?? null;
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
