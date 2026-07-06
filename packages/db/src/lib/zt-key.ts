import { regex } from "arkregex";

import { type NodeDatabaseClient } from "@/client/node";
import { getLibraryByGroupID } from "@/queries/libraries";

import { USER_LIBRARY_ID } from "./constants";

/**
 * A Zotero item key (8 base-32 chars), optionally suffixed with `g<groupID>` to
 * form an "indexed key" that disambiguates same-key items across libraries.
 *
 * @see formatIndexedKey for the inverse.
 */
const PATTERN_INDEXED_KEY = regex(
  "^(?<key>[23456789A-NP-Z]{8})(?:g(?<groupID>\\d+))?$",
);

export interface ParsedIndexedKey {
  key: string;
  /** Group library id; `null` for a personal-library item. */
  groupID: number | null;
}

/** `key`, or `key + 'g' + groupID` for group-library items. */
export function formatIndexedKey(
  key: string,
  groupID: number | null | undefined,
): string {
  return groupID == null ? key : `${key}g${groupID}`;
}

/**
 * Split an indexed key into its `key` and `groupID`; `null` when the input is
 * not a well-formed indexed key.
 */
export function parseIndexedKey(indexedKey: string): ParsedIndexedKey | null {
  const match = PATTERN_INDEXED_KEY.exec(indexedKey);
  if (!match) return null;
  const { key, groupID } = match.groups;
  return { key, groupID: groupID ? Number(groupID) : null };
}

/** Whether `value` is a well-formed Zotero item key or indexed key. */
export function isIndexedKey(value: string): boolean {
  return PATTERN_INDEXED_KEY.test(value);
}

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
