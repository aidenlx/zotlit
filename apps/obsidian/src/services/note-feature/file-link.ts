import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import { parseAttachmentPath, type Attachment } from "@zotlit/db";

export interface AttachmentPathContext {
  /** Zotero data directory, for resolving `storage:` paths. */
  dataDir: string;
  /**
   * Zotero `baseAttachmentPath` pref, for resolving `attachments:` linked
   * paths; `null` when unset (those attachments then stay unresolved).
   */
  baseAttachmentPath: string | null;
}

/**
 * Resolve an attachment to an absolute on-disk path, or `null` for URL /
 * unknown links (and base-dir links when no base path is configured).
 *
 * @see Zotero.Attachments.resolveRelativePath / getStorageDirectory
 */
export function attachmentAbsPath(
  attachment: Attachment,
  ctx: AttachmentPathContext,
): string | null {
  const parsed = parseAttachmentPath(attachment.path, attachment.linkMode);
  switch (parsed.kind) {
    case "storage":
      return join(ctx.dataDir, "storage", attachment.key, parsed.filename);
    case "linked-absolute":
      return parsed.path;
    case "linked-base":
      return ctx.baseAttachmentPath
        ? join(ctx.baseAttachmentPath, parsed.relative)
        : null;
    case "linked-url":
    case "unknown":
      return null;
  }
}

/**
 * Build a Markdown link to the attachment's on-disk file (`[name](file://…)`),
 * or `""` when the path cannot be resolved. The image-excerpt / in-vault embed
 * refinements are deferred (Stage 9).
 */
export function attachmentFileLink(
  attachment: Attachment,
  ctx: AttachmentPathContext,
): string {
  const abs = attachmentAbsPath(attachment, ctx);
  if (!abs) return "";
  const label = basename(abs) || "attachment";
  return `[${label}](${pathToFileURL(abs).href})`;
}
