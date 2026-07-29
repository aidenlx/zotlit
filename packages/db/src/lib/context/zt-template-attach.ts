import { defineToString } from "@/lib/to-string";
import {
  linkModeToName,
  parseAttachmentPath,
  type Attachment,
  type AttachmentPath,
} from "@/lib/zt-attach";
import { attachmentOpenUri } from "@/lib/zt-uri";

import { emptyToNull } from "./normalize";
import { type FallibleTemplateLink } from "./zt-template-item";

/**
 * Attachment data in the v2 template vocabulary. Exposed on `zt.attachments`
 * and as `parentAttachment` on each annotation.
 */
export interface TemplateAttachment {
  /** Zotero item key of the attachment. */
  key: string;
  /** Filename resolved from the attachment path; null for URL / unknown links. */
  filename: string | null;
  /** MIME type, e.g. `"application/pdf"`. */
  contentType: string | null;
  /**
   * Resolved {@link linkModeToName} name — `"imported_file"`, `"imported_url"`,
   * `"linked_file"`, `"linked_url"`, or `"embedded_image"`; `"unknown"` when
   * the raw mode is null or unrecognized.
   */
  linkMode: string;
  /** Zotero deep link to open this attachment in the reader (`zotero://open/...`). */
  backlink: string;
  /** Absolute on-disk path to the attachment file; `null` for URL links, an unset base directory, or an unparseable path. Computed at the app layer. */
  filePath: string | null;
  /**
   * Markdown link to the on-disk attachment file. In Liquid it renders on
   * plain access (`{{ a.fileLink }}`); pipe the attachment itself through the
   * `file_link` filter to override the alias or subpath. In Eta call it —
   * `<%= a.fileLink() %>` — passing `alias` to override the display text
   * (defaults to the filename) and `subpath` to append a `#`-fragment. `null`
   * when the file is unresolvable. See {@link FallibleTemplateLink}. Computed
   * at the app layer.
   */
  fileLink: FallibleTemplateLink;
}

/**
 * Map a DB {@link Attachment} to its template shape. `filePath` / `fileLink`
 * are omitted — they depend on vault/storage resolution held by the
 * Obsidian-side service.
 */
export function attachmentToTemplateData(
  attachment: Attachment,
): Omit<TemplateAttachment, "filePath" | "fileLink"> {
  return {
    key: attachment.key,
    filename: attachmentFilename(
      parseAttachmentPath(attachment.path, attachment.linkMode),
    ),
    contentType: emptyToNull(attachment.contentType),
    linkMode:
      attachment.linkMode == null
        ? "unknown"
        : linkModeToName(attachment.linkMode),
    backlink: attachmentOpenUri(attachment.key, attachment.groupID),
  };
}

/**
 * Apply after `filePath` and `fileLink` are attached because a spread drops
 * the non-enumerable string form.
 */
export function withAttachmentPreview(
  attachment: TemplateAttachment,
): TemplateAttachment {
  return defineToString(attachment, function () {
    return this.filename ?? this.key;
  });
}

/** Assemble an {@link Attachment} into its full template shape: base data plus
 *  the app-layer `filePath`/`fileLink` resolvers, with the preview attached.
 *  The single seam both the note and annotation paths call. */
export function resolveTemplateAttachment(
  attachment: Attachment,
  resolvers: {
    filePath: (attachment: Attachment) => string | null;
    fileLink: (attachment: Attachment) => FallibleTemplateLink;
  },
): TemplateAttachment {
  return withAttachmentPreview({
    ...attachmentToTemplateData(attachment),
    filePath: resolvers.filePath(attachment),
    fileLink: resolvers.fileLink(attachment),
  });
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
