/**
 * The Library dimension of a batch run: which Libraries a run covers, and how
 * its confirmation groups the rows they contribute.
 *
 * A caller either names an exact target — the Library a Zotero collections-pane
 * link came from, optionally narrowed to one collection — or asks for the
 * unqualified operation, which expands every available Library of the captured
 * Library Scope in canonical order. An exact target bypasses Library Scope
 * entirely, so a link keeps working for a Library the user never selected.
 */
import {
  getCollectionIDByKey,
  getIndexedItemIDsByCollection,
  getIndexedItemIDsByLibrary,
  getLibraries,
  getLibraryByGroupID,
  getNoteItemIDsByCollection,
  getNoteItemIDsByLibrary,
  USER_LIBRARY_ID,
} from "@zotlit/db";
import type { Library } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type { DatabaseService } from "@/services/database/service";
import { libraryLabel } from "@/services/library-scope/label";
import { compareSelectors, selectorOf } from "@/services/library-scope/scope";
import type { ResolvedLibraryScope } from "@/services/library-scope/scope";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { SettingsService } from "@/services/settings/service";
import type { FlatGroupDef } from "@/views/batch-modal";

const logger = getLogger("batch-scope");

/** Which items a batch action collects from its scope. */
export type BatchScopeKind = "literature-items" | "notes";

/**
 * What a batch action runs against. The runners take this verbatim from their
 * own callers: the protocol handlers pass the parsed link fields, the command
 * palette passes nothing.
 */
export type BatchTarget =
  | {
      /**
       * The exact Library this run covers, in the wire encoding: `0` for
       * My Library, a positive integer for a Zotero group. Library Scope is not
       * consulted.
       */
      groupID: number;
      /**
       * Narrows the run to this collection of the named Library and every
       * collection nested under it. Absent covers the whole Library.
       */
      collectionKey?: string;
    }
  | { groupID?: never; collectionKey?: never };

export interface BatchScopeRequest {
  target: BatchTarget;
  /**
   * Library Scope resolved against the caller's pinned client. Read only for an
   * unqualified run.
   */
  scope: ResolvedLibraryScope;
}

export type BatchScope =
  /** The named group has no Library in this database. */
  | { outcome: "unavailable-target" }
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
 * Resolve which item ids a batch run covers, rejecting a link aimed at a
 * Library this database no longer holds or at a collection it doesn't hold. An
 * existing but empty collection resolves to an empty id list, which the caller
 * reports as an empty selection rather than a stale link.
 *
 * An unqualified run queries each available Library of `scope` separately and
 * concatenates the results in canonical order, so no cross-Library query is
 * needed and the order the confirmation groups by is the order Library Scope
 * already defines.
 */
export function resolveBatchScope(
  client: NodeDatabaseClient,
  kind: BatchScopeKind,
  request: BatchScopeRequest,
): BatchScope {
  const { groupID, collectionKey } = request.target;

  let libraryIDs: number[];
  if (groupID === undefined) {
    libraryIDs = request.scope.available.map((library) => library.libraryID);
  } else {
    const libraryID = exactLibraryID(client, groupID);
    if (libraryID === null) {
      logger.debug("Batch scope: target library unavailable", {
        kind,
        groupID,
      });
      return { outcome: "unavailable-target" };
    }
    libraryIDs = [libraryID];
  }

  const queries = SCOPE_QUERIES[kind];
  const itemIDs: number[] = [];
  for (const libraryID of libraryIDs) {
    if (collectionKey === undefined) {
      itemIDs.push(...queries.byLibrary(client, libraryID));
      continue;
    }
    const collection = { libraryID, collectionKey };
    if (getCollectionIDByKey(client, collection) === undefined) {
      logger.debug("Batch scope: collection not found", {
        kind,
        ...collection,
      });
      return { outcome: "collection-not-found" };
    }
    itemIDs.push(...queries.byCollection(client, collection));
  }
  return { outcome: "resolved", itemIDs };
}

/** The services a library-wide run reaches its Library Scope through. */
export interface BatchScopePlanDeps {
  db: Pick<DatabaseService, "acquireRead">;
  settings: Pick<SettingsService, "loaded">;
  libraryScope: Pick<LibraryScopeService, "resolveWith">;
}

export type BatchScopePlan =
  /** Library Scope is Selected Libraries, and this database holds none of them. */
  | { outcome: "no-library-in-scope" }
  | { outcome: "unavailable-target" }
  | { outcome: "collection-not-found" }
  | {
      outcome: "resolved";
      itemIDs: number[];
      /**
       * Selected Libraries this database holds no Library for, so the run
       * covers a subset. `0` for an exact target, which never reads the scope.
       */
      unavailableLibraries: number;
    };

/**
 * The planning phase both library-wide runners share: wait for the saved scope,
 * take one read lease, resolve Library Scope against the pinned client, and
 * gather the item ids the run covers. The lease ends with this call, so nothing
 * downstream — classification, confirmation, writes — runs under it.
 */
export async function planBatchScope(
  deps: BatchScopePlanDeps,
  kind: BatchScopeKind,
  target: BatchTarget,
): Promise<BatchScopePlan> {
  // The saved scope is read through the settings snapshot, so wait for it before
  // resolving against the pinned client.
  await deps.settings.loaded;

  using lease = await deps.db.acquireRead();
  const libraryScope = deps.libraryScope.resolveWith(lease.client);
  let unavailableLibraries = 0;
  if (target.groupID === undefined) {
    if (libraryScope.available.length === 0) {
      logger.debug("Batch scope: no library in scope is available", { kind });
      return { outcome: "no-library-in-scope" };
    }
    unavailableLibraries = libraryScope.unavailable.length;
  }

  const scope = resolveBatchScope(lease.client, kind, {
    target,
    scope: libraryScope,
  });
  if (scope.outcome !== "resolved") return { outcome: scope.outcome };
  return { outcome: "resolved", itemIDs: scope.itemIDs, unavailableLibraries };
}

/** @returns the local id of the named Library, or `null` when it is absent. */
function exactLibraryID(
  client: NodeDatabaseClient,
  groupID: number,
): number | null {
  if (groupID === 0) return USER_LIBRARY_ID;
  return getLibraryByGroupID(client, groupID)?.libraryID ?? null;
}

/** One Library that contributed rows to a run, as its confirmation names it. */
export interface BatchLibrary {
  libraryID: number;
  label: string;
}

/**
 * The Libraries a classified plan draws its rows from, in canonical order —
 * My Library first, then groups by ascending group id. Derived from the rows
 * themselves rather than from the request, so an explicit id list spanning
 * several Libraries groups the same way an expanded Library Scope does.
 */
export function batchLibraries(
  client: NodeDatabaseClient,
  libraryIDs: ReadonlySet<number>,
): BatchLibrary[] {
  return getLibraries(client)
    .filter((library) => libraryIDs.has(library.libraryID))
    .sort(compareLibraries)
    .map((library) => ({
      libraryID: library.libraryID,
      label: batchLibraryLabel(library),
    }));
}

function compareLibraries(a: Library, b: Library): number {
  const left = selectorOf(a);
  const right = selectorOf(b);
  if (left && right) return compareSelectors(left, right);
  if (left) return -1;
  if (right) return 1;
  return a.libraryID - b.libraryID;
}

function batchLibraryLabel(library: Library): string {
  const selector = selectorOf(library);
  return selector
    ? libraryLabel({
        selector,
        libraryID: library.libraryID,
        name: library.name,
      })
    : // A group row whose `groups` join is missing carries no stable id; its
      // local id is the only identifier left to name it by.
      (library.name ??
        m.settings_library_scope_group({ groupID: library.libraryID }));
}

/** The confirmation group a row belongs to: its Library and its action. */
export function batchGroupKey(libraryID: number, kind: string): string {
  return `${libraryID}:${kind}`;
}

/**
 * Ordered confirm/summary groups for a run: `kinds` repeated per contributing
 * Library. One contributing Library keeps the plain action headings; above that
 * each heading names its Library, so identical actions stay apart.
 */
export function batchGroups(
  libraries: readonly BatchLibrary[],
  kinds: readonly FlatGroupDef[],
): FlatGroupDef[] {
  const qualify = libraries.length > 1;
  return libraries.flatMap((library) =>
    kinds.map((kind) => ({
      kind: batchGroupKey(library.libraryID, kind.kind),
      header: qualify
        ? (args: { count: number }) =>
            m.batch_group_library({
              library: library.label,
              group: kind.header(args),
            })
        : kind.header,
    })),
  );
}

/**
 * Append the unavailable-Library sentence to a confirmation introduction.
 * Library Scope stores no names for a selector this database cannot resolve, so
 * the copy reports a count.
 */
export function withUnavailableLibraries(
  intro: string,
  unavailable: number,
): string {
  return unavailable === 0
    ? intro
    : m.batch_intro_with_unavailable({
        intro,
        unavailable: m.batch_libraries_unavailable({ count: unavailable }),
      });
}
