// How one Citation is presented once its formatted text is known.

import type { CitationSource } from "@/lib/citation-fragment";
import type { SectionRange } from "@/lib/reading-view";
import { themeHook } from "@/lib/theme-hooks";
import type { CitekeyResolution } from "@/services/citation-index/service";
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
 * One Citation as a surface shows it: the text the engine rendered, and the
 * Entry Serial standing for each work that text names.
 */
export interface PresentedCitation {
  text: RenderedCitation;
  /**
   * One slot per work `text.citations` names, in the order it names them;
   * `undefined` where the bibliography rendered no entry for that work.
   *
   * Empty for a document whose citations need no serial at all, which is every
   * document an in-text style formats: with nothing for a note to stand for,
   * the renderer drops the notes it meets rather than numbering them.
   */
  serials: readonly (number | undefined)[];
}

/** Occurrence coordinates stay outside this equality because they do not change rendered DOM. */
export function presentedCitationEqual(
  left: PresentedCitation,
  right: PresentedCitation,
): boolean {
  return (
    left === right ||
    (JSON.stringify(left.text) === JSON.stringify(right.text) &&
      left.serials.length === right.serials.length &&
      left.serials.every((serial, index) => serial === right.serials[index]))
  );
}

/**
 * One Citation Occurrence of a document, as the surface showing that occurrence
 * presents it.
 */
export interface FormattedOccurrence extends PresentedCitation {
  /** Offset the document writes the Citation at, which is the coordinate a surface matches. */
  start: number;
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

/**
 * Which Citation Occurrence one surface shows, as the value that outlives the
 * text formatted for it: a consumer holding this reads the current text of that
 * occurrence out of the document's own citations, however often they are read
 * again.
 */
export interface ShownCitation {
  /** The citation as its surface holds it. */
  citation: HeldCitation;
  /** {@link citationContent} */
  at?: CitationCoordinate;
}

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
   * Whether this document's citations stand for notes, so every surface shows
   * Entry Serials in their place and the References Sidebar gutter shows the
   * same digits. Read off what the engine rendered, not off the style.
   */
  entrySerials: boolean;
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
 * What one Citation Key reaches, as every surface showing it reports the
 * reach: one Zotero Item, none at all, or several — an Ambiguous Citation Key,
 * which names no one Item and so reaches nothing a surface can show.
 */
export type CitationKeyState = "pending" | "resolved" | "missing" | "ambiguous";

/** {@link CitationKeyState} of one Citation Key. */
export type KeyStateOf = (citekey: string) => CitationKeyState;

/**
 * What one Citation reads as, over every Citation Key it names — the state its
 * public theme hook stands for.
 *
 * A missing key outranks an Ambiguous one: a mixed cluster reports the
 * strongest failure, so a key that reaches nothing at all stays visible.
 */
export type CitationState =
  | "resolved"
  | "pending"
  | "unresolved"
  | "partially-unresolved"
  | "ambiguous";

/** How one Citation Key resolution reads on a note surface. */
export function citekeyState(
  resolution: CitekeyResolution | null,
): CitationKeyState {
  if (resolution === null) return "pending";
  switch (resolution.kind) {
    case "unique":
      return "resolved";
    case "ambiguous":
      return "ambiguous";
    case "missing":
      return "missing";
  }
}

/**
 * {@link KeyStateOf} for the literal citekeys one document writes.
 *
 * A key reaches its work when the document's own read reached that work, which
 * is what a surface has text and a summary for; the resolution snapshot alone
 * says whether a key that reached none is Ambiguous or missing.
 */
export function literalKeyStateOf(
  citations: DocumentCitations,
  stateOf: KeyStateOf,
): KeyStateOf {
  const summaryOf = literalSummaryOf(citations);
  return (citekey) => {
    if (summaryOf(citekey) !== undefined) return "resolved";
    const state = stateOf(citekey);
    return state === "pending" || state === "ambiguous" ? state : "missing";
  };
}

/** The state of each key one Citation names, in the order it names them. */
export function citationKeyStates(
  { keys }: CitationSource,
  stateOf: KeyStateOf,
): CitationKeyState[] {
  return keys.map((key) => stateOf(key.citekey));
}

/**
 * The shared presentation classifier: what one Citation reads as, over the
 * states of the keys it names. Editor and reading surfaces both classify
 * through it, so one cluster reports one state wherever it is shown.
 */
export function citationState(
  states: readonly CitationKeyState[],
): CitationState {
  if (states.some((state) => state === "pending")) return "pending";
  if (states.some((state) => state === "missing")) {
    return states.some((state) => state === "resolved")
      ? "partially-unresolved"
      : "unresolved";
  }
  return states.some((state) => state === "ambiguous")
    ? "ambiguous"
    : "resolved";
}

/** The public theme hooks one Citation carries for the state it reads as. */
export function citationStateHooks(state: CitationState): string[] {
  switch (state) {
    case "resolved":
      return [];
    case "pending":
      return [themeHook.citationKeyPending];
    case "unresolved":
      return [themeHook.citationKeyUnresolved];
    case "partially-unresolved":
      return [themeHook.citationKeyPartiallyUnresolved];
    case "ambiguous":
      return [themeHook.citationKeyAmbiguous];
  }
}

/**
 * The works one rendered citation names, in the order it names them.
 *
 * Each work carries the Item its key names, which is the identity every
 * consumer joins it to the document's entries by. A citation that writes the
 * same key twice names one work, so a menu built from these lists each work
 * once.
 *
 * @param citations the citations of the document this one is written in, which
 *   is what each literal key is read against.
 */
export function citedWorks(
  { source, keys }: CitationSource,
  citations: DocumentCitations,
): CitedWork[] {
  const summaryOf = literalSummaryOf(citations);
  const works = new Map<string, CitedWork>();
  for (const key of keys) {
    const { citekey } = key;
    if (works.has(citekey)) continue;
    works.set(citekey, {
      citekey,
      indexedKey: citations.literalWorks.get(citekey),
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
): PresentedCitation | null {
  const occurrences = formatted.get(citationKey(citation));
  if (occurrences === undefined) return null;
  return occurrenceAt(occurrences, at) ?? occurrences[0]!;
}

/**
 * What one Citation shows to a surface that outlives the read it was placed
 * from — the Citation Popover, which reads the document again on every change
 * to it while the pointer rests where the hover started.
 *
 * A coordinate names one occurrence of the document as it stood at the hover.
 * An edit that moves that occurrence — a note property written into the
 * frontmatter moves every offset and section of the body below it — leaves the
 * coordinate naming none, and a position-dependent style renders each
 * occurrence differently, so another occurrence's text is not this one's to
 * show.
 *
 * @returns `null` where the occurrence this surface stands for has no formatted
 *   text of its own to show.
 */
export function shownCitationContent(
  { citation, at }: ShownCitation,
  { formatted }: DocumentCitations,
): PresentedCitation | null {
  const occurrences = formatted.get(citationKey(citation));
  if (occurrences === undefined) return null;
  return at === undefined
    ? occurrences[0]!
    : (occurrenceAt(occurrences, at) ?? null);
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
  content: PresentedCitation | string,
  links: "render" | "suppress" = "render",
): void {
  if (typeof content === "string") {
    element.replaceChildren(content);
    return;
  }
  element.replaceChildren();
  renderInlineContent(element, {
    nodes: content.text.content,
    serials: content.serials,
    links,
  });
}

/** Wraps a citation's content in the element a surface shows. */
export function citationElement(
  doc: Document,
  content: PresentedCitation | string,
  themeClasses: readonly string[] = [],
): HTMLElement {
  const element = doc.win.createSpan();
  element.classList.add(themeHook.citation, ...themeClasses);
  showCitation(element, content);
  return element;
}
