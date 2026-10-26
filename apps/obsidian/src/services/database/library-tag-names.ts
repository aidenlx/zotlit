// The tag names in use in one Annotation's Library, as the Zotero database
// answers them.

import { Cause, Effect } from "effect";
import type { ManagedRuntime } from "effect";

import { resolveIndexedKeyLibraryIn } from "@zotlit/db";

import { effectBridge, valueOr } from "@/lib/effect-bridge";
import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import { ZoteroReads } from "@/services/zotero-reads/service";

/**
 * The tag names in use in the Annotation's Library, which the tag editor
 * suggests. The Zotero database answers them, so a tag saved moments ago
 * joins once the database has caught up. Any failure answers no tags and
 * warns, so the editor still opens; an interrupt passes on.
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
    recover(
      (cause) =>
        Effect.logWarning("Failed to read a library's tag names").pipe(
          Effect.annotateLogs({ annotationKey, error: Cause.squash(cause) }),
          withLogCategory("database", "library-tag-names"),
        ),
      Effect.succeed<readonly string[]>([]),
    ),
  );

/**
 * The Promise form for the Annotation editor and view, which run outside
 * Effect. It runs on the bridge, so unload stops a pending read, and a read
 * that unload stops or that starts after it answers no tags.
 */
export function libraryTagNamesOf(
  runtime: ManagedRuntime.ManagedRuntime<ZoteroReads, never>,
): (annotationKey: string) => Promise<readonly string[]> {
  const reads = runtime.runSync(ZoteroReads);
  const bridge = effectBridge(runtime);
  return async (annotationKey) =>
    valueOr(
      await bridge.runPromiseExit(libraryTagNames(reads, annotationKey)),
      [],
    );
}
