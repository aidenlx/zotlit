// Narrows an Item's Attachments to the ones Obsidian's own PDF reader can host, and spells the path Obsidian opens each by.

import type { Attachment } from "@zotlit/db";
import {
  attachmentAbsPath,
  isCaseInsensitivePlatform,
  normalizeAbsolutePath,
} from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";

import { EXTERNAL_FILE_PREFIX } from "@/lib/constants";

/** One Attachment Obsidian's PDF view can host a Reader Session for. */
export interface ObsidianOpenableAttachment {
  /** The Attachment's Indexed Key. */
  indexedKey: string;
  /** Filename, for a picker row. */
  label: string;
  /** What Obsidian opens: a vault-relative path, or `file:`+absolute. */
  openPath: string;
  /** The real path on disk, for the existence check. */
  absolutePath: string;
  /**
   * Where inside the document to land, as Obsidian's own subpath — `#page=7`
   * and the rest of the grammar its PDF view reads off `eState.subpath`.
   * Absent opens the document at its start.
   */
  subpath?: string;
}

/** Case-insensitive fallback for a `linked_file` row Zotero leaves with no `contentType`. */
const PDF_EXTENSION_RE = /\.pdf$/i;

/**
 * Whether Obsidian's PDF view can host this Attachment — the rule that
 * separates an Obsidian-Openable Attachment from a Zotero-Openable one. Also
 * read by the Attachment path index, so one file gets one verdict.
 */
export function isPdfAttachment(
  contentType: string | null,
  absolutePath: string,
): boolean {
  return contentType !== null
    ? contentType === "application/pdf"
    : PDF_EXTENSION_RE.test(absolutePath);
}

/** Last segment of an absolute path, cut at either separator — a group library synced from another platform can carry that platform's flavor. */
export function filename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/**
 * The vault-relative path for `absolutePath`, or `null` when it lies outside
 * the vault. Containment is decided on case-folded forms per ADR 0035, but the
 * returned value is sliced from the un-folded normalised path — `fileMap`
 * holds the real casing, so a folded value would miss it. A separator is
 * required at the boundary so a merely string-prefixed sibling directory
 * (`Vaultastic` beside `Vault`) is not mistaken for containment.
 */
function vaultRelativePath(
  absolutePath: string,
  vaultBasePath: string,
  platform: NodeJS.Platform,
): string | null {
  const normalizedPath = normalizeAbsolutePath(absolutePath);
  const normalizedBase = normalizeAbsolutePath(vaultBasePath);
  const folds = isCaseInsensitivePlatform(platform);
  const foldedPath = folds ? normalizedPath.toLowerCase() : normalizedPath;
  const foldedBase = folds ? normalizedBase.toLowerCase() : normalizedBase;
  const prefix = `${foldedBase}/`;
  if (!foldedPath.startsWith(prefix)) return null;
  return normalizedPath.slice(prefix.length);
}

/**
 * Spells the path Obsidian opens `absolutePath` by: vault-relative when it
 * lies inside the vault (so `Vault.getFileByPath`'s `fileMap` lookup hits),
 * `file:`-prefixed absolute otherwise (Obsidian's external-file fall-through).
 *
 * @see apps/obsidian/docs/adr/0043-opening-an-attachment-in-obsidians-reader-carries-the-key-not-the-path.md
 */
export function obsidianOpenPath(
  absolutePath: string,
  vaultBasePath: string,
  platform: NodeJS.Platform,
): string {
  const relative = vaultRelativePath(absolutePath, vaultBasePath, platform);
  return relative ?? EXTERNAL_FILE_PREFIX + normalizeAbsolutePath(absolutePath);
}

/**
 * Narrow an Item's Attachments to the Obsidian-Openable ones: a PDF (by
 * `contentType`, falling back to a `.pdf` extension when Zotero left it
 * `null`) whose path resolves to a real file.
 */
export function toObsidianOpenableAttachments(
  attachments: readonly Attachment[],
  ctx: {
    pathContext: AttachmentPathContext;
    vaultBasePath: string;
    platform: NodeJS.Platform;
  },
): ObsidianOpenableAttachment[] {
  const openable: ObsidianOpenableAttachment[] = [];
  for (const attachment of attachments) {
    const absolutePath = attachmentAbsPath(attachment, ctx.pathContext);
    if (absolutePath === null) continue;
    if (!isPdfAttachment(attachment.contentType, absolutePath)) continue;
    openable.push({
      indexedKey: attachment.indexedKey,
      label: filename(absolutePath),
      openPath: obsidianOpenPath(absolutePath, ctx.vaultBasePath, ctx.platform),
      absolutePath,
    });
  }
  return openable;
}
