/** The batch planning edge handle over a test's reads and Library Scope. */
import { Effect } from "effect";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { bindBatchScope } from "@/services/batch-scope-handle";
import type { BatchScopeHandle } from "@/services/batch-scope-handle";
import type { ResolvedLibraryScope } from "@/services/library-scope/scope";
import type { LibraryScope } from "@/services/library-scope/service";
import type { ZoteroReads } from "@/services/zotero-reads/service";

/**
 * The real {@link bindBatchScope} over `zoteroReads`' Snapshot, with Library
 * Scope resolving to what `scope` returns at the time of each plan.
 */
export function batchScopeOver(
  zoteroReads: Pick<ZoteroReads["Service"], "snapshot">,
  scope: () => ResolvedLibraryScope,
): BatchScopeHandle {
  return bindBatchScope(
    { runPromise: Effect.runPromise },
    {
      libraryScope: stubService<LibraryScope["Service"]>("LibraryScope", {
        resolveLibraries: () => Effect.sync(scope),
      }),
      zoteroReads: stubService<ZoteroReads["Service"]>("ZoteroReads", {
        snapshot: zoteroReads.snapshot,
      }),
    },
  );
}
