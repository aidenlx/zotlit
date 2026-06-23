import { customAlphabet } from "nanoid";

/** Alphanumeric only, `_` and `-` reserved. */
const suffixNanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
);

import { hasSuffixMarker, replaceSuffixMarkers } from "@zotlit/templates";

import * as m from "@/paraglide/messages";

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

/**
 * Normalize a single path segment into a safe Obsidian file/folder name:
 * replace forbidden characters with `_`, strip trailing dots/spaces, and
 * prefix Windows reserved names. Returns `""` for a degenerate segment
 * (empty, `.`, `..`, or all dots/spaces).
 */
export function normalizeFilename(input: string): string {
  let result = input.replace(FORBIDDEN_CHARS, "_").replace(/[. ]+$/, "");
  if (WINDOWS_RESERVED.test(result)) result = `_${result}`;
  return result;
}

/**
 * Resolve a rendered filename template into a vault-relative path (no `.md`
 * extension), routing `/`-separated segments into nested subfolders.
 *
 * The last segment is the filename; preceding segments are folders. Degenerate
 * folder segments (empty / `.` / `..`) are dropped, so no `..` traversal is
 * honored. Every segment is sanitized per {@link normalizeFilename}.
 *
 * @throws {@link EmptyFilenameError} when the filename slot sanitizes to empty.
 */
export function resolveNoteRelPath(rendered: string): string {
  const segments = rendered.split("/");
  const rawName = segments.pop() ?? "";
  const filename = normalizeFilename(rawName);
  if (filename === "") throw new EmptyFilenameError();

  const folders = segments
    .map((segment) => normalizeFilename(segment))
    .filter((segment) => segment !== "");
  return [...folders, filename].join("/");
}

/** @see {@link resolveAvailableRelPath} */
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
export function resolveAvailableRelPath(
  rendered: string,
  exists: (rel: string) => boolean,
  forceSuffix = false,
): string {
  const baseRel = resolveNoteRelPath(replaceSuffixMarkers(rendered, () => ""));
  if (!hasSuffixMarker(rendered) || (!forceSuffix && !exists(baseRel))) {
    return baseRel;
  }

  for (let attempt = 0; attempt < MAX_SUFFIX_ATTEMPTS; attempt++) {
    const candidate = resolveNoteRelPath(
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
