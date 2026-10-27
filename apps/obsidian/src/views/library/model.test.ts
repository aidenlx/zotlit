// Read cancellation, selective reloads and leaf-owned commands on the real view registry.
import { it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import { expect } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { ItemLookup } from "@/services/item-lookup/service";
import type { QueryViewOutcome } from "@/services/item-query/query-view";
import type { QueryViewRequest } from "@/services/item-query/query-view";
import { QueryService } from "@/services/item-query/service";
import { resolveLibraryScope } from "@/services/library-scope/scope";
import { LibraryScope } from "@/services/library-scope/service";
import { defaults } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import { openTargetCommand, viewTargetOpener } from "@/views/open-target";
import { waitFor } from "@/views/welcome/__fixtures__";

import { makeLibraryHost } from "./__fixtures__";
import { makeItemNodeCommand } from "./atoms";
import { makeCardModel, patchCard } from "./card-model";
import { libraryItemCommand } from "./item-actions";
import { waitForRead } from "./model";
import { makeSearchModel, patchSearch } from "./search-model";
import { LibraryViewStorage } from "./storage";
import { makeTreeModel, patchTree, refreshTree } from "./tree-model";

const EMPTY: QueryViewOutcome = {
  kind: "result",
  result: {
    libraries: [{ type: "personal" }],
    query: { filter: null, fields: [], sort: [], limit: null },
    returnedCount: 0,
    matchedCount: 0,
    truncated: false,
    warnings: [],
    rows: [],
  },
};
const LIBRARIES = [
  { selector: { type: "personal" as const }, libraryID: 1, name: null },
];
const scope = resolveLibraryScope(
  [{ libraryID: 1, type: "user", name: null, groupID: null }],
  { mode: "all" },
);

it.live(
  "interrupts a Reading Card read on close and leaves the other leaf reading",
  () =>
    Effect.gen(function* () {
      const started: string[] = [];
      const cancelled: string[] = [];
      const host = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          makeLibraryHost({
            services: Layer.mock(QueryService, {
              run: (request) =>
                Effect.promise((signal) => {
                  const key = request.context?.item ?? request.filter ?? "";
                  started.push(key);
                  return new Promise<QueryViewOutcome>((resolve) => {
                    signal.addEventListener(
                      "abort",
                      () => {
                        cancelled.push(key);
                        resolve(EMPTY);
                      },
                      { once: true },
                    );
                  });
                }),
            }),
          }),
        ),
      );
      const first = makeCardModel(() => null);
      const second = makeCardModel(() => null);
      const releaseFirst = host.registry.mount(first.state);
      yield* Effect.addFinalizer(() => Effect.sync(releaseFirst));
      const releaseSecond = host.registry.mount(second.state);
      yield* Effect.addFinalizer(() => Effect.sync(releaseSecond));
      host.registry.update(first.session, patchCard({ key: "AAAA2345" }));
      host.registry.update(second.session, patchCard({ key: "BBBB2345" }));
      yield* Effect.promise(() =>
        waitFor(() => expect(started).toHaveLength(4)),
      );
      releaseFirst();
      yield* Effect.promise(() =>
        waitFor(() => expect(cancelled).toHaveLength(2)),
      );
      expect(cancelled.every((key) => key.includes("AAAA2345"))).toBe(true);
      releaseSecond();
      yield* Effect.promise(() =>
        waitFor(() => expect(cancelled).toHaveLength(4)),
      );
    }),
);

it.live(
  "interrupts the search that a new target replaces and the search its leaf closes",
  () =>
    Effect.gen(function* () {
      const started: string[] = [];
      const cancelled: string[] = [];
      const host = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          makeLibraryHost({
            services: Layer.mock(ItemLookup, {
              search: (words) =>
                Effect.promise((signal) => {
                  started.push(words);
                  return new Promise((resolve) =>
                    signal.addEventListener(
                      "abort",
                      () => {
                        cancelled.push(words);
                        resolve([]);
                      },
                      { once: true },
                    ),
                  );
                }),
            }),
          }),
        ),
      );
      const model = makeSearchModel();
      const release = host.registry.mount(model.loaded);
      yield* Effect.addFinalizer(() => Effect.sync(release));
      host.registry.update(
        model.session,
        patchSearch({
          text: "first",
          request: { node: { kind: "recent" }, scope: { mode: "all" } },
        }),
      );
      yield* Effect.promise(() =>
        waitFor(() => expect(started).toEqual(["first"])),
      );
      host.registry.update(
        model.session,
        patchSearch({
          text: "second",
          request: { node: { kind: "recent" }, scope: { mode: "all" } },
        }),
      );
      yield* Effect.promise(() =>
        waitFor(() => {
          expect(started).toEqual(["first", "second"]);
          expect(cancelled).toEqual(["first"]);
        }),
      );
      release();
      yield* Effect.promise(() =>
        waitFor(() => expect(cancelled).toEqual(["first", "second"])),
      );
    }),
);

it.live(
  "reloads tree reads for database changes and keeps them through presentation changes",
  () =>
    Effect.gen(function* () {
      const calls: QueryViewRequest[] = [];
      let collections = 0;
      const host = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          makeLibraryHost({
            services: Layer.mergeAll(
              Layer.mock(QueryService, {
                run: (request) =>
                  Effect.sync(() => {
                    calls.push(request);
                    return EMPTY;
                  }),
              }),
              Layer.mock(LibraryScope, {
                changes: Stream.make({
                  current: scope,
                  all: scope,
                  invalid: false,
                  effective: { mode: "all" },
                  libraryRows: null,
                }),
              }),
            ),
          }),
        ),
      );
      // Supply only the CollectionPaths member read by this model; the host owns database events.
      const reads = host.context;
      const original = yield* Effect.provideContext(ZoteroReads, reads);
      Object.assign(original, { snapshot: Effect.succeed(original.reads) });
      Object.assign(original.reads, {
        CollectionPaths: <
          const _AsQueue extends boolean = false,
          const Discard = false,
        >(
          _input: object,
          options?: { readonly discard?: Discard },
        ) =>
          Effect.sync(() => {
            collections += 1;
            return (options?.discard ? undefined : []) as Discard extends true
              ? void
              : readonly (readonly string[])[];
          }),
      });
      const model = makeTreeModel();
      const release = host.registry.mount(model.state);
      yield* Effect.addFinalizer(() => Effect.sync(release));
      host.registry.update(model.session, refreshTree);
      yield* Effect.promise(() =>
        waitForRead(host.registry, model.loaded, new Set()),
      );
      yield* Effect.promise(() =>
        waitForRead(host.registry, model.tagList, new Set()),
      );
      yield* Effect.promise(() =>
        waitForRead(host.registry, model.unread, new Set()),
      );
      const before = calls.length;
      const beforeCollections = collections;
      host.registry.update(
        model.session,
        patchTree({
          open: true,
          expanded: new Set(["collection"]),
          tagFilter: "method",
          facets: ["pdf"],
        }),
      );
      yield* Effect.promise(() =>
        waitForRead(host.registry, model.loaded, new Set()),
      );
      expect(calls).toHaveLength(before);
      expect(collections).toBe(beforeCollections);
      host.publish({ _tag: "changed" });
      yield* Effect.promise(() =>
        waitFor(() => expect(collections).toBeGreaterThan(beforeCollections)),
      );
      yield* Effect.promise(() =>
        waitForRead(host.registry, model.loaded, new Set()),
      );
      expect(calls.length).toBeGreaterThan(before);
    }),
);

it.live(
  "interrupts a leaf's reveal command on close while another leaf can finish",
  () =>
    Effect.gen(function* () {
      const started: string[] = [];
      const cancelled: string[] = [];
      const land = new Map<string, () => void>();
      const host = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          makeLibraryHost({
            services: Layer.mergeAll(
              Layer.mock(LibraryScope, {
                libraries: Effect.succeed(LIBRARIES),
              }),
              Layer.mock(QueryService, {
                run: (request) =>
                  Effect.promise((signal) => {
                    const key = request.filter ?? "";
                    started.push(key);
                    return new Promise<QueryViewOutcome>((resolve) => {
                      land.set(key, () => resolve(EMPTY));
                      signal.addEventListener(
                        "abort",
                        () => {
                          cancelled.push(key);
                          resolve(EMPTY);
                        },
                        { once: true },
                      );
                    });
                  }),
              }),
            ),
          }),
        ),
      );
      const first = makeItemNodeCommand();
      const second = makeItemNodeCommand();
      const releaseFirst = host.registry.mount(first);
      const releaseSecond = host.registry.mount(second);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          releaseFirst();
          releaseSecond();
        }),
      );
      const one = Promise.withResolvers<
        import("./document").LibraryNode | null
      >();
      const two = Promise.withResolvers<
        import("./document").LibraryNode | null
      >();
      host.registry.set(first, { indexedKey: "AAAA2345", result: one });
      host.registry.set(second, { indexedKey: "BBBB2345", result: two });
      yield* Effect.promise(() =>
        waitFor(() => expect(started).toHaveLength(2)),
      );
      releaseFirst();
      yield* Effect.promise(() =>
        waitFor(() => expect(cancelled).toEqual([started[0]])),
      );
      expect(yield* Effect.promise(() => one.promise)).toBeNull();
      land.get(started[1]!)!();
      expect(yield* Effect.promise(() => two.promise)).toEqual({
        kind: "library",
        library: { type: "personal" },
      });
    }),
);

it.live("releases the tree's read snapshot when its leaf closes", () =>
  Effect.gen(function* () {
    let started = false;
    let released = false;
    const api = stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {
      CollectionPaths: () =>
        Effect.sync(() => {
          started = true;
        }).pipe(Effect.andThen(Effect.never)),
    });
    const state: import("@/services/zotero-reads/service").ZoteroReadsState = {
      state: "ready",
      error: null,
      moved: false,
      dbFileMissing: false,
      activeReadMode: null,
    };
    const host = yield* Effect.acquireDisposable(
      Effect.promise(() =>
        makeLibraryHost({
          services: Layer.mergeAll(
            Layer.mock(LibraryScope, {
              changes: Stream.make({
                current: scope,
                all: scope,
                invalid: false,
                effective: { mode: "all" },
                libraryRows: null,
              }),
            }),
            Layer.mock(QueryService, { run: () => Effect.succeed(EMPTY) }),
            Layer.mock(ZoteroReads, {
              current: Effect.succeed(state),
              changes: Stream.make(state),
              events: Stream.empty,
              reads: api,
              snapshot: Effect.acquireRelease(Effect.succeed(api), () =>
                Effect.sync(() => {
                  released = true;
                }),
              ),
            }),
          ),
        }),
      ),
    );
    const model = makeTreeModel();
    const release = host.registry.mount(model.state);
    yield* Effect.addFinalizer(() => Effect.sync(release));
    host.registry.update(model.session, refreshTree);
    yield* Effect.promise(() => waitFor(() => expect(started).toBe(true)));
    expect(released).toBe(false);
    release();
    yield* Effect.promise(() => waitFor(() => expect(released).toBe(true)));
  }),
);

it.live("runs shared item gestures together across leaves", () =>
  Effect.gen(function* () {
    const host = yield* Effect.acquireDisposable(
      Effect.promise(() => makeLibraryHost()),
    );
    const release = host.registry.mount(libraryItemCommand);
    yield* Effect.addFinalizer(() => Effect.sync(release));
    const started: string[] = [];
    const cancelled: string[] = [];
    const finish = new Map<string, () => void>();
    const request = (key: string) => ({
      result: Promise.withResolvers<void>(),
      effect: Effect.promise(
        (signal) =>
          new Promise<void>((resolve) => {
            started.push(key);
            finish.set(key, resolve);
            signal.addEventListener(
              "abort",
              () => {
                cancelled.push(key);
                resolve();
              },
              { once: true },
            );
          }),
      ),
    });
    const first = request("first");
    const second = request("second");
    host.registry.set(libraryItemCommand, first);
    yield* Effect.promise(() =>
      waitFor(() => expect(started).toEqual(["first"])),
    );
    host.registry.set(libraryItemCommand, second);
    yield* Effect.promise(() =>
      waitFor(() => expect(started).toEqual(["first", "second"])),
    );
    finish.get("second")!();
    yield* Effect.promise(() => second.result.promise);
    expect(cancelled).toEqual([]);
    finish.get("first")!();
    yield* Effect.promise(() => first.result.promise);
  }),
);

it.live(
  "settles pending Library commands quietly when the registry closes",
  () =>
    Effect.gen(function* () {
      let saving = false;
      const host = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          makeLibraryHost({
            services: Layer.mock(PluginSettings, {
              update: () => Effect.succeed(defaults),
              flush: Effect.sync(() => {
                saving = true;
              }).pipe(Effect.andThen(Effect.never)),
            }),
          }),
        ),
      );
      host.registry.mount(libraryItemCommand);
      host.registry.mount(openTargetCommand);
      const storage = new LibraryViewStorage(host.registry, () => null);
      let acting = false;
      const result = Promise.withResolvers<void>();
      const acted = result.promise.then(
        () => undefined,
        (error: unknown) => error,
      );
      host.registry.set(libraryItemCommand, {
        result,
        effect: Effect.sync(() => {
          acting = true;
        }).pipe(Effect.andThen(Effect.never)),
      });
      let opening = false;
      let openInterrupted = false;
      viewTargetOpener(host.registry, {
        open: () =>
          Effect.sync(() => {
            opening = true;
          }).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                openInterrupted = true;
              }),
            ),
          ),
      }).open({ kind: "attachment", attachmentKey: "ABCD2345" }, false);
      const saved = storage.save().catch((error: unknown) => error);
      yield* Effect.promise(() =>
        waitFor(() => {
          expect(acting).toBe(true);
          expect(opening).toBe(true);
          expect(saving).toBe(true);
        }),
      );
      storage.close();
      yield* Effect.promise(() => host.close());
      expect(yield* Effect.promise(() => acted)).toBeUndefined();
      expect(openInterrupted).toBe(true);
      expect(yield* Effect.promise(() => saved)).toBeUndefined();
    }),
);
