/**
 * Zotero deep-link builders. `select` navigates the Zotero library to an item;
 * the format-agnostic `open` scheme navigates to an annotation within its
 * attachment (PDF / EPUB / snapshot), mirroring the note-parser's annotation
 * backlink.
 */

/**
 * Recover the group id encoded in an item's `indexedKey` (`key` or
 * `key + 'g' + groupID`); `null` for personal-library items.
 *
 * @see formatIndexedKey in `@zotlit/db`
 */
export function groupIDFromIndexedKey(
  indexedKey: string,
  key: string,
): number | null {
  if (indexedKey.length <= key.length) return null;
  const suffix = indexedKey.slice(key.length);
  return suffix.startsWith("g") ? Number(suffix.slice(1)) : null;
}

function libraryPart(groupID: number | null): string {
  return groupID == null ? "library" : `groups/${groupID}`;
}

export function itemBacklink(key: string, groupID: number | null): string {
  return `zotero://select/${libraryPart(groupID)}/items/${key}`;
}

export function annotationBacklink(opts: {
  attachmentKey: string;
  annotationKey: string;
  pageLabel: string | null;
  groupID: number | null;
}): string {
  const page = opts.pageLabel
    ? `page=${encodeURIComponent(opts.pageLabel)}&`
    : "";
  return `zotero://open/${libraryPart(opts.groupID)}/items/${opts.attachmentKey}?${page}annotation=${opts.annotationKey}`;
}
