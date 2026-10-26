// A Welcome test host over in-memory Obsidian sources and controllable Effect services.
import { Effect, Layer, Stream } from "effect";

import { testEvent } from "@/lib/__fixtures__/event-stream";
import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import type { HostSources } from "@/lib/__fixtures__/obsidian-host-app";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { layerUnreadViewServices } from "@/lib/__fixtures__/view-atoms";
import { buildRuntime } from "@/lib/effect-layer";
import { makeViewRegistry } from "@/lib/view-atoms";
import { yieldToMain } from "@/lib/yield-to-main";
import { layerQueryClients } from "@/services/query-client/service";
import { Release } from "@/services/release/service";
import { layerPluginSettings } from "@/services/settings/service";
import { TemplateMigration } from "@/services/template/migration";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type {
  ZoteroReadsEvent,
  ZoteroReadsState,
} from "@/services/zotero-reads/service";

import { connectionLifecycleAtom } from "./connection";
import { holdWelcomeModel, makeWelcomeModel } from "./model";

export async function waitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === 999) throw error;
      await yieldToMain();
    }
  }
}

export interface WelcomeHostOptions<R = never> {
  readonly sources?: HostSources;
  readonly services?: Layer.Layer<R>;
  readonly dataDir?: string;
  readonly count?: (signal: AbortSignal) => Promise<{ itemCount: number }>;
}

export async function makeWelcomeHost<R = never>(
  options: WelcomeHostOptions<R> = {},
) {
  await using stack = new AsyncDisposableStack();
  const events = testEvent<ZoteroReadsEvent>();
  const states = testEvent<ZoteroReadsState>();
  let current: ZoteroReadsState = {
    state: "ready",
    error: null,
    moved: false,
    dbFileMissing: false,
    activeReadMode: null,
  };
  let reads = 0;
  const runtime = buildRuntime(
    Layer.mergeAll(
      layerUnreadViewServices,
      layerHost(options.sources),
      layerQueryClients,
      layerPluginSettings({
        loadData: async () => null,
        saveData: async () => {},
      }),
      Layer.mock(Release, {
        version: "2.2.0",
        hasV1Templates: () => Effect.succeed(false),
        acknowledgeMigration: Effect.void,
        acknowledgeUpdate: Effect.void,
        openReleaseNote: Effect.void,
      }),
      Layer.mock(TemplateMigration, {}),
      Layer.mock(ZoteroPref, {
        current: Effect.succeed(
          stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
            dataDir: options.dataDir ?? "/Zotero",
          }),
        ),
      }),
      Layer.mock(ZoteroReads, {
        current: Effect.sync(() => current),
        changes: Stream.concat(
          Stream.suspend(() => Stream.make(current)),
          states.stream,
        ),
        events: events.stream,
        reads: stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {
          ConnectionReadout: <
            const _AsQueue extends boolean = false,
            const Discard = false,
          >(
            _input: object,
            rpcOptions?: { readonly discard?: Discard },
          ) =>
            Effect.map(
              Effect.promise((signal) => {
                reads += 1;
                return (
                  options.count?.(signal) ?? Promise.resolve({ itemCount: 3 })
                );
              }),
              (value) =>
                (rpcOptions?.discard
                  ? undefined
                  : value) as Discard extends true
                  ? void
                  : { readonly itemCount: number },
            ),
        }),
      }),
      options.services ?? Layer.empty,
    ),
    stack,
  );
  const context = await runtime.context();
  const registry = makeViewRegistry(context, { idleTTL: 0 });
  stack.defer(() => registry.dispose());
  // The plugin holds invalidation even while every Library leaf is closed.
  stack.defer(registry.mount(connectionLifecycleAtom));
  const lifetime = stack.move();
  return {
    registry,
    context,
    reads: () => reads,
    publish: (
      event: ZoteroReadsEvent,
      patch: Partial<ZoteroReadsState> = {},
    ) => {
      current = { ...current, ...patch };
      states.emit(current);
      events.emit(event);
    },
    subscribers: () => events.subscribers,
    openSession: () => {
      const model = makeWelcomeModel();
      const release = holdWelcomeModel(registry, model);
      return {
        model,
        state: () => registry.get(model.state),
        [Symbol.dispose]: release,
      };
    },
    close: () => lifetime.disposeAsync(),
    [Symbol.asyncDispose]: () => lifetime.disposeAsync(),
  };
}
