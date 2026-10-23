/** The real Citation Lookup layer over already-owned consumer fixture dependencies. */
import type { App } from "obsidian";

import type { Scope } from "@/lib/effect";
import { Context, Effect, Layer, Queue, Stream } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { ObsidianApp } from "@/lib/obsidian-app";
import type {
  ParseClient,
  ParseFailed,
} from "@/services/citation-parse/client";
import { CitationParse } from "@/services/citation-parse/service";
import type { PlainLibraryScope } from "@/services/library-scope/plain";
import {
  layerLibraryScope,
  LibraryScope,
} from "@/services/library-scope/service";
import type { LibraryScopeState } from "@/services/library-scope/service";
import type { PlainNoteIndex } from "@/services/note-index/plain";
import { NoteIndex } from "@/services/note-index/service";
import type { PlainQueryClients } from "@/services/query-client/plain";
import {
  layerQueryClients,
  QueryClients,
} from "@/services/query-client/service";
import type { Settings } from "@/services/settings/schema";
import {
  layerPluginSettings,
  PluginSettings,
} from "@/services/settings/service";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { layerZoteroReads, ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsEvent } from "@/services/zotero-reads/service";

import { CitationLookup, layerCitationLookup } from "./lookup-service";
import { plainCitationIndex, plainCitationLookup } from "./plain";
import { CitationIndex, layerCitationIndex } from "./service";
import type { CitekeyStore } from "./store";

export async function citationLookupFixture(
  deps: {
    reads: Pick<PlainZoteroReads, "reads" | "state" | "on">;
    libraryScope: Pick<
      PlainLibraryScope,
      "effective" | "current" | "libraries" | "on"
    >;
    queryClient: Pick<PlainQueryClients, "client" | "invalidate">;
  },
  context = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  let state: LibraryScopeState = {
    current: deps.libraryScope.current,
    all: {
      mode: "all",
      invalid: false,
      available: deps.libraryScope.libraries,
      unavailable: [],
    },
    invalid: false,
    effective: deps.libraryScope.effective,
    libraryRows: null,
  };
  const runtime = buildRuntime(
    layerCitationLookup.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(QueryClients, {
            client: deps.queryClient.client,
            invalidate: (key) =>
              Effect.sync(() => deps.queryClient.invalidate(key)),
          } as QueryClients["Service"]),
          Layer.succeed(LibraryScope, {
            state: Effect.sync(() => state),
            effective: Effect.sync(() => deps.libraryScope.effective),
            changes: Stream.callback<LibraryScopeState>(
              Effect.fnUntraced(function* (queue) {
                Queue.offerUnsafe(queue, state);
                for (const event of ["changed", "libraries-changed"] as const) {
                  yield* Effect.acquireRelease(
                    Effect.sync(() =>
                      deps.libraryScope.on(event, () => {
                        state = {
                          ...state,
                          current: deps.libraryScope.current,
                          all:
                            event === "libraries-changed"
                              ? {
                                  mode: "all",
                                  invalid: false,
                                  available: deps.libraryScope.libraries,
                                  unavailable: [],
                                }
                              : state.all,
                          effective: deps.libraryScope.effective,
                        };
                        Queue.offerUnsafe(queue, state);
                      }),
                    ),
                    (off) => Effect.sync(off),
                  );
                }
              }),
            ),
          } as LibraryScope["Service"]),
          Layer.succeed(ZoteroReads, {
            reads: deps.reads.reads,
            current: Effect.sync(() => ({ state: deps.reads.state })),
            events: Stream.callback<ZoteroReadsEvent>(
              Effect.fnUntraced(function* (queue) {
                yield* Effect.acquireRelease(
                  Effect.sync(() =>
                    deps.reads.on("changed", () => {
                      Queue.offerUnsafe(queue, { _tag: "changed" });
                    }),
                  ),
                  (off) => Effect.sync(off),
                );
                yield* Effect.acquireRelease(
                  Effect.sync(() =>
                    deps.reads.on("degraded", (error) => {
                      Queue.offerUnsafe(queue, { _tag: "degraded", error });
                    }),
                  ),
                  (off) => Effect.sync(off),
                );
              }),
            ),
          } as ZoteroReads["Service"]),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const plain = plainCitationLookup(runtime);
  const owned = stack.move();
  return Object.assign(plain, {
    runtime,
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  });
}

/** Native tests use the real graph over the RPC/process boundary. */
export const lookupFixture = Effect.fnUntraced(function* (
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
) {
  const context = yield* Effect.context<never>();
  return yield* Effect.acquireRelease(
    Effect.promise(() => openLookup(client, context)),
    (fixture) => Effect.promise(fixture.close),
  );
});

async function openLookup(
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
  context: Context.Context<never>,
) {
  await using stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    layerCitationLookup.pipe(
      Layer.provideMerge(layerLibraryScope),
      Layer.provideMerge(
        Layer.mergeAll(
          layerQueryClients,
          layerZoteroReads(
            client.pipe(
              Effect.tap((client) => client.Libraries({}).pipe(Effect.orDie)),
            ),
          ),
          layerPluginSettings({
            loadData: async () => ({ __VERSION__: 10 }),
            saveData: async () => {},
          }),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const service = runtime.runSync(CitationLookup);
  const plain = plainCitationLookup(runtime);
  const owned = stack.move();
  return { runtime, service, plain, close: () => owned.disposeAsync() };
}

/** Citation Index layer over the existing host/process test boundaries. */
export function citationIndexFixture(
  deps: {
    app: App;
    db: Pick<PlainZoteroReads, "state" | "acquireRead">;
    libraryScope: Pick<PlainLibraryScope, "current">;
    noteIndex: Pick<PlainNoteIndex, "getNotesByItemKey">;
    settings: {
      readonly current: Readonly<Settings>;
      readonly changes: Stream.Stream<Readonly<Settings>>;
    };
    lookup: CitationLookup["Service"];
    parseClient: ParseClient;
    openStore: () => Promise<CitekeyStore>;
    context?: Context.Context<never>;
  },
  stack: AsyncDisposableStack,
) {
  const runtime = buildRuntime(
    layerCitationIndex(deps.openStore).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ObsidianApp, deps.app),
          Layer.succeed(ZoteroReads, {
            current: Effect.sync(() => ({ state: deps.db.state })),
            snapshot: Effect.map(
              acquireAsyncDisposable(() => deps.db.acquireRead()).pipe(
                Effect.mapError(
                  (error) =>
                    new DbUnavailable({ message: String(error.cause) }),
                ),
              ),
              (lease) => lease.reads,
            ),
          } as ZoteroReads["Service"]),
          Layer.succeed(LibraryScope, {
            current: Effect.sync(() => deps.libraryScope.current),
          } as LibraryScope["Service"]),
          Layer.succeed(NoteIndex, {
            getNotesByItemKey: (key) =>
              Effect.sync(() => deps.noteIndex.getNotesByItemKey(key)),
          } as NoteIndex["Service"]),
          Layer.succeed(PluginSettings, {
            current: Effect.sync(() => deps.settings.current),
            changes: deps.settings.changes,
          } as PluginSettings["Service"]),
          Layer.succeed(CitationLookup, deps.lookup),
          Layer.succeed(CitationParse, {
            parse: (request) =>
              Effect.tryPromise({
                try: (signal) => deps.parseClient.parse(request, signal),
                catch: (error) => error as ParseFailed,
              }),
          }),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(deps.context ?? Context.empty())),
    ),
    stack,
  );
  const ready = runtime.context().then(() => plainCitationIndex(runtime));
  return { runtime, ready, service: () => runtime.runSync(CitationIndex) };
}
