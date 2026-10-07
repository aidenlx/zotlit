// The tag names in use in one Annotation's Library, as the Zotero database
// answers them.

import { Effect } from "effect";

import { resolveIndexedKeyLibraryIn } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

const logger = getLogger(["database", "library-tag-names"]);

/**
 * The tag names in use in the Annotation's Library, which the tag editor
 * suggests. The Zotero database answers them, so a tag saved moments ago
 * joins once the database has caught up.
 */
export async function libraryTagNames(
  db: Pick<ZoteroReadsService, "state" | "acquireRead">,
  annotationKey: string,
): Promise<readonly string[]> {
  if (db.state === "degraded") return [];
  try {
    using lease = await db.acquireRead();
    const library = resolveIndexedKeyLibraryIn(
      await Effect.runPromise(lease.reads.Libraries({})),
      annotationKey,
    );
    return library
      ? await Effect.runPromise(
          lease.reads.TagNames({ libraryID: library.libraryID }),
        )
      : [];
  } catch (error) {
    logger.warn("Failed to read a library's tag names", {
      annotationKey,
      error,
    });
    return [];
  }
}
