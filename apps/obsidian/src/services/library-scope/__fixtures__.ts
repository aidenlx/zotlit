/** Library Scope's real dependency graph over a test's RPC client and saved settings. */
import { Context, Effect, Layer } from "effect";
import type { Scope } from "effect";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { layerQueryClients } from "@/services/query-client/service";
import {
  layerPluginSettings,
  PluginSettings,
} from "@/services/settings/service";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import { layerZoteroReads, ZoteroReads } from "@/services/zotero-reads/service";

import { layerLibraryScope, LibraryScope } from "./service";

export const libraryScopeFixture = Effect.fnUntraced(function* (
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
  saved: unknown = { __VERSION__: 11 },
) {
  const context = yield* Effect.context<never>();
  return yield* Effect.acquireRelease(
    Effect.promise(() => openLibraryScope(client, saved, context)),
    (fixture) => Effect.promise(() => fixture.close()),
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
  const settings = runtime.runSync(PluginSettings);
  const bridge = effectBridge(runtime);
  const reads = Object.assign(runtime.runSync(ZoteroReads), {
    bridge: effectBridge(runtime),
    runtime,
  });
  const owned = stack.move();
  return {
    runtime,
    service,
    settings,
    bridge,
    reads,
    close: () => owned.disposeAsync(),
  };
}

/** Existing consumer fixtures already own these dependencies' runtimes. */
export async function buildLibraryScope(
  deps: {
    reads: Pick<ZoteroReads["Service"], "reads" | "events">;
    settings: PluginSettings["Service"];
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
              current: settings.current,
              diagnostics: settings.diagnostics,
              changes: settings.changes,
            }),
          ),
          Layer.succeed(
            ZoteroReads,
            stubService<ZoteroReads["Service"]>("ZoteroReads", {
              ...deps.reads,
            }),
          ),
        ),
      ),
    ),
    stack,
  );
  await runtime.context();
  return Object.assign(runtime.runSync(LibraryScope), {
    bridge: effectBridge(runtime),
    runtime,
  });
}
