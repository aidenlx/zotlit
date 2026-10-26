// One Ambiguous Citation Key's candidates, described the same way on every surface that shows them.

import { Cause, Effect } from "effect";

import { isChildItemFields } from "@zotlit/db";
import type { Item } from "@zotlit/db";

import { withLogCategory } from "@/lib/effect-log";
import { itemSummary } from "@/lib/item-summary";
import { libraryLabel } from "@/services/library-scope/label";
import type {
  AvailableLibrary,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import type { SnapshotItem } from "./snapshot";

/**
 * One Item an Ambiguous Citation Key names, as a candidate row shows it: the
 * Item summary, its Library, and its bare Zotero item key — enough to tell two
 * Items of one Library apart. Carries the exact identity a row opens by, so a
 * choice never resolves the Citation Key again.
 */
export interface AmbiguousCandidate extends SnapshotItem {
  /** `Creators (Year): Title`, or the bare Zotero item key when the read
   *  renders none. */
  summary: string;
  /** The Library holding the Item, or `null` when the scope no longer names it. */
  library: AvailableLibrary | null;
}

/**
 * What one candidate row states, in the order it reads: the Item summary, the
 * Library holding it, and its bare Zotero item key — the three facts that tell
 * two candidates of one Library apart.
 */
export interface CandidateRow {
  summary: string;
  /** Zotero's live Library name, or `null` when the scope no longer names it. */
  library: string | null;
  /** Bare Zotero item key, which the Library name qualifies into an identity. */
  key: string;
}

export function candidateRow(candidate: AmbiguousCandidate): CandidateRow {
  return {
    summary: candidate.summary,
    library: candidate.library ? libraryLabel(candidate.library) : null,
    key: candidate.key,
  };
}

/**
 * The candidates one citekey names, or `null` for a key naming zero or one
 * Item — the read that tells an Ambiguous Citation Key from a missing one.
 */
export type AmbiguousCandidatesOf = (
  citekey: string,
) => readonly AmbiguousCandidate[] | null;

/** Where a candidate description reads its summary and its Library from. */
export interface CandidateDeps {
  db: { readonly reads: ZoteroReadsApi };
  /** Names the Library each candidate lives in. */
  libraryScope: { readonly current: ResolvedLibraryScope | null };
}

/**
 * Reads each candidate's summary from the database and pairs it with the
 * Library it lives in, in the caller's fiber. A failed read logs and leaves
 * the summaries as the bare Zotero item keys, so a surface still tells the
 * candidates apart; an interrupt stays an interrupt.
 *
 * @param candidates the Items of one Ambiguous Citation Key, in the canonical
 *   order the resolution snapshot reports them.
 */
export const describeCandidatesEffect = Effect.fnUntraced(function* (
  deps: CandidateDeps,
  candidates: readonly SnapshotItem[],
) {
  const items = yield* deps.db.reads
    .ItemsByIndexedKeys({
      indexedKeys: candidates.map((candidate) => candidate.indexedKey),
    })
    .pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning(
              "Ambiguous citekey candidates read without summaries",
              cause,
            ).pipe(
              withLogCategory("citation-index"),
              Effect.as(new Map<string, Item>()),
            ),
      ),
    );
  return describeWith(deps, items, candidates);
});

function describeWith(
  { libraryScope }: CandidateDeps,
  items: ReadonlyMap<string, Item>,
  candidates: readonly SnapshotItem[],
): AmbiguousCandidate[] {
  const libraries = new Map(
    (libraryScope.current?.available ?? []).map((library) => [
      library.libraryID,
      library,
    ]),
  );
  return candidates.map((candidate) => {
    const item = items.get(candidate.indexedKey);
    const fields = item?.fields;
    return {
      ...candidate,
      summary:
        item && fields && !isChildItemFields(fields)
          ? itemSummary(item, fields).formatted
          : candidate.key,
      library: libraries.get(candidate.libraryID) ?? null,
    };
  });
}

/** Describe candidates from the source join already captured for a document. */
export function describeJoinedCandidates(
  candidates: readonly SnapshotItem[],
  sources: ReadonlyMap<string, { summary: string }>,
  libraries: ReadonlyMap<number, AvailableLibrary>,
): AmbiguousCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    summary: sources.get(candidate.indexedKey)?.summary ?? candidate.key,
    library: libraries.get(candidate.libraryID) ?? null,
  }));
}
