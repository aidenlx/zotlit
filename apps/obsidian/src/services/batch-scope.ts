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
import { USER_LIBRARY_ID } from "@zotlit/db";
import type { Library } from "@zotlit/db";

import { Effect } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { libraryLabel } from "@/services/library-scope/label";
import { compareSelectors, selectorOf } from "@/services/library-scope/scope";
import type { ResolvedLibraryScope } from "@/services/library-scope/scope";
import type {
  ZoteroReads,
  ZoteroReadsApi,
} from "@/services/zotero-reads/service";
import type { FlatGroupDef } from "@/views/batch-modal";

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
   * Library Scope resolved against the caller's Snapshot. Read only for an
   * unqualified run.
   */
  scope?: ResolvedLibraryScope;
  /** The Libraries the caller's Snapshot holds. Read only for an exact target. */
  libraries: readonly Library[];
}

export type BatchScope =
  /** The named group has no Library in this database. */
  | { outcome: "unavailable-target" }
  | { outcome: "collection-not-found" }
  | { outcome: "resolved"; itemIDs: number[] };

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
  reads: ZoteroReadsApi,
  kind: BatchScopeKind,
  request: BatchScopeRequest,
): Effect.Effect<BatchScope, unknown> {
  return Effect.gen(function* () {
    const { groupID, collectionKey } = request.target;

    let libraryIDs: number[];
    if (groupID === undefined) {
      libraryIDs = request.scope!.available.map((library) => library.libraryID);
    } else {
      const libraryID = exactLibraryID(request.libraries, groupID);
      if (libraryID === null) {
        yield* Effect.logDebug("Batch scope: target library unavailable").pipe(
          Effect.annotateLogs({ kind, groupID }),
          withLogCategory("batch-scope"),
        );
        return { outcome: "unavailable-target" };
      }
      libraryIDs = [libraryID];
    }

    const itemIDs: number[] = [];
    for (const libraryID of libraryIDs) {
      const ids = yield* reads.ScopeItemIDs({
        kind,
        libraryID,
        ...(collectionKey !== undefined && { collectionKey }),
      });
      if (ids === null) {
        yield* Effect.logDebug("Batch scope: collection not found").pipe(
          Effect.annotateLogs({ kind, libraryID, collectionKey }),
          withLogCategory("batch-scope"),
        );
        return { outcome: "collection-not-found" };
      }
      itemIDs.push(...ids);
    }
    return { outcome: "resolved", itemIDs };
  });
}

/** The services a library-wide run reaches its Library Scope through. */
export interface BatchScopePlanDeps {
  zoteroReads: Pick<ZoteroReads["Service"], "snapshot">;
  libraryScope: {
    resolveLibraries(
      libraries: readonly Library[],
    ): Effect.Effect<ResolvedLibraryScope>;
  };
}

/** Lift a synchronous Library Scope resolver into the Effect planning seam. */
export function effectLibraryScope(libraryScope: {
  resolveLibraries(libraries: readonly Library[]): ResolvedLibraryScope;
}): BatchScopePlanDeps["libraryScope"] {
  return {
    resolveLibraries: (libraries) =>
      Effect.sync(() => libraryScope.resolveLibraries(libraries)),
  };
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
 * The planning phase both library-wide runners share: open one Snapshot,
 * resolve Library Scope for an unqualified run, and gather the item ids the run
 * covers. The Snapshot ends with this call, so nothing downstream —
 * classification, confirmation, writes — runs under it.
 */
export function planBatchScope(
  deps: BatchScopePlanDeps,
  kind: BatchScopeKind,
  target: BatchTarget,
): Effect.Effect<BatchScopePlan, unknown> {
  return Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* deps.zoteroReads.snapshot;
      const libraries = yield* reads.Libraries({});
      const libraryScope =
        target.groupID === undefined
          ? yield* deps.libraryScope.resolveLibraries(libraries)
          : null;
      let unavailableLibraries = 0;
      if (libraryScope !== null) {
        if (libraryScope.available.length === 0) {
          yield* Effect.logDebug(
            "Batch scope: no library in scope is available",
          ).pipe(Effect.annotateLogs({ kind }), withLogCategory("batch-scope"));
          return { outcome: "no-library-in-scope" };
        }
        unavailableLibraries = libraryScope.unavailable.length;
      }

      const scope = yield* resolveBatchScope(reads, kind, {
        target,
        ...(libraryScope === null ? {} : { scope: libraryScope }),
        libraries,
      });
      if (scope.outcome !== "resolved") return { outcome: scope.outcome };
      return {
        outcome: "resolved",
        itemIDs: scope.itemIDs,
        unavailableLibraries,
      };
    }),
  );
}

/** @returns the local id of the named Library, or `null` when it is absent. */
function exactLibraryID(
  libraries: readonly Library[],
  groupID: number,
): number | null {
  if (groupID === 0) return USER_LIBRARY_ID;
  return (
    libraries.find((library) => library.groupID === groupID)?.libraryID ?? null
  );
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
  libraries: readonly Library[],
  libraryIDs: ReadonlySet<number>,
): BatchLibrary[] {
  return libraries
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
      ...kind,
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
