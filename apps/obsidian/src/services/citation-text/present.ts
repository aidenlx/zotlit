// How one Citation is presented once its formatted text is known.

import type { CitationSource } from "@/lib/citation-fragment";
import type { SectionRange } from "@/lib/reading-view";
import { themeHook } from "@/lib/theme-hooks";
import type { CitedWork } from "@/services/citekey-navigation";
import type { RenderedCitation } from "@/services/pandoc/engine";
import { renderInlineContent } from "@/services/pandoc/inline-content";

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

/**
 * One Citation Occurrence of a document, with the text the engine rendered for
 * that occurrence.
 */
export interface FormattedOccurrence {
  /** Offset the document writes the Citation at, which is the coordinate a surface matches. */
  start: number;
  text: RenderedCitation;
}

/**
 * Which occurrence of a Citation one surface shows.
 *
 * An editor holds the document offset its decoration covers and matches the
 * occurrence written there exactly. A reading view is placed by section alone,
 * so it counts the occurrences of one identity that section shows and matches
 * by that count.
 */
export type CitationCoordinate =
  | { kind: "offset"; start: number }
  | ({ kind: "section"; ordinal: number } & SectionRange);

/** What one document's surfaces need to put text in their citations' place. */
export interface DocumentCitations {
  /**
   * Every occurrence of one {@link citationKey} the engine rendered, in
   * document order.
   *
   * A position-dependent style renders each Citation Occurrence by its place in
   * the document, so two occurrences of one source can read differently and
   * each surface shows the text of the occurrence it stands for.
   */
  formatted: ReadonlyMap<string, readonly FormattedOccurrence[]>;
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
 * What one Citation shows: the text the engine formatted for the occurrence the
 * surface holds.
 *
 * @param at where the surface holds this occurrence. A surface with no
 *   coordinate, and one whose coordinate reaches no occurrence — a section
 *   Obsidian places nowhere, or an offset an edit has moved — shows the
 *   source's first-occurrence text.
 * @returns `null` until a complete document render supplies this citation,
 *   which leaves its native source presentation unchanged.
 */
export function citationContent(
  citation: HeldCitation,
  { formatted }: DocumentCitations,
  at?: CitationCoordinate,
): RenderedCitation | null {
  const occurrences = formatted.get(citationKey(citation));
  if (occurrences === undefined) return null;
  return (occurrenceAt(occurrences, at) ?? occurrences[0]!).text;
}

/** @returns the occurrence `at` names, or undefined when it names none of them. */
function occurrenceAt(
  occurrences: readonly FormattedOccurrence[],
  at: CitationCoordinate | undefined,
): FormattedOccurrence | undefined {
  if (at === undefined) return undefined;
  if (at.kind === "offset") {
    return occurrences.find(({ start }) => start === at.start);
  }
  return occurrences.filter(({ start }) => start >= at.from && start < at.to)[
    at.ordinal
  ];
}

/**
 * Where one rendered reading-view section holds each of its Citations, aligned
 * with `citations` — which a post-processor reads in document order, so the
 * occurrences of one identity are counted in the order the document writes them.
 *
 * @param section the offsets the section covers, or null when Obsidian places
 *   it nowhere, which leaves every Citation there on first-occurrence text.
 */
export function sectionCoordinates(
  citations: readonly HeldCitation[],
  section: SectionRange | null,
): (CitationCoordinate | undefined)[] {
  if (section === null) return citations.map(() => undefined);
  const counts = new Map<string, number>();
  return citations.map((citation) => {
    const identity = citationKey(citation);
    const ordinal = counts.get(identity) ?? 0;
    counts.set(identity, ordinal + 1);
    return { kind: "section", ...section, ordinal };
  });
}

/**
 * Shows a citation's content in the element one surface inserts, replacing
 * whatever that element held.
 *
 * A formatted citation is an immutable value every surface showing that
 * citation holds at once, so each insertion shows it through the shared
 * renderer rather than moving or copying one rendering between them.
 *
 * @param content the formatted citation, or the source text a surface shows
 *   where no formatted text stands for it.
 * @param links whether a link the style wrote becomes an anchor of its own. A
 *   surface inserting into an anchor of Obsidian's suppresses them, since
 *   nesting one anchor in another is invalid.
 */
export function showCitation(
  element: Element,
  content: RenderedCitation | string,
  links: "render" | "suppress" = "render",
): void {
  if (typeof content === "string") {
    element.replaceChildren(content);
    return;
  }
  element.replaceChildren();
  renderInlineContent(element, { nodes: content.content, links });
}

/** Wraps a citation's content in the element a surface shows. */
export function citationElement(
  doc: Document,
  content: RenderedCitation | string,
  themeClasses: readonly string[] = [],
): HTMLElement {
  const element = doc.createElement("span");
  element.classList.add(themeHook.citation, ...themeClasses);
  showCitation(element, content);
  return element;
}
