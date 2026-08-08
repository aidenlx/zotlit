// Grouping one document's Citation Occurrences into Citations with Reference Numbers.

import { occurrencesEqual } from "./scan";
import type { CitationOccurrence } from "./scan";

/** The Item a Citation Occurrence resolves to. */
export interface ResolvedNote {
  /** Indexed Key of the cited Zotero Item. */
  indexedKey: string;
  /** Linkpath that opens the Literature Note, or `null` when the Item has none yet. */
  linkpath: string | null;
}

/**
 * Resolution is lazy and per occurrence: a citekey resolves through the
 * citekey resolution snapshot, a linkpath through the Literature Note it
 * points at.
 */
export type ResolveOccurrence = (
  occurrence: CitationOccurrence,
) => ResolvedNote | null;

/** One cited work of a document, with every place the document cites it. */
export interface Citation {
  /** Indexed Key of the cited Item, or `null` when the citekey names no live Zotero Item. */
  indexedKey: string | null;
  /** Linkpath that opens the Literature Note, or `null` when the Item has none yet. */
  linkpath: string | null;
  /** 1-based identifier, assigned by first occurrence in document order. */
  refNumber: number;
  occurrences: CitationOccurrence[];
}

/**
 * Group one document's occurrences into its Citations.
 *
 * Occurrences of the same Item collapse into one Citation, so a document that
 * cites it as a citekey and as a wikilink still gets one reference number. A
 * citekey naming no live Zotero Item stays a Citation of its own — Pandoc
 * warns on an undefined citation rather than dropping it — while a wikilink
 * that points at an ordinary note is no Citation at all.
 *
 * @param occurrences in document order, which is the order reference numbers
 *   are assigned in.
 */
export function groupCitations(
  occurrences: readonly CitationOccurrence[],
  resolve: ResolveOccurrence,
): Citation[] {
  const byIdentity = new Map<string, Citation>();

  for (const occurrence of occurrences) {
    const note = resolve(occurrence);
    if (!note && occurrence.kind === "wikilink") continue;
    const identity = note
      ? `key:${note.indexedKey}`
      : `citekey:${occurrence.raw}`;

    const existing = byIdentity.get(identity);
    if (existing) {
      existing.occurrences.push(occurrence);
      continue;
    }
    byIdentity.set(identity, {
      indexedKey: note?.indexedKey ?? null,
      linkpath: note?.linkpath ?? null,
      refNumber: byIdentity.size + 1,
      occurrences: [occurrence],
    });
  }

  return [...byIdentity.values()];
}

/**
 * Structural equality of two documents' Citation lists. A consumer refreshes on
 * signals as broad as any metadata change, so this is what keeps an unrelated
 * edit from rebuilding what it already shows.
 */
export function citationsEqual(
  prev: readonly Citation[],
  next: readonly Citation[],
): boolean {
  if (prev.length !== next.length) return false;
  return prev.every((citation, index) => {
    const other = next[index]!;
    return (
      citation.indexedKey === other.indexedKey &&
      citation.linkpath === other.linkpath &&
      citation.refNumber === other.refNumber &&
      occurrencesEqual(citation.occurrences, other.occurrences)
    );
  });
}
