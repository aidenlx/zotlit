import { prefs } from "@/prefs";

/**
 * Read the `notify` master switch at emit time so toggling it off in prefs
 * stops dispatching immediately without re-registering observers.
 */
export function notifyEnabled(): boolean {
  return prefs.get<boolean>("extensions.zotlit.notify") === true;
}

/**
 * Sorted item ids of a reader's current annotation selection (drops unresolved
 * keys). The authoritative set lives in the reader iframe as annotation
 * **keys**; map them back to item ids for the wire protocol.
 *
 * @see https://github.com/zotero/reader/blob/9.0.3/src/common/reader.js#L493
 */
export function currentSelection(
  reader: _ZoteroTypes.ReaderInstance,
  libraryID: number,
): number[] {
  const keys = reader._internalReader?._state?.selectedAnnotationIDs ?? [];
  return [...keys]
    .map((key) => Zotero.Items.getIDFromLibraryAndKey(libraryID, key))
    .filter((id): id is number => id !== false)
    .sort((a, b) => a - b);
}
