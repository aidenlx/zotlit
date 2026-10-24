// The tag names in use in one Annotation's Library, as the Zotero database
// answers them.

import { resolveIndexedKeyLibraryIn } from "@zotlit/db";

import { Cause, Effect } from "@/lib/effect";
import type { ManagedRuntime } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import { ZoteroReads } from "@/services/zotero-reads/service";

/**
 * The tag names in use in the Annotation's Library, which the tag editor
 * suggests. The Zotero database answers them, so a tag saved moments ago
 * joins once the database has caught up. Any failure answers no tags and
 * warns, so the editor still opens.
 */
export const libraryTagNames = (
  reads: Pick<ZoteroReads["Service"], "current" | "snapshot">,
  annotationKey: string,
): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    if ((yield* reads.current).state === "degraded") return [];
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const snapshot = yield* reads.snapshot;
        const library = resolveIndexedKeyLibraryIn(
          yield* snapshot.Libraries({}),
          annotationKey,
        );
        return library
          ? yield* snapshot.TagNames({ libraryID: library.libraryID })
          : [];
      }),
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Failed to read a library's tag names").pipe(
        Effect.annotateLogs({ annotationKey, error: Cause.squash(cause) }),
        withLogCategory("database", "library-tag-names"),
        Effect.as([] as readonly string[]),
      ),
    ),
  );

/**
 * The Promise form for the Annotation editor and view, which run outside
 * Effect. It runs on the context captured at construction, so a call after
 * unload answers no tags instead of rebuilding the runtime.
 */
export function libraryTagNamesOf(
  runtime: ManagedRuntime.ManagedRuntime<ZoteroReads, never>,
): (annotationKey: string) => Promise<readonly string[]> {
  const context = runtime.runSync(Effect.context<ZoteroReads>());
  const reads = Effect.runSyncWith(context)(ZoteroReads);
  const run = Effect.runPromiseWith(context);
  return (annotationKey) => run(libraryTagNames(reads, annotationKey));
}
