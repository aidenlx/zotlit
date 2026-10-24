// Worker configuration follows the native dependency streams on the layer Scope.
import { getLanguage } from "obsidian";
import workerSource from "virtual:zotero-reads-worker";

import { sameSegmenterBinary } from "@zotlit/item-lookup";

import { Effect, Ref, Stream } from "@/lib/effect";
import { ChineseSegmenter } from "@/services/chinese-segmenter/service";
import { PluginSettings } from "@/services/settings/service";
import { ZoteroPref } from "@/services/zotero-pref/service";

import type { ReadsConfig } from "./rpc";
import { connectWorker, makeWorkerReads } from "./worker-host";

const sameConfig = (a: ReadsConfig, b: ReadsConfig) =>
  a.databasePath === b.databasePath &&
  a.readMode === b.readMode &&
  a.autoRefresh === b.autoRefresh &&
  a.locale === b.locale &&
  sameSegmenterBinary(a.chineseSegmenter, b.chineseSegmenter) &&
  a.logLevel === b.logLevel;

export const workerClient = Effect.fn("ZoteroReads.workerClient")(function* () {
  const settings = yield* PluginSettings;
  const pref = yield* ZoteroPref;
  const segmenter = yield* ChineseSegmenter;
  const configuration = Effect.gen(function* () {
    const current = yield* settings.current;
    const status = yield* segmenter.getStatus();
    return {
      databasePath: (yield* pref.current).databasePath,
      readMode: current["zotero.read-mode"],
      autoRefresh: current["zotero.auto-refresh"],
      locale: getLanguage(),
      chineseSegmenter:
        status.kind === "installed" || status.kind === "installing"
          ? status.binary
          : null,
      logLevel: current["log.level"],
    } satisfies ReadsConfig;
  });
  const config = yield* Ref.make(yield* configuration);
  const reads = yield* makeWorkerReads(
    connectWorker(workerSource, Ref.get(config)),
  );
  const push = Effect.fn("ZoteroReads.configure")(function* () {
    const next = yield* configuration;
    const changed = yield* Ref.modify(config, (current) =>
      sameConfig(next, current) ? [false, current] : [true, next],
    );
    if (!changed) return;
    yield* Effect.ignore(reads.Configure(next));
  });
  yield* Stream.mergeAll(
    [
      Stream.as(settings.changes, undefined),
      Stream.as(pref.changes, undefined),
      Stream.as(segmenter.changes, undefined),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Stream.runForEach(push),
    Effect.forkScoped({ startImmediately: true }),
  );
  // Reconcile while acquisition was waiting for the worker handshake.
  yield* push();
  return reads;
});
