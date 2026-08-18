// One Ambiguous Citation Key's candidates, described the same way on every surface that shows them.

import { getItemsByID, isChildItemFields } from "@zotlit/db";
import type { Item } from "@zotlit/db";

import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import type { DatabaseService } from "@/services/database/service";
import { libraryLabel } from "@/services/library-scope/label";
import type { AvailableLibrary } from "@/services/library-scope/scope";
import type { LibraryScopeService } from "@/services/library-scope/service";

import type { SnapshotItem } from "./snapshot";

const logger = getLogger("citation-index");

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
  db: Pick<DatabaseService, "client">;
  /** Names the Library each candidate lives in. */
  libraryScope: Pick<LibraryScopeService, "current">;
}

/**
 * Reads each candidate's summary from the database and pairs it with the
 * Library it lives in. A read the database cannot answer leaves the summary as
 * the bare Zotero item key, so a surface still tells the candidates apart.
 *
 * @param candidates the Items of one Ambiguous Citation Key, in the canonical
 *   order the resolution snapshot reports them.
 */
export function describeCandidates(
  { db, libraryScope }: CandidateDeps,
  candidates: readonly SnapshotItem[],
): AmbiguousCandidate[] {
  const libraries = new Map(
    (libraryScope.current?.available ?? []).map((library) => [
      library.libraryID,
      library,
    ]),
  );
  let items = new Map<number, Item>();
  try {
    items = new Map(
      getItemsByID(
        db.client,
        candidates.map((candidate) => candidate.itemID),
      ).map((item) => [item.itemID, item]),
    );
  } catch (error) {
    logger.warn("Ambiguous citekey candidates read without summaries", {
      error,
    });
  }
  return candidates.map((candidate) => {
    const item = items.get(candidate.itemID);
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
