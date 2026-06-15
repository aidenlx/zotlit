import { basename } from "node:path";
import { pathToFileURL } from "node:url";

import { type Attachment } from "@zotlit/db";
import { attachmentAbsPath, type AttachmentPathContext } from "@zotlit/db/path";

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
