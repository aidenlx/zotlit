import { prefs } from "@/prefs";

/**
 * Read the `notify` master switch at emit time so toggling it off in prefs
 * stops dispatching immediately without re-registering observers.
 */
export function notifyEnabled(): boolean {
  return prefs.get<boolean>("extensions.zotlit.notify") === true;
}

/**
 * The configured Obsidian listener base URL from the `notify-url` pref.
 */
export function notifyUrl(): string | undefined {
  const url = (prefs.get<string>("extensions.zotlit.notify-url") ?? "").trim();
  return url.length > 0 ? url : undefined;
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
