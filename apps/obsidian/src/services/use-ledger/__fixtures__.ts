// A Use Ledger built from its layer over a test host's typed sources.
import { Context, DateTime, Effect, Layer, Stream } from "effect";
import type { Scope } from "effect";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import type { HostSources } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { toInstant } from "@/lib/effect-clock";
import { buildRuntime } from "@/lib/effect-layer";
import type { DeviceStorageSource } from "@/lib/obsidian-device-storage";

import { plainUseLedger } from "./plain";
import type { PlainUseLedger } from "./plain";
import { layerUseLedger, UseLedger } from "./service";

/** The device storage `load` and `save` answer, as Obsidian's local storage. */
class LedgerStorage implements DeviceStorageSource {
  constructor(
    readonly load: () => unknown,
    readonly save: (key: string, value: unknown) => void,
  ) {}

  loadLocalStorage(_key: string): unknown {
    return this.load();
  }

  saveLocalStorage(key: string, data: unknown): void {
    this.save(key, data);
  }
}

/** A host whose local storage is `storage`, with an in-memory workspace and metadata cache. */
export function ledgerHost(storage: {
  load: () => unknown;
  save?: (key: string, value: unknown) => void;
  workspace?: MemoryWorkspace;
  metadataCache?: MemoryMetadataCache;
}): HostSources {
  return {
    deviceStorage: new LedgerStorage(storage.load, storage.save ?? (() => {})),
    workspace: storage.workspace ?? new MemoryWorkspace(),
    metadataCache: storage.metadataCache ?? new MemoryMetadataCache(),
  };
}

/** The ledger over `host`, open for the current Scope. */
export function useLedgerOf(
  host: HostSources,
): Effect.Effect<UseLedger["Service"], never, Scope.Scope> {
  return Effect.map(Layer.build(ledgerOver(host)), Context.get(UseLedger));
}

/** The same ledger for a test outside Effect; `stack` closes it. */
export function buildUseLedger(host: HostSources, stack: AsyncDisposableStack) {
  const runtime = buildRuntime(ledgerOver(host), stack);
  return Object.assign(plainUseLedger(runtime), { runtime });
}

/** A ledger that holds no Use and records none. */
export const inertUseLedger: PlainUseLedger = {
  current: {},
  get: () => undefined,
  uses: {},
  record: (_itemKey, kind, instant = toInstant(DateTime.nowUnsafe())) => ({
    instant,
    kind,
  }),
  withoutNoteUse: (_file, open) => open(),
  changes: Stream.succeed({}),
};

function ledgerOver(host: HostSources): Layer.Layer<UseLedger> {
  return layerUseLedger.pipe(Layer.provide(layerHost(host)));
}
