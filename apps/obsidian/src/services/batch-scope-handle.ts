// The batch planning phase for the legacy batch runners: planBatchScope behind a Promise.
import { Effect } from "effect";

import type { EffectBridge } from "@/lib/effect-bridge";
import { LibraryScope } from "@/services/library-scope/service";
import { ZoteroReads } from "@/services/zotero-reads/service";

import { planBatchScope } from "./batch-scope";
import type {
  BatchScopeKind,
  BatchScopePlan,
  BatchTarget,
} from "./batch-scope";

/**
 * {@link planBatchScope} for the legacy batch update and batch import
 * runners: an edge handle (`policies/services.md` → Edge handle). The plan
 * resolves with its value and rejects with its failure, as the runners'
 * `runBatch` did; unload does not interrupt it.
 */
export interface BatchScopeHandle {
  plan(kind: BatchScopeKind, target: BatchTarget): Promise<BatchScopePlan>;
}

export function bindBatchScope(
  bridge: Pick<EffectBridge, "runPromise">,
  services: {
    libraryScope: LibraryScope["Service"];
    zoteroReads: ZoteroReads["Service"];
  },
): BatchScopeHandle {
  return {
    plan: (kind, target) =>
      bridge.runPromise(
        planBatchScope(kind, target).pipe(
          Effect.provideService(LibraryScope, services.libraryScope),
          Effect.provideService(ZoteroReads, services.zoteroReads),
        ),
      ),
  };
}
