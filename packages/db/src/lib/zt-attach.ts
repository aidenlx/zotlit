import { getLogger } from "@logtape/logtape";

import { type Temporal } from "@zotlit/shared/temporal";

const logger = getLogger(["zotlit", "db", "attachments"]);

/**
 * Maps Zotero's numeric attachment link-mode IDs to string names. `4`
 * (`embedded_image`) covers image annotations stored under the parent
 * attachment's directory and would otherwise look like an unknown mode.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/attachments.js#L30-L34
 */
const LINK_MODE = {
  0: "imported_file",
  1: "imported_url",
  2: "linked_file",
  3: "linked_url",
  4: "embedded_image",
} as const;

export type LinkMode = keyof typeof LINK_MODE;
export type LinkModeName = (typeof LINK_MODE)[LinkMode];

export function linkModeToName(linkMode: LinkMode): LinkModeName | "unknown" {
  const name = LINK_MODE[linkMode];
  if (name) return name;

  logger.warn("Unknown attachment link mode {linkMode}", { linkMode });
  return "unknown";
}

export interface Attachment {
  itemID: number;
  libraryID: number;
  groupID: number | null;
  key: string;
  parentItemID: number;
  /**
   * Stored verbatim from Zotero; consumers should narrow via
   * {@link parseAttachmentPath} rather than branching on the raw string.
   */
  path: string | null;
  contentType: string | null;
  /**
   * Raw `itemAttachments.linkMode` int (nullable in schema); resolve names
   * via {@link linkModeToName}.
   */
  linkMode: LinkMode | null;
  dateAdded: Temporal.Instant;
  dateModified: Temporal.Instant;
}

/**
 * Prefix Zotero writes for files inside an item's storage directory
 * (modes `imported_file`, `imported_url`, `embedded_image`). The suffix is
 * the filename; resolution joins it with
 * `Zotero.Attachments.getStorageDirectory(item)`.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/data/item.js#L2662-L2679
 */
const STORAGE_PREFIX = "storage:";

/**
 * Placeholder Zotero writes for `linked_file` paths under the user's base
 * attachment directory; resolution swaps the prefix for
 * `Zotero.Prefs.get('baseAttachmentPath')`.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/attachments.js#L36
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/attachments.js#L2808-L2826
 */
const BASE_PATH_PLACEHOLDER = "attachments:";

/** Resolves to `<item-storage-dir>/<filename>`. Linked from modes 0/1/4. */
export interface StoragePath {
  kind: "storage";
  filename: string;
}

/** Already a usable absolute filesystem path; emitted for linkMode 2. */
export interface LinkedAbsolutePath {
  kind: "linked-absolute";
  path: string;
}

/**
 * Resolves to `<base-attachment-pref>/<relative>`; emitted for linkMode 2
 * when the row carries the `attachments:` base-dir placeholder.
 */
export interface LinkedBasePath {
  kind: "linked-base";
  relative: string;
}

/** URL string, not a filesystem path; emitted for linkMode 3. */
export interface LinkedUrlPath {
  kind: "linked-url";
  url: string;
}

/**
 * `path` was null/empty, `linkMode` was unknown, or a storage-mode row
 * was missing the `storage:` prefix (legacy / corrupt).
 */
export interface UnknownPath {
  kind: "unknown";
  raw: string | null;
}

export type AttachmentPath =
  | StoragePath
  | LinkedAbsolutePath
  | LinkedBasePath
  | LinkedUrlPath
  | UnknownPath;

/**
 * Narrow an `itemAttachments.(path, linkMode)` pair into Zotero's path
 * semantics. Pure string-level parsing — does not resolve the storage
 * directory or base-attachment pref, since both are runtime values held by
 * the Obsidian-side ZoteroDB service, not the query layer.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/data/item.js#L2640-L2730
 */
export function parseAttachmentPath(
  path: string | null,
  linkMode: LinkMode | null,
): AttachmentPath {
  if (!path || linkMode === null) return { kind: "unknown", raw: path };

  switch (linkModeToName(linkMode)) {
    case "imported_file":
    case "imported_url":
    case "embedded_image":
      return path.startsWith(STORAGE_PREFIX)
        ? { kind: "storage", filename: path.slice(STORAGE_PREFIX.length) }
        : { kind: "unknown", raw: path };
    case "linked_file":
      return path.startsWith(BASE_PATH_PLACEHOLDER)
        ? {
            kind: "linked-base",
            relative: path.slice(BASE_PATH_PLACEHOLDER.length),
          }
        : { kind: "linked-absolute", path };
    case "linked_url":
      return { kind: "linked-url", url: path };
    default:
      return { kind: "unknown", raw: path };
  }
}
