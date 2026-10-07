// The Web Worker adapter as a ZoteroReadsService client: spawn with the current settings, push every change.

import { Effect } from "effect";
import type { Scope } from "effect";
import type { App } from "obsidian";
import workerSource from "virtual:zotero-reads-worker";

import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import type { ZoteroReadsClient } from "./in-process";
import type { ReadsConfig } from "./rpc";
import { connectWorker, makeWorkerReads } from "./worker-host";

/**
 * Vault-scoped localStorage key of the dev toggle: `"worker"` runs
 * ZoteroReads on the Web Worker adapter instead of in-process.
 */
export const READS_ADAPTER_STORAGE_KEY = "zotlit-reads-adapter";

/** Whether the dev toggle asks for the Web Worker adapter. */
export function workerAdapterEnabled(
  storage: Pick<App, "loadLocalStorage">,
): boolean {
  return storage.loadLocalStorage(READS_ADAPTER_STORAGE_KEY) === "worker";
}

export interface WorkerClientDeps {
  settings: SettingsService;
  zoteroPref: ZoteroPrefService;
}

function readsConfig(
  settings: Readonly<Settings>,
  zoteroPref: ZoteroPrefService,
): ReadsConfig {
  return {
    databasePath: zoteroPref.databasePath,
    readMode: settings["zotero.read-mode"],
    autoRefresh: settings["zotero.auto-refresh"],
  };
}

const sameConfig = (a: ReadsConfig, b: ReadsConfig) =>
  a.databasePath === b.databasePath &&
  a.readMode === b.readMode &&
  a.autoRefresh === b.autoRefresh;

/**
 * A client on the ZoteroReads Web Worker for the caller's scope. Every worker
 * it spawns starts with the current database path, Read Mode, and
 * auto-refresh setting; a later change reaches the live worker through
 * `Configure`. The scope's end terminates the worker.
 */
export const workerClient = Effect.fnUntraced(function* ({
  settings,
  zoteroPref,
}: WorkerClientDeps): Effect.fn.Return<ZoteroReadsClient, never, Scope.Scope> {
  let config = readsConfig(
    yield* Effect.promise(async () => {
      await zoteroPref.ready;
      return settings.loaded;
    }),
    zoteroPref,
  );
  const reads = yield* makeWorkerReads(
    connectWorker(
      workerSource,
      Effect.sync(() => config),
    ),
  );

  const push = (): void => {
    const current = settings.current;
    if (!current) return;
    const next = readsConfig(current, zoteroPref);
    if (sameConfig(next, config)) return;
    config = next;
    Effect.runFork(Effect.ignore(reads.Configure(next)));
  };
  const unsubscribes = [
    settings.subscribe(push),
    zoteroPref.on("resolved-changed", push),
  ];
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    }),
  );
  return reads;
});
