// The Web Worker adapter as a ZoteroReadsService client: spawn with the current settings, push every change.

import { Effect, FiberSet } from "effect";
import type { Scope } from "effect";
import { getLanguage } from "obsidian";
import workerSource from "virtual:zotero-reads-worker";

import { CHINESE_SEGMENTER } from "@/services/chinese-segmenter/service";
import type { ChineseSegmenterService } from "@/services/chinese-segmenter/service";
import { cachedBinaryName } from "@/services/managed-binary/service";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import type { ZoteroReadsClient } from "./in-process";
import { sameBinary } from "./rpc";
import type { ReadsConfig, SegmenterBinary } from "./rpc";
import { connectWorker, makeWorkerReads } from "./worker-host";

export interface WorkerClientDeps {
  settings: SettingsService;
  zoteroPref: ZoteroPrefService;
  chineseSegmenter: ChineseSegmenterService;
}

/**
 * The verified binary in the device-wide store, once the Chinese Segmenter is
 * installed. An install in flight keeps `reported`, the binary the worker
 * holds now, so a reinstall pushes no segmenter change until it lands.
 */
function installedSegmenter(
  chineseSegmenter: ChineseSegmenterService,
  reported: SegmenterBinary | null,
): SegmenterBinary | null {
  switch (chineseSegmenter.getStatus().kind) {
    case "installed":
      return {
        directory: CHINESE_SEGMENTER.id,
        name: cachedBinaryName(CHINESE_SEGMENTER.pin),
      };
    case "installing":
      return reported;
    default:
      return null;
  }
}

function readsConfig(
  settings: Readonly<Settings>,
  { zoteroPref, chineseSegmenter }: Omit<WorkerClientDeps, "settings">,
  reported: SegmenterBinary | null,
): ReadsConfig {
  return {
    databasePath: zoteroPref.databasePath,
    readMode: settings["zotero.read-mode"],
    autoRefresh: settings["zotero.auto-refresh"],
    locale: getLanguage(),
    chineseSegmenter: installedSegmenter(chineseSegmenter, reported),
    logLevel: settings["log.level"],
  };
}

const sameConfig = (a: ReadsConfig, b: ReadsConfig) =>
  a.databasePath === b.databasePath &&
  a.readMode === b.readMode &&
  a.autoRefresh === b.autoRefresh &&
  a.locale === b.locale &&
  sameBinary(a.chineseSegmenter, b.chineseSegmenter) &&
  a.logLevel === b.logLevel;

/**
 * A client on the ZoteroReads Web Worker for the caller's scope. Every worker
 * it spawns starts with the current database path, Read Mode, auto-refresh
 * setting, UI locale, installed Chinese Segmenter, and log level; a later change reaches the live worker through
 * `Configure`. The scope's end terminates the worker.
 */
export const workerClient = Effect.fnUntraced(function* ({
  settings,
  zoteroPref,
  chineseSegmenter,
}: WorkerClientDeps): Effect.fn.Return<ZoteroReadsClient, never, Scope.Scope> {
  let config = readsConfig(
    yield* Effect.promise(async () => {
      await Promise.all([zoteroPref.ready, chineseSegmenter.ready]);
      return settings.loaded;
    }),
    { zoteroPref, chineseSegmenter },
    null,
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
    const next = readsConfig(
      current,
      { zoteroPref, chineseSegmenter },
      config.chineseSegmenter,
    );
    if (sameConfig(next, config)) return;
    config = next;
    run(Effect.ignore(reads.Configure(next)));
  };
  const unsubscribes = [
    settings.subscribe(push),
    zoteroPref.on("resolved-changed", push),
    chineseSegmenter.subscribe(push),
  ];
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    }),
  );
  return reads;
});
