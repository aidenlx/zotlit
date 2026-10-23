/** The real Citation Lookup layer over already-owned consumer fixture dependencies. */
import type { Scope } from "@/lib/effect";
import { Context, Effect, Layer, Queue, Stream } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import type { PlainLibraryScope } from "@/services/library-scope/plain";
import {
  layerLibraryScope,
  LibraryScope,
} from "@/services/library-scope/service";
import type { LibraryScopeState } from "@/services/library-scope/service";
import type { PlainQueryClients } from "@/services/query-client/plain";
import {
  layerQueryClients,
  QueryClients,
} from "@/services/query-client/service";
import { layerPluginSettings } from "@/services/settings/service";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";
import { layerZoteroReads, ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsEvent } from "@/services/zotero-reads/service";

import { CitationLookup, layerCitationLookup } from "./lookup-service";
import { plainCitationLookup } from "./plain";

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
