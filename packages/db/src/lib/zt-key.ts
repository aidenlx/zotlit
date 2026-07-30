import {
  formatIndexedKey,
  isIndexedKey,
  parseIndexedKey,
  type ParsedIndexedKey,
} from "@zotlit/shared/indexed-key";

// The pure format rule lives in `@zotlit/shared/indexed-key`, which the Zotero
// companion also uses. Re-exported here so consumers of this package keep one
// front door alongside the database-dependent resolver below.
export { formatIndexedKey, isIndexedKey, parseIndexedKey };
export type { ParsedIndexedKey };

import { type NodeDatabaseClient } from "@/client/node";
import { getLibraryByGroupID } from "@/queries/libraries";

import { USER_LIBRARY_ID } from "./constants";

/** Resolve the active library for an `indexedKey`, or `null` when unresolvable. */
export function resolveIndexedKeyLibrary(
  client: NodeDatabaseClient,
  indexedKey: string,
): { key: string; libraryID: number } | null {
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed) return null;
  const { key, groupID } = parsed;
  if (groupID == null) return { key, libraryID: USER_LIBRARY_ID };
  const library = getLibraryByGroupID(client, groupID);
  if (!library) return null;
  return { key, libraryID: library.libraryID };
}
