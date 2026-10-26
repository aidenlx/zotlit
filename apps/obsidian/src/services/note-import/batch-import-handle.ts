// Note import for callers outside Effect: Note Feature's actions and the debug surface.
import { Effect } from "effect";
import type { Context } from "effect";

import type { EffectBridge } from "@/lib/effect-bridge";

import {
  reimportNoteByKey,
  runBatchImport,
  runBatchImportAll,
  runChildImportByKey,
} from "./batch-import";
import type {
  BatchImport,
  BatchImportPorts,
  BatchImportServices,
} from "./batch-import";

/**
 * The note import commands over `context`, run through `bridge`. A command
 * resolves with its outcome and rejects with what failed, as a read or a
 * write does.
 */
export function bindBatchImport(
  bridge: Pick<EffectBridge, "runPromise">,
  context: Context.Context<BatchImportServices>,
  ports: BatchImportPorts,
): BatchImport {
  const run = <A, E>(effect: Effect.Effect<A, E, BatchImportServices>) =>
    bridge.runPromise(Effect.provideContext(effect, context));
  return {
    runBatchImport: (mode, itemIDs) =>
      run(runBatchImport(ports, { mode, itemIDs })),
    runBatchImportAll: (target) => run(runBatchImportAll(ports, target)),
    runChildImportByKey: (indexedKey) =>
      run(runChildImportByKey(ports, indexedKey)),
    reimportNoteByKey: (noteKey, targetFile) =>
      run(reimportNoteByKey(ports, noteKey, targetFile)),
  };
}
