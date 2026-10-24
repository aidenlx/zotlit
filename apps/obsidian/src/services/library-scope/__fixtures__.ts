/** Library Scope's real dependency graph over a test's RPC client and saved settings. */
import { stubService } from "@/lib/__fixtures__/service-stub";
import { Context, Effect, Layer, Stream } from "@/lib/effect";
import type { Scope } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { layerQueryClients } from "@/services/query-client/service";
import type { PlainPluginSettings } from "@/services/settings/plain";
import { plainPluginSettings } from "@/services/settings/plain";
import {
  layerPluginSettings,
  PluginSettings,
} from "@/services/settings/service";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";
import { plainZoteroReads } from "@/services/zotero-reads/plain";
import { layerZoteroReads, ZoteroReads } from "@/services/zotero-reads/service";

import { plainLibraryScope } from "./plain";
import { layerLibraryScope, LibraryScope } from "./service";

export const libraryScopeFixture = Effect.fnUntraced(function* (
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
  saved: unknown = { __VERSION__: 11 },
) {
  const context = yield* Effect.context<never>();
  return yield* Effect.acquireRelease(
    Effect.promise(() => openLibraryScope(client, saved, context)),
    (fixture) => Effect.promise(fixture.close),
  );
});

export async function openLibraryScope(
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
  saved: unknown = { __VERSION__: 11 },
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
    reads: Pick<
      PlainZoteroReads,
      | "reads"
      | "changed"
      | "degraded"
      | "refresh-failed"
      | "refreshing"
      | "db-file-missing"
      | "refresh-requested"
    >;
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
          Layer.succeed(
            PluginSettings,
            stubService<PluginSettings["Service"]>("PluginSettings", {
              current: Effect.sync(() => settings.current),
              diagnostics: Effect.sync(() => settings.diagnostics),
              changes: settings.changes,
            }),
          ),
          Layer.succeed(
            ZoteroReads,
            stubService<ZoteroReads["Service"]>("ZoteroReads", {
              reads: deps.reads.reads,
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
    ),
    stack,
  );
  await runtime.context();
  return plainLibraryScope(runtime);
}
