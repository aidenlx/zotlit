// A Use Ledger built from its layer over a fake App.
import type { App } from "obsidian";

import { layerHostApp } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { Context, Effect, Layer, Stream } from "@/lib/effect";
import type { Scope } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";

import { plainUseLedger } from "./plain";
import type { PlainUseLedger } from "./plain";
import { layerUseLedger, UseLedger } from "./service";

/** An App whose local storage is `storage`, with inert workspace events and an in-memory metadata cache. */
export function fakeApp(storage: {
  load: () => unknown;
  save?: (key: string, value: unknown) => void;
  offref?: () => void;
  metadataCache?: MemoryMetadataCache;
}): App {
  const ref = () => ({ e: { offref: storage.offref ?? (() => {}) } });
  return {
    loadLocalStorage: storage.load,
    saveLocalStorage: storage.save ?? (() => {}),
    workspace: { onLayoutReady: () => {}, on: ref },
    metadataCache: storage.metadataCache ?? new MemoryMetadataCache(),
  } as unknown as App;
}

/** The ledger over `app`, open for the current Scope. */
export function useLedgerOf(
  app: App,
): Effect.Effect<UseLedger["Service"], never, Scope.Scope> {
  return Effect.map(Layer.build(ledgerOver(app)), Context.get(UseLedger));
}

/** The same ledger for a test outside Effect; `stack` closes it. */
export function buildUseLedger(app: App, stack: AsyncDisposableStack) {
  const runtime = buildRuntime(ledgerOver(app), stack);
  return Object.assign(plainUseLedger(runtime), { runtime });
}

/** A ledger that holds no Use and records none. */
export const inertUseLedger: PlainUseLedger = {
  current: {},
  get: () => undefined,
  uses: {},
  record: (_itemKey, kind, instant = Temporal.Now.instant()) => ({
    instant,
    kind,
  }),
  withoutNoteUse: (_file, open) => open(),
  changes: Stream.succeed({}),
};

function ledgerOver(app: App): Layer.Layer<UseLedger> {
  return layerUseLedger.pipe(Layer.provide(layerHostApp(app)));
}
