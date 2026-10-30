/** The real Citation Lookup layer over already-owned consumer fixture dependencies. */
import type { Scope } from "effect";
import { Context, Effect, Layer, Stream } from "effect";

import { layerTestObsidianEnv } from "@/lib/__fixtures__/obsidian-env";
import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import type { HostSources } from "@/lib/__fixtures__/obsidian-host-app";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import type { ParseClient } from "@/services/citation-parse/client";
import { CitationParse } from "@/services/citation-parse/service";
import {
  layerLibraryScope,
  LibraryScope,
} from "@/services/library-scope/service";
import type { LibraryScopeState } from "@/services/library-scope/service";
import { NoteIndex } from "@/services/note-index/service";
import {
  layerQueryClients,
  QueryClients,
} from "@/services/query-client/service";
import {
  layerPluginSettings,
  PluginSettings,
} from "@/services/settings/service";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import { layerZoteroReads, ZoteroReads } from "@/services/zotero-reads/service";

import { CitationLookup, layerCitationLookup } from "./lookup-service";
import { CitationIndex, layerCitationIndex } from "./service";
import type { CitekeyStore } from "./store";
import type { LibraryScopeStub } from "./test-harness";

export async function citationLookupFixture(
  deps: {
    reads: Pick<ZoteroReads["Service"], "reads" | "current" | "events">;
    libraryScope: Pick<
      LibraryScopeStub,
      "effective" | "current" | "libraries" | "changed" | "libraries-changed"
    >;
    queryClient: Pick<QueryClients["Service"], "client" | "invalidate">;
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
              invalidate: (key) => deps.queryClient.invalidate(key),
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
              current: deps.reads.current,
              events: deps.reads.events,
            }),
          ),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const service = Object.assign(runtime.runSync(CitationLookup), {
    runtime,
    bridge: effectBridge(runtime),
  });
  const owned = stack.move();
  return Object.assign(service, {
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
    (fixture) => Effect.promise(() => fixture.close()),
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
  const service = Object.assign(runtime.runSync(CitationLookup), {
    runtime,
    bridge: effectBridge(runtime),
  });
  const owned = stack.move();
  return { runtime, service, close: () => owned.disposeAsync() };
}

/** Citation Index layer over the existing host/process test boundaries. */
export function citationIndexFixture(
  deps: {
    host: HostSources;
    db: Pick<ZoteroReads["Service"], "current" | "snapshot">;
    libraryScope: Pick<LibraryScopeStub, "current">;
    noteIndex: Pick<NoteIndex["Service"], "getNotesByItemKey">;
    settings: {
      readonly current: PluginSettings["Service"]["current"];
      readonly changes: PluginSettings["Service"]["changes"];
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
          layerHost(deps.host),
          layerTestObsidianEnv(),
          Layer.succeed(
            ZoteroReads,
            stubService<ZoteroReads["Service"]>("ZoteroReads", {
              current: deps.db.current,
              snapshot: deps.db.snapshot,
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
              getNotesByItemKey: (key) => deps.noteIndex.getNotesByItemKey(key),
            }),
          ),
          Layer.succeed(
            PluginSettings,
            stubService<PluginSettings["Service"]>("PluginSettings", {
              current: deps.settings.current,
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
  const ready = runtime.context().then(() =>
    Object.assign(runtime.runSync(CitationIndex), {
      runtime,
      bridge: effectBridge(runtime),
    }),
  );
  return { runtime, ready, service: () => runtime.runSync(CitationIndex) };
}
