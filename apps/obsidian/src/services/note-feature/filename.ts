import { customAlphabet } from "nanoid";

import { hasSuffixMarker, replaceSuffixMarkers } from "@zotlit/templates";

import * as m from "@/paraglide/messages";

/** Alphanumeric only, `_` and `-` reserved. */
const suffixNanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
);

/** A random alphanumeric id of `size` chars (the {@link suffixNanoid} alphabet). */
export function randomFilenameId(size: number): string {
  return suffixNanoid(size);
}

/**
 * Characters Obsidian forbids in a file name. Beyond the platform-agnostic
 * `\ / :` and Windows `* ? " < > |`, the path doubles as a wikilink /
 * frontmatter-link target, so `# ^ [ ]` are stripped too.
 */
const FORBIDDEN_CHARS = /[\\/:*?"<>|#^[\]]/g;

/** Windows reserved device names; an exact (case-insensitive) match is invalid. */
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * Thrown when the filename slot of a rendered template resolves to an empty or
 * degenerate name. Its message is a Paraglide user-message ready for surfacing.
 */
export class EmptyFilenameError extends Error {
  constructor() {
    super(m.notice_empty_filename());
    this.name = "EmptyFilenameError";
  }
}

/** Maximum bytes for a single filesystem path component (ext4, HFS+, NTFS). */
export const MAX_SEGMENT_BYTES = 255;

/**
 * Normalize a single path segment into a safe Obsidian file/folder name:
 * replace forbidden characters with `_`, strip leading dots and trailing
 * dots/spaces, and prefix Windows reserved names. Returns `""` for a
 * degenerate segment (empty, `.`, `..`, or all dots/spaces).
 */
export function normalizeFilename(input: string): string {
  let result = input
    .replace(FORBIDDEN_CHARS, "_")
    .replace(/[. ]+$/, "")
    .replace(/^\.+/, "");
  if (WINDOWS_RESERVED.test(result)) result = `_${result}`;
  return result;
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/**
 * Truncate `name` so its UTF-8 encoding fits within `maxBytes`, iterating by
 * code point so surrogate pairs are never split. Strips trailing dots/spaces
 * the cut may expose.
 */
export function truncateToByteLimit(name: string, maxBytes: number): string {
  let byteCount = 0;
  let endIndex = 0;
  for (const cp of name) {
    const cpBytes = utf8ByteLength(cp.codePointAt(0)!);
    if (byteCount + cpBytes > maxBytes) break;
    byteCount += cpBytes;
    endIndex += cp.length;
  }
  if (endIndex >= name.length) return name;
  return name.slice(0, endIndex).replace(/[. ]+$/, "");
}

/** UTF-8 byte cost of the `.md` extension the caller appends. */
const MD_EXT_BYTES = 3;

/**
 * Resolve a rendered filename template into a vault-relative path (no `.md`
 * extension), routing `/`-separated segments into nested subfolders.
 *
 * The last segment is the filename; preceding segments are folders. Degenerate
 * folder segments (empty / `.` / `..`) are dropped, so no `..` traversal is
 * honored. Every segment is sanitized per {@link normalizeFilename} and
 * truncated to the filesystem byte limit ({@link MAX_SEGMENT_BYTES}).
 *
 * @throws {@link EmptyFilenameError} when the filename slot sanitizes to empty.
 */
export function resolveNoteRelPath(rendered: string): string {
  const segments = rendered.split("/");
  const rawName = segments.pop() ?? "";
  const filename = truncateToByteLimit(
    normalizeFilename(rawName),
    MAX_SEGMENT_BYTES - MD_EXT_BYTES,
  );
  if (filename === "") throw new EmptyFilenameError();

  const folders = segments
    .map((segment) =>
      truncateToByteLimit(normalizeFilename(segment), MAX_SEGMENT_BYTES),
    )
    .filter((segment) => segment !== "");
  return [...folders, filename].join("/");
}

/** @see {@link resolveFreeNotePath} */
const MAX_SUFFIX_ATTEMPTS = 5;

/**
 * The returned path has no `.md` extension. On a collision, each `suffix()`
 * marker is filled with a random alphanumeric id; without a marker the
 * rendered path is returned as-is regardless of collisions.
 *
 * @param exists the caller folds in the folder prefix + `.md` extension the
 *   vault check expects.
 * @param forceSuffix always fill the marker, even when the base name is free —
 *   a marker-free `rendered` still returns the base name.
 * @throws {@link EmptyFilenameError} when the rendered filename is empty.
 * @throws when no free name is found within {@link MAX_SUFFIX_ATTEMPTS}.
 */
export function resolveFreeNotePath(
  rendered: string,
  exists: (rel: string) => boolean,
  forceSuffix = false,
): string {
  return resolveAvailable(rendered, exists, {
    resolve: resolveNoteRelPath,
    forceSuffix,
  });
}

/**
 * Resolve a rendered name into a free *flat* file name: the whole rendered
 * string is one segment, so `/` (and every other forbidden character) collapses
 * to `_` instead of routing into subfolders. Suffix-marker collision retry is
 * identical to {@link resolveFreeNotePath}.
 *
 * @throws {@link EmptyFilenameError} when the name sanitizes to empty.
 */
export function resolveFreeFlatName(
  rendered: string,
  exists: (rel: string) => boolean,
): string {
  return resolveAvailable(rendered, exists, { resolve: resolveFlatName });
}

/** Single-segment counterpart to {@link resolveNoteRelPath} — never splits. */
function resolveFlatName(rendered: string): string {
  const name = truncateToByteLimit(
    normalizeFilename(rendered),
    MAX_SEGMENT_BYTES - MD_EXT_BYTES,
  );
  if (name === "") throw new EmptyFilenameError();
  return name;
}

/**
 * Fill `rendered`'s `suffix()` markers into a free name, retrying on collision.
 * `resolve` maps each filled candidate to its final relative form — the only
 * difference between the lit-note ({@link resolveNoteRelPath}, subfolder-routed)
 * and imported-note ({@link resolveFlatName}, single-segment) callers.
 */
function resolveAvailable(
  rendered: string,
  exists: (rel: string) => boolean,
  opts: { resolve: (rendered: string) => string; forceSuffix?: boolean },
): string {
  const { resolve, forceSuffix = false } = opts;
  const baseRel = resolve(replaceSuffixMarkers(rendered, () => ""));
  if (!hasSuffixMarker(rendered) || (!forceSuffix && !exists(baseRel))) {
    return baseRel;
  }

  for (let attempt = 0; attempt < MAX_SUFFIX_ATTEMPTS; attempt++) {
    const candidate = resolve(
      replaceSuffixMarkers(
        rendered,
        ({ length, prepend, append }) =>
          `${prepend}${suffixNanoid(length)}${append}`,
      ),
    );
    if (!exists(candidate)) return candidate;
  }
  throw new Error(
    `Could not find an available filename for "${baseRel}" after ${MAX_SUFFIX_ATTEMPTS} suffix attempts`,
  );
}
