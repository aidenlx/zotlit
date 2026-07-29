// Pure Indexed Key formatting and parsing shared by the Obsidian and Zotero apps.
import { regex } from "arkregex";

/** An 8-char base-32 object key, optionally suffixed `g<groupID>`. */
const PATTERN_INDEXED_KEY = regex(
  "^(?<key>[23456789A-NP-Z]{8})(?:g(?<groupID>\\d+))?$",
);

export interface ParsedIndexedKey {
  key: string;
  /** Group library id; `null` for a personal-library object. */
  groupID: number | null;
}

/**
 * The canonical cross-library identity of a Zotero object: the bare `key` for
 * the personal library, `key + "g" + groupID` for a group library.
 *
 * @see parseIndexedKey — the inverse
 */
export function formatIndexedKey(
  key: string,
  groupID: number | null | undefined,
): string {
  return groupID == null ? key : `${key}g${groupID}`;
}

/**
 * Split an Indexed Key back into its key and group, or `null` when it is not
 * well-formed.
 *
 * @see formatIndexedKey — the inverse
 */
export function parseIndexedKey(indexedKey: string): ParsedIndexedKey | null {
  const match = PATTERN_INDEXED_KEY.exec(indexedKey);
  if (!match) return null;
  const { key, groupID } = match.groups;
  return { key, groupID: groupID ? Number(groupID) : null };
}

/** Whether `value` is a well-formed Indexed Key. */
export function isIndexedKey(value: string): boolean {
  return PATTERN_INDEXED_KEY.test(value);
}
