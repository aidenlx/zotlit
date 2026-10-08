// Live Items for Indexed Keys: the read `ItemsByIndexedKeys`, `WorkLabels`, and Item Index hydration share.
import {
  getItemsByKey,
  parseIndexedKey,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";
import type { GroupIDMemo, Item } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

/**
 * Live items for Indexed Keys, keyed by Indexed Key in request order. Each
 * Library the keys span resolves once and reads its items through
 * `getItemsByKey`: one cached keyed read per Library.
 */
export function itemsByIndexedKeys(
  client: NodeDatabaseClient,
  indexedKeys: readonly string[],
): Map<string, Item> {
  const libraryByGroupID = new Map<number | null, number | null>();
  // The group of each resolved Library, so hydration skips the group read.
  const groupIDMemo: GroupIDMemo = new Map();
  // Each requested spelling (`g7` or `g007`) with the Library and item key it resolves to.
  const requested: { indexedKey: string; libraryID: number; key: string }[] =
    [];
  const keysByLibrary = new Map<number, string[]>();
  for (const indexedKey of indexedKeys) {
    const parsed = parseIndexedKey(indexedKey);
    if (!parsed) continue;
    if (!libraryByGroupID.has(parsed.groupID)) {
      libraryByGroupID.set(
        parsed.groupID,
        resolveIndexedKeyLibrary(client, indexedKey)?.libraryID ?? null,
      );
    }
    const libraryID = libraryByGroupID.get(parsed.groupID);
    if (libraryID == null) continue;
    groupIDMemo.set(libraryID, parsed.groupID);
    requested.push({ indexedKey, libraryID, key: parsed.key });
    const keys = keysByLibrary.get(libraryID);
    if (keys) keys.push(parsed.key);
    else keysByLibrary.set(libraryID, [parsed.key]);
  }
  const found = new Map<number, Map<string, Item>>();
  for (const [libraryID, keys] of keysByLibrary) {
    found.set(
      libraryID,
      new Map(
        getItemsByKey(client, keys, { libraryID, memo: groupIDMemo }).map(
          (item) => [item.key, item],
        ),
      ),
    );
  }
  const items = new Map<string, Item>();
  for (const { indexedKey, libraryID, key } of requested) {
    const item = found.get(libraryID)?.get(key);
    if (item) items.set(indexedKey, item);
  }
  return items;
}
