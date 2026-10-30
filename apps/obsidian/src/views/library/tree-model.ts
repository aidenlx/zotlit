// Per-leaf Library Tree controls and interruptible reads over the view services.
import { useAtomValue } from "@effect/atom-react";
import { Effect, Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { createContext, useContext } from "react";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import { viewRuntime } from "@/lib/view-atoms";
import { QueryService } from "@/services/item-query/service";
import {
  availableLibrariesAtom,
  libraryScopeStateAtom,
  resolvedLibraryScopeAtom,
} from "@/services/library-scope/atoms";
import type {
  AvailableLibrary,
  LibraryScope,
} from "@/services/library-scope/scope";
import type { LibraryScopeState } from "@/services/library-scope/service";
import { notedItemKeysAtom } from "@/services/note-index/atoms";
import {
  zoteroRevisionAtom,
  zoteroTreeUnavailableAtom,
} from "@/services/zotero-reads/atoms";
import { ZoteroReads } from "@/services/zotero-reads/service";

import {
  nodeCount,
  nodeKey,
  paperCountRequest,
  tagListRequest,
  tagNames,
  unreadCount,
} from "./document";
import type { LibraryNode, ReadingStateFacet } from "./document";
import { collectionTree, sameLibrary } from "./tree";
import type { LibraryCounts, TreeLibrary } from "./tree";

export interface TreeSession {
  readonly node: LibraryNode;
  readonly listed: boolean;
  readonly all: boolean;
  readonly expanded: ReadonlySet<string>;
  readonly open: boolean;
  /** Whether the researcher collapsed the tree beside a wide list. */
  readonly collapsed: boolean;
  readonly facets: readonly ReadingStateFacet[];
  readonly tags: readonly string[];
  readonly tagFilter: string;
  readonly revision: number;
  readonly enabled: boolean;
}
export const patchTree =
  (patch: Partial<TreeSession>) =>
  (state: TreeSession): TreeSession =>
    Object.entries(patch).every(
      ([key, value]) => state[key as keyof TreeSession] === value,
    )
      ? state
      : { ...state, ...patch };
export const refreshTree = (state: TreeSession): TreeSession => ({
  ...state,
  revision: state.revision + 1,
  enabled: true,
});

const value = <A, E>(result: AsyncResult.AsyncResult<A, E>, fallback: A): A =>
  Option.getOrElse(AsyncResult.value(result), () => fallback);

export function scopeForLibrary(state: LibraryScopeState): LibraryScope {
  const { current, effective } = state;
  return !current || current.available.length === 0
    ? effective
    : {
        mode: "selected",
        libraries: current.available.map(({ selector }) => selector),
      };
}

export function makeTreeModel() {
  const session = Atom.make<TreeSession>({
    node: { kind: "library", library: { type: "personal" } },
    listed: true,
    all: false,
    expanded: new Set<string>(),
    open: false,
    collapsed: false,
    facets: [],
    tags: [],
    tagFilter: "",
    revision: 0,
    enabled: false,
  });
  const revision = Atom.map(session, (s) => s.revision);
  const enabled = Atom.map(session, (s) => s.enabled);
  const all = Atom.map(session, (s) => s.all);
  const target = Atom.withLabel(
    Atom.make((get) => nodeKey(get(session).node)),
    "Library Tree node",
  );
  const tags = Atom.map(session, (s) => s.tags.join("\0"));
  const canWiden = Atom.make((get) => {
    const scope = get(libraryScopeStateAtom);
    return (
      scope.current !== null &&
      (scope.all?.available.length ?? 0) > scope.current.available.length
    );
  });
  const loaded = viewRuntime.atom((get) => {
    get(revision);
    get(zoteroRevisionAtom);
    get(zoteroTreeUnavailableAtom);
    const current = get(resolvedLibraryScopeAtom);
    const libraries = get(availableLibrariesAtom);
    const widened = get(all) && get(canWiden);
    if (!get(enabled)) return Effect.succeed(null);
    const selected = get.once(session).node;
    const shown = libraries.filter(
      ({ selector }) =>
        widened ||
        (selected.kind !== "recent" &&
          sameLibrary(selector, selected.library)) ||
        current?.available.some((library) =>
          sameLibrary(library.selector, selector),
        ),
    );
    return readTree(shown);
  });
  const unread = viewRuntime.atom((get) => {
    get(revision);
    get(zoteroRevisionAtom);
    get(zoteroTreeUnavailableAtom);
    get(target);
    const noted = get(notedItemKeysAtom);
    if (!get(enabled)) return Effect.succeed(null);
    const request = unreadCount(get.once(session).node, {
      find: (key) => (noted.has(key) ? { path: key, basename: key } : null),
    });
    return request
      ? Effect.gen(function* () {
          const outcome = yield* (yield* QueryService).run(request.request);
          return outcome.kind === "result" && outcome.result.rows
            ? request.count(outcome.result.rows)
            : null;
        }).pipe(
          recover(
            (error) =>
              Effect.logWarning(
                "The Library Tree could not count the unread Items",
                { error },
              ),
            Effect.succeed(null),
          ),
        )
      : Effect.succeed(null);
  });
  // Read only while the item details show no paper and subscribe to it.
  const stats = viewRuntime.atom((get) => {
    get(revision);
    get(zoteroRevisionAtom);
    get(zoteroTreeUnavailableAtom);
    get(target);
    get(resolvedLibraryScopeAtom);
    const noted = get(notedItemKeysAtom);
    if (!get(enabled)) return Effect.succeed(null);
    const node = get.once(session).node;
    const scope = scopeForLibrary(get.once(libraryScopeStateAtom));
    const notes = {
      find: (key: string) =>
        noted.has(key) ? { path: key, basename: key } : null,
    };
    // Has note is a vault condition over the same rows as every paper.
    const hasNote = nodeCount(node, ["has-note"], { scope, notes });
    return Effect.gen(function* () {
      const query = yield* QueryService;
      const rowsOf = (facets: readonly ReadingStateFacet[]) => {
        const { request, count } = nodeCount(node, facets, { scope, notes });
        return query
          .run(request)
          .pipe(
            Effect.map((outcome) =>
              outcome.kind === "result" && outcome.result.rows
                ? { rows: outcome.result.rows, count }
                : null,
            ),
          );
      };
      const [all, unread, annotated, pdf] = yield* Effect.all(
        [
          rowsOf([]),
          rowsOf(["unread"]),
          rowsOf(["annotated"]),
          rowsOf(["pdf"]),
        ],
        { concurrency: "unbounded" },
      );
      if (!all || !unread || !annotated || !pdf) return null;
      return {
        unread: unread.count(unread.rows),
        annotated: annotated.count(annotated.rows),
        "has-note": hasNote.count(all.rows),
        pdf: pdf.count(pdf.rows),
      } satisfies LibraryStats;
    }).pipe(
      recover(
        (error) =>
          Effect.logWarning("The Library View could not count the papers", {
            error,
          }),
        Effect.succeed(null),
      ),
    );
  });
  const tagList = viewRuntime.atom((get) => {
    get(revision);
    get(zoteroRevisionAtom);
    get(zoteroTreeUnavailableAtom);
    get(target);
    get(tags);
    const selected = get.once(session).tags;
    get(resolvedLibraryScopeAtom);
    const scope = scopeForLibrary(get.once(libraryScopeStateAtom));
    if (!get(enabled)) return Effect.succeed(null);
    return Effect.gen(function* () {
      const outcome = yield* (yield* QueryService).run(
        tagListRequest(get.once(session).node, selected, scope),
      );
      return tagNames(
        outcome.kind === "result" ? (outcome.result.groups ?? null) : null,
        selected,
      );
    }).pipe(
      recover(
        (error) =>
          Effect.logWarning("The Library Tree could not list the tags", {
            error,
          }),
        Effect.succeed(tagNames(null, selected)),
      ),
    );
  });
  const state = Atom.make((get) => ({
    ...get(session),
    all: get(session).all && get(canWiden),
    libraries: value(get(loaded), null)?.map(({ tree }) => tree) ?? null,
    unread: get(unread).waiting ? null : value(get(unread), null),
    tagList: value(get(tagList), null),
  }));
  return { session, state, loaded, unread, stats, tagList, canWiden };
}
export type TreeModel = ReturnType<typeof makeTreeModel>;

/**
 * What the item details count while no paper is selected: the papers of
 * the tree node that pass each Reading State facet.
 */
export type LibraryStats = Readonly<Record<ReadingStateFacet, number>>;

const readTree = (shown: readonly AvailableLibrary[]) =>
  Effect.gen(function* () {
    const reads = yield* ZoteroReads;
    const query = yield* QueryService;
    const paths = yield* Effect.gen(function* () {
      const snapshot = yield* reads.snapshot;
      return yield* Effect.forEach(shown, ({ libraryID }) =>
        snapshot.CollectionPaths({ libraryIDs: [libraryID] }),
      );
    }).pipe(
      Effect.scoped,
      recover(
        (error) =>
          Effect.logWarning("The Library Tree could not read the Collections", {
            error,
          }),
        Effect.succeed(shown.map(() => null)),
      ),
    );
    return yield* Effect.forEach(
      shown,
      (library, index) =>
        Effect.gen(function* () {
          const outcome = yield* query
            .run(paperCountRequest(library.selector))
            .pipe(
              recover(
                (error) =>
                  Effect.logWarning(
                    "The Library Tree could not count a Library",
                    { error },
                  ),
                Effect.succeed(null),
              ),
            );
          const counts: LibraryCounts | null =
            outcome?.kind === "result" && outcome.result.groups
              ? outcome.result
              : null;
          return {
            tree: {
              library,
              count: counts?.totalCount ?? null,
              collections: collectionTree(paths[index] ?? [], counts),
            } satisfies TreeLibrary,
            complete: paths[index] !== null,
          };
        }),
      { concurrency: "unbounded" },
    );
  }).pipe(withLogCategory("library-view", "tree"));

const TreeModelContext = createContext<TreeModel | null>(null);
export const TreeModelProvider = TreeModelContext.Provider;

export function useTreeState<A>(
  select: (state: Atom.Type<TreeModel["state"]>) => A,
): A {
  const model = useContext(TreeModelContext);
  if (!model)
    throw new Error("useTreeState must be used within TreeModelProvider");
  return useAtomValue(model.state, select);
}
