import { join, posix } from "node:path";

import { annotationHasCacheImage } from "./zt-annot";
import type { AnnotationType, ResolvedAnnotationTypeName } from "./zt-annot";
import { parseAttachmentPath } from "./zt-attach";
import type { Attachment } from "./zt-attach";

// Re-exported so a consumer resolving an absolute path can also classify it —
// the Obsidian plugin's source-decision seam needs both.
export { parseAttachmentPath, type AttachmentPath } from "./zt-attach";

export interface AttachmentPathContext {
  /** Zotero data directory, for resolving `storage:` paths. */
  dataDir: string;
  /**
   * Zotero `baseAttachmentPath` pref, for resolving `attachments:` linked
   * paths; `null` when unset.
   */
  baseAttachmentPath: string | null;
}

export interface AnnotCachePathContext {
  /** Zotero data directory. */
  dataDir: string;
  /** Group library ID; `null` for the user library. */
  groupID: number | null;
}

/**
 * Absolute path to an annotation's rendered excerpt PNG, or `null` when the
 * annotation type has no cached image (everything but `image` and `ink`).
 * Mirrors Zotero's `getCacheImagePath`, joining the per-library cache dir
 * (`library` for the user library, `groups/<groupID>` otherwise) with
 * `<key>.png`, gated by the same `['image', 'ink']` rule Zotero uses to decide
 * whether a cache file exists at all.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/annotations.js#L46-L49
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/annotations.js#L62
 */
export function resolveAnnotCachePath(
  annotation: {
    key: string;
    type: AnnotationType | ResolvedAnnotationTypeName;
  },
  { dataDir, groupID }: AnnotCachePathContext,
): string | null {
  if (!annotationHasCacheImage(annotation.type)) return null;
  const libraryPath =
    groupID === null ? "library" : join("groups", String(groupID));
  return join(dataDir, "cache", libraryPath, `${annotation.key}.png`);
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
  const parsed = parseAttachmentPath(
    attachment.path,
    attachment.linkMode,
    attachment.key,
  );
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

const CASE_INSENSITIVE_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set([
  "darwin",
  "win32",
]);

/**
 * Whether the platform's filesystem compares paths without case, so one file
 * can be named in two casings — Zotero keeps a `linked_file` path as it was
 * typed, and both Obsidian and ZotLit derive their own from a base directory. A
 * Linux volume holds both casings as distinct files, so folding there could name
 * the wrong file.
 *
 * @see apps/obsidian/docs/adr/0035-the-attachment-resolver-case-folds-on-case-insensitive-platforms.md
 */
export function isCaseInsensitivePlatform(platform: NodeJS.Platform): boolean {
  return CASE_INSENSITIVE_PLATFORMS.has(platform);
}

/** Obsidian collapses every separator run to one `/` before it resolves the
 * absolute path behind a `file:` prefix; the key follows the same rule. */
const SEPARATOR_RUN_RE = /[\\/]+/g;
/** Keeps the lone separator of a root path, which carries no segment to trim. */
const TRAILING_SEPARATOR_RE = /(?<=.)\/+$/;

/**
 * The comparison key for an absolute attachment path: separators collapsed to
 * `/`, `.` and `..` segments resolved, no trailing separator, and case folded
 * where the filesystem itself folds. Both sides of a lookup go through it, so a
 * Zotero row and an Obsidian view path meet however each was written.
 *
 * @param platform the filesystem's platform, as `process.platform` names it.
 * @see apps/obsidian/docs/adr/0035-the-attachment-resolver-case-folds-on-case-insensitive-platforms.md
 */
export function attachmentPathKey(
  path: string,
  platform: NodeJS.Platform,
): string {
  const normalized = posix
    .normalize(path.replace(SEPARATOR_RUN_RE, "/"))
    .replace(TRAILING_SEPARATOR_RE, "");
  return isCaseInsensitivePlatform(platform)
    ? normalized.toLowerCase()
    : normalized;
}
