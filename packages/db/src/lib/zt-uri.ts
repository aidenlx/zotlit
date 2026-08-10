/**
 * Zotero deep-link (`zotero://`) builders, the persistent `http://zotero.org/`
 * Item URI, and the browsable web library URL. `select` navigates the library
 * to an item; the format-agnostic `open` scheme navigates to an annotation
 * within its attachment (PDF / EPUB / snapshot).
 */
import type { ZoteroUserIdentity } from "@/queries/account";

function libraryPath(groupID: number | null): string {
  return groupID == null ? "library" : `groups/${groupID}`;
}

/** `zotero://select` deep link to a library item. */
export function itemSelectUri(key: string, groupID: number | null): string {
  return `zotero://select/${libraryPath(groupID)}/items/${key}`;
}

/**
 * Persistent Zotero Item URI (`http://zotero.org/...`) — the stable identity
 * Zotero writes as a CSL-JSON `id` and embeds in note citation markup. It names
 * an item rather than addressing a page; {@link itemWebUrl} builds the
 * browsable zotero.org URL.
 *
 * @returns `null` for a personal-library item on an account carrying neither
 *   id, which leaves the personal library with no URI to name it by.
 * @see docs/adr/0009-weblink-is-the-web-url-not-the-item-uri.md
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/uri.js#L87
 */
export function itemUri(
  key: string,
  groupID: number | null,
  user: ZoteroUserIdentity,
): string | null {
  const path = groupID != null ? `groups/${groupID}` : userPath(user);
  return path && `http://zotero.org/${path}/items/${key}`;
}

function userPath({ userID, localUserKey }: ZoteroUserIdentity): string | null {
  if (userID != null) return `users/${userID}`;
  return localUserKey == null ? null : `users/local/${localUserKey}`;
}

/** Zotero's username→URL-slug rule: trim, lowercase, strip chars outside
 *  `[a-z0-9 ._-]`, spaces to underscores.
 *  @see https://github.com/zotero/dataserver/blob/1b53e6846b0dafcc97d2ec85c7717cacd80e7d31/model/Utilities.inc.php#L94 */
function slugify(username: string): string {
  return username
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9 ._-]/g, "")
    .replaceAll(" ", "_");
}

/**
 * Zotero web library URL (`https://www.zotero.org/...`) for a library item.
 * Personal-library items use the account username slug
 * (`.../{slugify(username)}/items/{key}`); group items use the numeric group id
 * (`.../groups/{groupID}/items/{key}`, which zotero.org redirects to the
 * `groups/{id}/{slug}` form). Returns `null` for a personal item on a
 * never-synced account, which has no username.
 *
 * @see docs/adr/0009-weblink-is-the-web-url-not-the-item-uri.md
 */
export function itemWebUrl(
  key: string,
  groupID: number | null,
  username: string | null,
): string | null {
  if (groupID != null)
    return `https://www.zotero.org/groups/${groupID}/items/${key}`;
  if (username == null) return null;
  return `https://www.zotero.org/${slugify(username)}/items/${key}`;
}

export interface AnnotationOpenUriOptions {
  attachmentKey: string;
  annotationKey: string;
  /** Page positioning hint; `null` to omit. */
  pageLabel: string | null;
  /** Group library id; `null` for the personal library. */
  groupID: number | null;
}

/** `zotero://open` deep link to an attachment (opens it in Zotero's reader). */
export function attachmentOpenUri(key: string, groupID: number | null): string {
  return `zotero://open/${libraryPath(groupID)}/items/${key}`;
}

/** `zotero://open` deep link to an annotation within its attachment. */
export function annotationOpenUri({
  attachmentKey,
  annotationKey,
  pageLabel,
  groupID,
}: AnnotationOpenUriOptions): string {
  const params = new URLSearchParams([["annotation", annotationKey]]);
  if (pageLabel) params.set("page", pageLabel);
  params.sort();
  return `${attachmentOpenUri(attachmentKey, groupID)}?${params.toString()}`;
}
