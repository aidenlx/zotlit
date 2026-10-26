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
 * write does. The batch modal's callbacks run through `bridge` too.
 */
export function bindBatchImport(
  bridge: Pick<EffectBridge, "runPromise" | "runSync" | "runPromiseExit">,
  context: Context.Context<BatchImportServices>,
  ports: Omit<BatchImportPorts, "bridge">,
): BatchImport {
  const run = <A, E>(effect: Effect.Effect<A, E, BatchImportServices>) =>
    bridge.runPromise(Effect.provideContext(effect, context));
  const importPorts: BatchImportPorts = { ...ports, bridge };
  return {
    runBatchImport: (mode, itemIDs) =>
      run(runBatchImport(importPorts, { mode, itemIDs })),
    runBatchImportAll: (target) => run(runBatchImportAll(importPorts, target)),
    runChildImportByKey: (indexedKey) =>
      run(runChildImportByKey(importPorts, indexedKey)),
    reimportNoteByKey: (noteKey, targetFile) =>
      run(reimportNoteByKey(importPorts, noteKey, targetFile)),
  };
}
