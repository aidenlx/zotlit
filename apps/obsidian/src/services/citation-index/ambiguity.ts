// One Ambiguous Citation Key's candidates, described the same way on every surface that shows them.

import { Effect } from "effect";

import { isChildItemFields } from "@zotlit/db";
import type { Item } from "@zotlit/db";

import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import { libraryLabel } from "@/services/library-scope/label";
import type { AvailableLibrary } from "@/services/library-scope/scope";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import type { CitekeyResolution, SnapshotItem } from "./snapshot";

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
  db: Pick<ZoteroReadsService, "ready">;
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
export async function describeCandidates(
  deps: CandidateDeps,
  candidates: readonly SnapshotItem[],
): Promise<AmbiguousCandidate[]> {
  return describeWith(
    deps,
    await readCandidateItems(deps, candidates),
    candidates,
  );
}

/**
 * The candidates of every Ambiguous Citation Key among `citekeys`, described
 * in one read, as the synchronous lookup a list build takes.
 *
 * @param resolveCitekey what a citekey names in the current Library Scope.
 */
export async function readAmbiguousCandidates(
  deps: CandidateDeps,
  resolveCitekey: (citekey: string) => CitekeyResolution | null,
  citekeys: Iterable<string>,
): Promise<AmbiguousCandidatesOf> {
  const ambiguous = new Map<string, readonly SnapshotItem[]>();
  for (const citekey of citekeys) {
    const resolution = resolveCitekey(citekey);
    if (resolution?.kind === "ambiguous") {
      ambiguous.set(citekey, resolution.candidates);
    }
  }
  if (ambiguous.size === 0) return () => null;
  const items = await readCandidateItems(deps, [...ambiguous.values()].flat());
  const described = new Map(
    [...ambiguous].map(([citekey, candidates]) => [
      citekey,
      describeWith(deps, items, candidates),
    ]),
  );
  return (citekey) => described.get(citekey) ?? null;
}

/** The candidates' Items by Indexed Key; a failed read answers none. */
async function readCandidateItems(
  { db }: CandidateDeps,
  candidates: readonly SnapshotItem[],
): Promise<ReadonlyMap<string, Item>> {
  try {
    const { reads } = await db.ready;
    return await Effect.runPromise(
      reads.ItemsByIndexedKeys({
        indexedKeys: candidates.map((candidate) => candidate.indexedKey),
      }),
    );
  } catch (error) {
    logger.warn("Ambiguous citekey candidates read without summaries", {
      error,
    });
    return new Map();
  }
}

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
