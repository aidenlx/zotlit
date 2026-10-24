/** The real Citation Lookup layer over already-owned consumer fixture dependencies. */
import type { App } from "obsidian";

import { stubService } from "@/lib/__fixtures__/service-stub";
import type { Scope } from "@/lib/effect";
import { Context, Effect, Layer, Stream } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { ObsidianApp } from "@/lib/obsidian-app";
import type { ParseClient } from "@/services/citation-parse/client";
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
import type { ZoteroReadsState } from "@/services/zotero-reads/service";

import { CitationLookup, layerCitationLookup } from "./lookup-service";
import { plainCitationIndex, plainCitationLookup } from "./plain";
import { CitationIndex, layerCitationIndex } from "./service";
import type { CitekeyStore } from "./store";

/** A database state with nothing wrong; a stub overrides `state` alone. */
const READS_IDLE: ZoteroReadsState = {
  state: "ready",
  error: null,
  moved: false,
  dbFileMissing: false,
  activeReadMode: null,
};

export async function citationLookupFixture(
  deps: {
    reads: Pick<
      PlainZoteroReads,
      | "reads"
      | "state"
      | "changed"
      | "degraded"
      | "refresh-failed"
      | "refreshing"
      | "db-file-missing"
      | "refresh-requested"
    >;
    libraryScope: Pick<
      PlainLibraryScope,
      "effective" | "current" | "libraries" | "changed" | "libraries-changed"
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
          Layer.succeed(
            QueryClients,
            stubService<QueryClients["Service"]>("QueryClients", {
              client: deps.queryClient.client,
              invalidate: (key) =>
                Effect.sync(() => deps.queryClient.invalidate(key)),
            }),
          ),
          Layer.succeed(
            LibraryScope,
            stubService<LibraryScope["Service"]>("LibraryScope", {
              state: Effect.sync(() => state),
              effective: Effect.sync(() => deps.libraryScope.effective),
              changes: Stream.merge(
                deps.libraryScope.changed.pipe(Stream.map(() => "changed")),
                deps.libraryScope["libraries-changed"].pipe(
                  Stream.map(() => "libraries-changed"),
                ),
              ).pipe(
                Stream.map((event) => {
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
                  return state;
                }),
                Stream.prepend([state]),
              ),
            }),
          ),
          Layer.succeed(
            ZoteroReads,
            stubService<ZoteroReads["Service"]>("ZoteroReads", {
              reads: deps.reads.reads,
              current: Effect.sync(() => ({
                ...READS_IDLE,
                state: deps.reads.state,
              })),
              events: Stream.merge(
                deps.reads.changed.pipe(
                  Stream.map(() => ({ _tag: "changed" as const })),
                ),
                deps.reads.degraded.pipe(
                  Stream.map((error) => ({ _tag: "degraded" as const, error })),
                ),
              ),
            }),
          ),
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
          Layer.succeed(
            ZoteroReads,
            stubService<ZoteroReads["Service"]>("ZoteroReads", {
              current: Effect.sync(() => ({
                ...READS_IDLE,
                state: deps.db.state,
              })),
              snapshot: Effect.map(
                acquireAsyncDisposable(() => deps.db.acquireRead()).pipe(
                  Effect.mapError(
                    (error) =>
                      new DbUnavailable({ message: String(error.cause) }),
                  ),
                ),
                (lease) => lease.reads,
              ),
            }),
          ),
          Layer.succeed(
            LibraryScope,
            stubService<LibraryScope["Service"]>("LibraryScope", {
              current: Effect.sync(() => deps.libraryScope.current),
            }),
          ),
          Layer.succeed(
            NoteIndex,
            stubService<NoteIndex["Service"]>("NoteIndex", {
              getNotesByItemKey: (key) =>
                Effect.sync(() => deps.noteIndex.getNotesByItemKey(key)),
            }),
          ),
          Layer.succeed(
            PluginSettings,
            stubService<PluginSettings["Service"]>("PluginSettings", {
              current: Effect.sync(() => deps.settings.current),
              changes: deps.settings.changes,
            }),
          ),
          Layer.succeed(CitationLookup, deps.lookup),
          Layer.succeed(
            CitationParse,
            stubService<CitationParse["Service"]>("CitationParse", {
              parse: (request) => deps.parseClient.parse(request),
            }),
          ),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(deps.context ?? Context.empty())),
    ),
    stack,
  );
  const ready = runtime
    .context()
    .then(() => Object.assign(plainCitationIndex(runtime), { runtime }));
  return { runtime, ready, service: () => runtime.runSync(CitationIndex) };
}
