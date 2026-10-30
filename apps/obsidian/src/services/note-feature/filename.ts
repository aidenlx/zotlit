import { customAlphabet } from "nanoid";

import {
  hasSuffixMarker,
  replaceSuffixMarkers,
  resolveFlatNoteName,
  resolveNoteRelPath,
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

/** How many random suffixes a free-name search tries after the base name. */
export const MAX_SUFFIX_ATTEMPTS = 5;

/**
 * Resolve a rendered name into a free *flat* file name: the whole rendered
 * string is one segment, so `/` (and every other forbidden character) collapses
 * to `_` instead of routing into subfolders. On a collision, each `suffix()`
 * marker is filled with a random alphanumeric id; without a marker the name is
 * returned as-is regardless of collisions.
 *
 * @throws {@link EmptyFilenameError} when the name sanitizes to empty.
 * @throws when no free name is found within {@link MAX_SUFFIX_ATTEMPTS}.
 */
export function resolveFreeFlatName(
  rendered: string,
  exists: (rel: string) => boolean,
): string {
  const base = baseNoteName(rendered, resolveFlatNoteName);
  if (!hasSuffixMarker(rendered) || !exists(base)) return base;
  for (let attempt = 0; attempt < MAX_SUFFIX_ATTEMPTS; attempt++) {
    const candidate = suffixedNoteName(rendered, resolveFlatNoteName);
    if (!exists(candidate)) return candidate;
  }
  throw noFreeName(base);
}

/**
 * The relative note path of `rendered` with its `suffix()` markers dropped,
 * with no `.md` extension: the first candidate of a free-path search, and the
 * deterministic name of a note no Item has yet.
 *
 * @throws {@link EmptyFilenameError} when the rendered filename is empty.
 */
export function baseNoteName(
  rendered: string,
  resolveName: (rendered: string) => string | null = resolveNoteRelPath,
): string {
  return resolvedName(
    replaceSuffixMarkers(rendered, () => ""),
    resolveName,
  );
}

/**
 * A later candidate of a free-path search: `rendered` with each `suffix()`
 * marker filled with a random alphanumeric id.
 *
 * @throws {@link EmptyFilenameError} when the rendered filename is empty.
 */
export function suffixedNoteName(
  rendered: string,
  resolveName: (rendered: string) => string | null = resolveNoteRelPath,
): string {
  return resolvedName(
    replaceSuffixMarkers(
      rendered,
      ({ length, prepend, append }) =>
        `${prepend}${suffixNanoid(length)}${append}`,
    ),
    resolveName,
  );
}

/** The error of a search whose every candidate collided. */
export function noFreeName(base: string): Error {
  return new Error(
    `Could not find an available filename for "${base}" after ${MAX_SUFFIX_ATTEMPTS} suffix attempts`,
  );
}

function resolvedName(
  filled: string,
  resolveName: (rendered: string) => string | null,
): string {
  const rel = resolveName(filled);
  if (rel === null) throw new EmptyFilenameError();
  return rel;
}
