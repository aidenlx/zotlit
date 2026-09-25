// The tag names in use in one Annotation's Library, as the Zotero database
// answers them.

import { getLibraryTagNames, resolveIndexedKeyLibrary } from "@zotlit/db";

import { getLogger } from "@/lib/log";

import type { DatabaseService } from "./service";

const logger = getLogger(["database", "library-tag-names"]);

/**
 * The tag names in use in the Annotation's Library, which the tag editor
 * suggests. The Zotero database answers them, so a tag saved moments ago
 * joins once the database has caught up.
 */
export function libraryTagNames(
  db: Pick<DatabaseService, "state" | "client">,
  annotationKey: string,
): readonly string[] {
  if (db.state !== "ready") return [];
  try {
    const client = db.client;
    const library = resolveIndexedKeyLibrary(client, annotationKey);
    return library ? getLibraryTagNames(client, library.libraryID) : [];
  } catch (error) {
    logger.warn("Failed to read a library's tag names", {
      annotationKey,
      error,
    });
    return [];
  }
}
