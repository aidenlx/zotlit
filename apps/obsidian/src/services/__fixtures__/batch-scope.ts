/** The batch planning edge handle over a test's reads and Library Scope. */
import { Effect, Layer } from "effect";

import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { bindBatchScope } from "@/services/batch-scope-handle";
import type { BatchScopeHandle } from "@/services/batch-scope-handle";
import type { ResolvedLibraryScope } from "@/services/library-scope/scope";
import { LibraryScope } from "@/services/library-scope/service";
import { readsAnswering } from "@/services/zotero-reads/__fixtures__";
import { ZoteroReads } from "@/services/zotero-reads/service";

/**
 * The real {@link bindBatchScope} on a runtime's bridge, as `build.ts` binds
 * it: the runtime holds `zoteroReads`' Snapshot and a Library Scope that
 * resolves to what `scope` returns at the time of each plan. `stack` disposes
 * the runtime.
 */
export function batchScopeOver(
  zoteroReads: Pick<ZoteroReads["Service"], "snapshot">,
  scope: () => ResolvedLibraryScope,
  stack: AsyncDisposableStack,
): BatchScopeHandle {
  const runtime = buildRuntime(
    Layer.mergeAll(
      Layer.mock(LibraryScope, {
        resolveLibraries: () => Effect.sync(scope),
      }),
      Layer.mock(ZoteroReads, {
        // The plan reads only through its Snapshot.
        reads: readsAnswering({}),
        snapshot: zoteroReads.snapshot,
      }),
    ),
    stack,
  );
  return bindBatchScope(effectBridge(runtime), {
    libraryScope: runtime.runSync(LibraryScope),
    zoteroReads: runtime.runSync(ZoteroReads),
  });
}
