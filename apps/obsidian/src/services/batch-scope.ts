// Scope resolution shared by the library-wide and collection-scoped batch
// actions: guard the target library, then gather the item ids a run covers.
import {
  getCollectionIDByKey,
  getIndexedItemIDsByCollection,
  getIndexedItemIDsByLibrary,
  getLibraries,
  getNoteItemIDsByCollection,
  getNoteItemIDsByLibrary,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";

import { getLogger } from "@/lib/log";

const logger = getLogger("batch-scope");

/** Which items a batch action collects from its scope. */
export type BatchScopeKind = "literature-items" | "notes";

/**
 * How a caller narrows a batch run. The runners take this verbatim from their
 * own callers — the protocol handlers pass both fields, the command palette
 * neither — and add the configured library themselves.
 */
export interface BatchScopeOptions {
  /**
   * Group id the caller expects the configured library to name — `0` for the
   * personal library, a positive integer for a group. A mismatch stops the run
   * before any scan; omit it to skip the guard.
   */
  expectedGroupID?: number;
  /**
   * Narrows the run to this collection and every collection nested under it.
   * Absent covers the whole library.
   */
  collectionKey?: string;
}

export interface BatchScopeRequest extends BatchScopeOptions {
  /** The configured citation library the run reads. */
  libraryID: number;
}

export type BatchScope =
  | { outcome: "library-mismatch" }
  | { outcome: "collection-not-found" }
  | { outcome: "resolved"; itemIDs: number[] };

/** The id query each kind runs, per scope. */
const SCOPE_QUERIES = {
  "literature-items": {
    byLibrary: getIndexedItemIDsByLibrary,
    byCollection: getIndexedItemIDsByCollection,
  },
  notes: {
    byLibrary: getNoteItemIDsByLibrary,
    byCollection: getNoteItemIDsByCollection,
  },
} as const satisfies Record<BatchScopeKind, unknown>;

/**
 * Resolve which item ids a batch run covers, rejecting a request aimed at
 * another library or at a collection this database doesn't hold. An existing
 * but empty collection resolves to an empty id list, which the caller reports
 * as an empty selection rather than a stale link.
 */
export function resolveBatchScope(
  client: NodeDatabaseClient,
  kind: BatchScopeKind,
  request: BatchScopeRequest,
): BatchScope {
  const { libraryID, expectedGroupID, collectionKey } = request;

  if (expectedGroupID !== undefined) {
    const actualGroupID =
      getLibraries(client).find((lib) => lib.libraryID === libraryID)
        ?.groupID ?? 0;
    if (actualGroupID !== expectedGroupID) {
      logger.info("Batch scope: library mismatch", {
        kind,
        expected: expectedGroupID,
        actual: actualGroupID,
      });
      return { outcome: "library-mismatch" };
    }
  }

  const queries = SCOPE_QUERIES[kind];
  if (collectionKey === undefined) {
    return {
      outcome: "resolved",
      itemIDs: queries.byLibrary(client, libraryID),
    };
  }

  const scope = { libraryID, collectionKey };
  if (getCollectionIDByKey(client, scope) === undefined) {
    logger.info("Batch scope: collection not found", { kind, ...scope });
    return { outcome: "collection-not-found" };
  }
  return { outcome: "resolved", itemIDs: queries.byCollection(client, scope) };
}
