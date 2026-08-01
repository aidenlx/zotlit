import { regex } from "arkregex";

/**
 * Zotero's item-key charset: digits 2-9 plus uppercase A-Z excluding `O`,
 * avoiding visual ambiguity with `0`/`1`/`I`/`O`. Keys are always 8
 * characters; a value failing this can never be a genuine Zotero key.
 *
 * @see https://github.com/zotero/utilities/blob/86948f960557c18eb6489ebe228b820957d13cf0/utilities.js#L1729 `allowedKeyChars`
 * @see https://github.com/zotero/utilities/blob/86948f960557c18eb6489ebe228b820957d13cf0/utilities.js#L1741-L1746 `isValidObjectKey`
 */
const ITEM_KEY_RE = regex("^[23456789A-NP-Z]{8}$");

/** A decimal Zotero group-library ID. */
const GROUP_ID_RE = regex("^\\d+$");

export interface ParsedIndexedKey {
  key: string;
  /** Group library id; `null` for a personal-library object. */
  groupID: number | null;
}

/** Format a bare or group-library item key for cross-library identity. */
export function formatIndexedKey(
  key: string,
  groupID: number | null | undefined,
): string {
  return groupID == null ? key : `${key}g${groupID}`;
}

/** Whether `value` is a bare Zotero item key. */
export function isItemKey(value: string): boolean {
  return ITEM_KEY_RE.test(value);
}

/**
 * Split an Indexed Key into its bare item key and optional group id.
 *
 * The separator is deliberately handled as a split rather than part of the
 * item-key pattern: the item key validator remains the single source of truth
 * for the former part, while the latter part is validated as a group id.
 */
export function parseIndexedKey(indexedKey: string): ParsedIndexedKey | null {
  const parts = indexedKey.split("g");
  if (parts.length > 2) return null;
  const key = parts[0]!;
  const groupID = parts[1];
  if (!isItemKey(key)) return null;
  if (groupID === undefined) return { key, groupID: null };
  if (!GROUP_ID_RE.test(groupID)) return null;

  const parsedGroupID = Number(groupID);
  return Number.isSafeInteger(parsedGroupID)
    ? { key, groupID: parsedGroupID }
    : null;
}

/** Whether `value` is a well-formed Indexed Key. */
export function isIndexedKey(value: string): boolean {
  return parseIndexedKey(value) !== null;
}

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
