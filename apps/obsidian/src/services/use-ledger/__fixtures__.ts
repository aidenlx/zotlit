// A Use Ledger built from its layer over a test host's typed sources.
import { Context, DateTime, Effect, Layer, Stream } from "effect";
import type { Scope } from "effect";

import { MemoryDeviceStorage } from "@/lib/__fixtures__/obsidian-device-storage";
import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import type { HostSources } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryMetadataCache } from "@/lib/__fixtures__/obsidian-metadata-cache";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { buildRuntime } from "@/lib/effect-layer";

import { layerUseLedger, UseLedger } from "./service";

/** The Obsidian objects a ledger reads, each in memory. */
export interface LedgerHost extends HostSources {
  readonly deviceStorage: MemoryDeviceStorage;
  readonly workspace: MemoryWorkspace;
  readonly metadataCache: MemoryMetadataCache;
}

/** A host with in-memory device storage, workspace and metadata cache; a test may pass its own. */
export function ledgerHost(sources: Partial<LedgerHost> = {}): LedgerHost {
  return {
    deviceStorage: sources.deviceStorage ?? new MemoryDeviceStorage(),
    workspace: sources.workspace ?? new MemoryWorkspace(),
    metadataCache: sources.metadataCache ?? new MemoryMetadataCache(),
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
  return Object.assign(runtime.runSync(UseLedger), { runtime });
}

/** A ledger that holds no Use and records none. */
export const inertUseLedger: UseLedger["Service"] = {
  current: Effect.succeed({}),
  get: () => Effect.succeed(undefined),
  uses: Effect.succeed({}),
  record: (_itemKey, kind, instant = DateTime.nowUnsafe()) =>
    Effect.succeed({ instant, kind }),
  withoutNoteUse: (_file, open) => open,
  changes: Stream.succeed({}),
};

function ledgerOver(host: HostSources): Layer.Layer<UseLedger> {
  return layerUseLedger.pipe(Layer.provide(layerHost(host)));
}
