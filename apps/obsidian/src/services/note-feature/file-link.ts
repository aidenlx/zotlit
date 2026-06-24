import { basename } from "node:path";

import { type Attachment, type TemplateLink } from "@zotlit/db";
import { attachmentAbsPath, type AttachmentPathContext } from "@zotlit/db/path";

import { fileUrlLink } from "@/lib/markdown-link";

/**
 * Build the {@link TemplateLink} for an attachment's on-disk file
 * (`[name](file://…)`). Rendered with no override it shows the filename and, for
 * annotation-level links, anchors to `#page=N` when `page` is a number; pass
 * `alias` / `subpath` to override either. The helper returns `""` when the path
 * cannot be resolved.
 */
export function attachmentFileLink(
  attachment: Attachment,
  ctx: AttachmentPathContext,
  page?: number | null,
): TemplateLink {
  const abs = attachmentAbsPath(attachment, ctx);
  if (!abs) return () => "";
  const filename = basename(abs) || "attachment";
  return fileUrlLink(abs, filename, page != null ? `#page=${page}` : "");
}
