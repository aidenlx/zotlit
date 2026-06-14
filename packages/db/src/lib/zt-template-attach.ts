import {
  LINK_MODE,
  parseAttachmentPath,
  type Attachment,
  type AttachmentPath,
} from "./zt-attach";

/**
 * Attachment data in the v2 template vocabulary. Exposed on `zt.attachments`
 * and as `parentAttachment` on each annotation.
 */
export interface TemplateAttachment {
  key: string;
  /** Filename resolved from the attachment path; null for URL / unknown links. */
  filename: string | null;
  contentType: string | null;
  /**
   * Resolved {@link LINK_MODE} name; `"unknown"` when the raw mode is null or
   * unrecognized.
   */
  linkMode: string;
  /** Vault-relative link, computed at the app layer. */
  fileLink: string;
}

/**
 * Map a DB {@link Attachment} to its template shape. `fileLink` is omitted —
 * it depends on vault/storage resolution held by the Obsidian-side service.
 */
export function attachmentToTemplateData(
  attachment: Attachment,
): Omit<TemplateAttachment, "fileLink"> {
  return {
    key: attachment.key,
    filename: attachmentFilename(
      parseAttachmentPath(attachment.path, attachment.linkMode),
    ),
    contentType: attachment.contentType,
    linkMode:
      attachment.linkMode == null
        ? "unknown"
        : (LINK_MODE[attachment.linkMode as keyof typeof LINK_MODE] ??
          "unknown"),
  };
}

function attachmentFilename(path: AttachmentPath): string | null {
  switch (path.kind) {
    case "storage":
      return path.filename;
    case "linked-absolute":
      return basename(path.path);
    case "linked-base":
      return basename(path.relative);
    case "linked-url":
    case "unknown":
      return null;
  }
}

function basename(p: string): string | null {
  return p.split(/[/\\]/).pop() || null;
}
