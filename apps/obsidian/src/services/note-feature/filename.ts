import { customAlphabet } from "nanoid";

import {
  hasSuffixMarker,
  replaceSuffixMarkers,
  resolveFlatNoteName,
  resolveNoteRelPath as resolveSharedNoteRelPath,
} from "@zotlit/templates";

import * as m from "@/lib/i18n/generated/messages";

/** Alphanumeric only, `_` and `-` reserved. */
const suffixNanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
);

/** A random alphanumeric id of `size` chars (the {@link suffixNanoid} alphabet). */
export function randomFilenameId(size: number): string {
  return suffixNanoid(size);
}

/**
 * Thrown when the filename slot of a rendered template resolves to an empty or
 * degenerate name. Its message is localized and ready for surfacing.
 */
export class EmptyFilenameError extends Error {
  constructor() {
    super(m.notice_empty_filename());
    this.name = "EmptyFilenameError";
  }
}

/**
 * Resolve a rendered Filename Template into a relative note path (no `.md`
 * extension) by the shared Note Path rule.
 *
 * @throws {@link EmptyFilenameError} when the filename slot sanitizes to empty.
 */
function resolveNoteRelPath(rendered: string): string {
  const rel = resolveSharedNoteRelPath(rendered);
  if (rel === null) throw new EmptyFilenameError();
  return rel;
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
  const name = resolveFlatNoteName(rendered);
  if (name === null) throw new EmptyFilenameError();
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
