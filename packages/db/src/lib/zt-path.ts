import { join } from "node:path";

import { parseAttachmentPath, type Attachment } from "./zt-attach";

export interface AttachmentPathContext {
  /** Zotero data directory, for resolving `storage:` paths. */
  dataDir: string;
  /**
   * Zotero `baseAttachmentPath` pref, for resolving `attachments:` linked
   * paths; `null` when unset.
   */
  baseAttachmentPath: string | null;
}

export interface ResolveAnnotCachePathOptions {
  annotKey: string;
  /** Group library ID; `null` for the user library. */
  groupID: number | null;
  /** Zotero data directory. */
  dataDir: string;
}

/**
 * Cache path for an image/ink annotation's rendered PNG. Mirrors Zotero's
 * `getCacheImagePath` joining the per-library cache dir (`library` for the
 * user library, `groups/<groupID>` otherwise) with `<key>.png`.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/annotations.js#L46-L49
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/annotations.js#L103-L116
 */
export function resolveAnnotCachePath({
  annotKey,
  groupID,
  dataDir,
}: ResolveAnnotCachePathOptions): string {
  const libraryPath =
    groupID === null ? "library" : join("groups", String(groupID));
  return join(dataDir, "cache", libraryPath, `${annotKey}.png`);
}

/**
 * Resolve an attachment to an absolute filesystem path, or `null` when it has
 * none (URL link, base-dir pref unset, or unparseable row). Mirrors Zotero's
 * `getFilePath` / `getFilePathAsync` branching on link mode.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/data/item.js#L2637-L2730
 */
export function attachmentAbsPath(
  attachment: Attachment,
  ctx: AttachmentPathContext,
): string | null {
  const parsed = parseAttachmentPath(attachment.path, attachment.linkMode);
  switch (parsed.kind) {
    // <storage-dir>/<key>/<filename>; storage dir appends the item key.
    // @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/attachments.js#L2751-L2759
    // @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/data/item.js#L2677-L2679
    case "storage":
      return join(ctx.dataDir, "storage", attachment.key, parsed.filename);
    case "linked-absolute":
      return parsed.path;
    // <baseAttachmentPath>/<relative>; null when the pref is unset, matching
    // Zotero's `resolveRelativePath` returning false.
    // @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/attachments.js#L2808-L2826
    case "linked-base":
      return ctx.baseAttachmentPath
        ? join(ctx.baseAttachmentPath, parsed.relative)
        : null;
    case "linked-url":
    case "unknown":
      return null;
  }
}
