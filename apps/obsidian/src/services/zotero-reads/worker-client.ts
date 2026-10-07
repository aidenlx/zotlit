// The Web Worker adapter as a ZoteroReadsService client: spawn with the current settings, push every change.

import { Effect, FiberSet } from "effect";
import type { Scope } from "effect";
import { getLanguage } from "obsidian";
import workerSource from "virtual:zotero-reads-worker";

import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import type { ZoteroReadsClient } from "./in-process";
import type { ReadsConfig } from "./rpc";
import { connectWorker, makeWorkerReads } from "./worker-host";

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
    locale: getLanguage(),
  };
}

const sameConfig = (a: ReadsConfig, b: ReadsConfig) =>
  a.databasePath === b.databasePath &&
  a.readMode === b.readMode &&
  a.autoRefresh === b.autoRefresh &&
  a.locale === b.locale;

/**
 * A client on the ZoteroReads Web Worker for the caller's scope. Every worker
 * it spawns starts with the current database path, Read Mode, auto-refresh
 * setting, and UI locale; a later change reaches the live worker through
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
  // Pushes run in this scope, so the scope's end interrupts one in flight.
  const run = yield* FiberSet.runtime(yield* FiberSet.make())();
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
    run(Effect.ignore(reads.Configure(next)));
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
