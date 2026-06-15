/**
 * Zotero deep-link (`zotero://`) builders. `select` navigates the library to an
 * item; the format-agnostic `open` scheme navigates to an annotation within its
 * attachment (PDF / EPUB / snapshot).
 */

function libraryPath(groupID: number | null): string {
  return groupID == null ? "library" : `groups/${groupID}`;
}

/** `zotero://select` deep link to a library item. */
export function itemSelectUri(key: string, groupID: number | null): string {
  return `zotero://select/${libraryPath(groupID)}/items/${key}`;
}

export interface AnnotationOpenUriOptions {
  attachmentKey: string;
  annotationKey: string;
  /** Page positioning hint; `null` to omit. */
  pageLabel: string | null;
  /** Group library id; `null` for the personal library. */
  groupID: number | null;
}

/** `zotero://open` deep link to an annotation within its attachment. */
export function annotationOpenUri({
  attachmentKey,
  annotationKey,
  pageLabel,
  groupID,
}: AnnotationOpenUriOptions): string {
  const params = new URLSearchParams([["annotation", annotationKey]]);
  if (pageLabel) params.set("page", encodeURIComponent(pageLabel));
  return `zotero://open/${libraryPath(groupID)}/items/${attachmentKey}?${params.toString()}`;
}
