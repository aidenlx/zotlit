/** Library Scope's real dependency graph over a test's RPC client and saved settings. */
import { Context, Effect, Layer, Queue, Stream } from "@/lib/effect";
import type { Scope } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { layerQueryClients } from "@/services/query-client/service";
import type { PlainPluginSettings } from "@/services/settings/plain";
import { plainPluginSettings } from "@/services/settings/plain";
import type { Settings } from "@/services/settings/schema";
import {
  layerPluginSettings,
  PluginSettings,
} from "@/services/settings/service";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";
import { plainZoteroReads } from "@/services/zotero-reads/plain";
import type { ZoteroReadsEvent } from "@/services/zotero-reads/service";
import { layerZoteroReads, ZoteroReads } from "@/services/zotero-reads/service";

import { plainLibraryScope } from "./plain";
import { layerLibraryScope, LibraryScope } from "./service";

export const libraryScopeFixture = Effect.fnUntraced(function* (
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
  saved: unknown = { __VERSION__: 10 },
) {
  const context = yield* Effect.context<never>();
  return yield* Effect.acquireRelease(
    Effect.promise(() => openLibraryScope(client, saved, context)),
    (fixture) => Effect.promise(fixture.close),
  );
});

export async function openLibraryScope(
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
  saved: unknown = { __VERSION__: 10 },
  context = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    layerLibraryScope.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          layerQueryClients,
          layerZoteroReads(client),
          layerPluginSettings({
            loadData: async () => saved,
            saveData: async () => {},
          }),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const service = runtime.runSync(LibraryScope);
  const plain = plainLibraryScope(runtime);
  const settings = plainPluginSettings(runtime);
  const reads = plainZoteroReads(runtime);
  const owned = stack.move();
  return {
    runtime,
    service,
    plain,
    settings,
    reads,
    close: () => owned.disposeAsync(),
  };
}

/** Existing consumer fixtures already own these dependencies' runtimes. */
export async function buildLibraryScope(
  deps: {
    reads: Pick<PlainZoteroReads, "reads" | "on">;
    settings: PlainPluginSettings;
  },
  stack: AsyncDisposableStack,
) {
  const settings = deps.settings;
  const runtime = buildRuntime(
    layerLibraryScope.pipe(
      Layer.provide(
        Layer.mergeAll(
          layerQueryClients,
          Layer.succeed(PluginSettings, {
            current: Effect.sync(() => settings.current),
            diagnostics: Effect.sync(() => settings.diagnostics),
            changes: Stream.callback<Readonly<Settings>>(
              Effect.fnUntraced(function* (queue) {
                yield* Effect.acquireRelease(
                  Effect.sync(() =>
                    settings.subscribe((value) => {
                      Queue.offerUnsafe(queue, value);
                    }),
                  ),
                  (off) => Effect.sync(off),
                );
              }),
            ),
          } as PluginSettings["Service"]),
          Layer.succeed(ZoteroReads, {
            reads: deps.reads.reads,
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
    ),
    stack,
  );
  await runtime.context();
  return plainLibraryScope(runtime);
}
