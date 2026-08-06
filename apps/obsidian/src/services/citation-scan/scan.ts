// Pure extraction of one document's Literature Note Citations from its link cache.

import { parseLinktext, type LinkCache, type Loc, type Pos } from "obsidian";

/** Where one Literature Note Citation is written: the link's cache position. */
export type CitationOccurrence = Pos;

/** One cited Literature Note, with every place the document links to it. */
export interface Citation {
  /** Indexed Key of the cited Zotero item. */
  indexedKey: string;
  /** Linkpath of the first occurrence, subpath stripped. */
  linkpath: string;
  /** 1-based identifier, assigned by first occurrence in document order. */
  refNumber: number;
  occurrences: CitationOccurrence[];
}

/**
 * Resolves a wikilink target to the Indexed Key of the Literature Note it
 * points at, or `null` when the target is missing or is an ordinary note.
 */
export type ResolveIndexedKey = (linkpath: string) => string | null;

/**
 * Collect the Literature Note Citations of one document from its link cache.
 *
 * Links to the same Literature Note collapse into one entry keyed by Indexed
 * Key, so two paths reaching the same note still share a reference number.
 * Embeds never reach here: Obsidian caches them separately from `links`.
 */
export function scanCitations(
  links: readonly LinkCache[],
  resolveIndexedKey: ResolveIndexedKey,
): Citation[] {
  const byIndexedKey = new Map<string, Citation>();

  for (const link of links) {
    const { path } = parseLinktext(link.link);
    if (path === "") continue;
    const indexedKey = resolveIndexedKey(path);
    if (indexedKey === null) continue;

    const occurrence = link.position;
    const existing = byIndexedKey.get(indexedKey);
    if (existing) {
      existing.occurrences.push(occurrence);
      continue;
    }
    byIndexedKey.set(indexedKey, {
      indexedKey,
      linkpath: path,
      refNumber: byIndexedKey.size + 1,
      occurrences: [occurrence],
    });
  }

  return [...byIndexedKey.values()];
}

/**
 * Structural equality. The scanner rescans on every metadata change, so this
 * is what keeps an unrelated edit from waking the store's subscribers.
 */
export function citationsEqual(
  prev: readonly Citation[],
  next: readonly Citation[],
): boolean {
  return listsEqual(
    prev,
    next,
    (a, b) =>
      a.indexedKey === b.indexedKey &&
      a.linkpath === b.linkpath &&
      a.refNumber === b.refNumber &&
      listsEqual(
        a.occurrences,
        b.occurrences,
        (x, y) => locsEqual(x.start, y.start) && locsEqual(x.end, y.end),
      ),
  );
}

function locsEqual(a: Loc, b: Loc): boolean {
  return a.line === b.line && a.col === b.col && a.offset === b.offset;
}

function listsEqual<T>(
  prev: readonly T[],
  next: readonly T[],
  equal: (a: T, b: T) => boolean,
): boolean {
  if (prev.length !== next.length) return false;
  return prev.every((item, index) => equal(item, next[index]!));
}
