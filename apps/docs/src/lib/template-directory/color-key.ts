// The color key of a Profile page: what each Zotero highlight color means in the notes the Profile makes.

import { regex } from "arkregex";

import { ZOTERO_COLORS } from "./samples.ts";
import type { ColorKey, ColorKeyRow } from "./site.ts";
import type { AnnotationSample } from "./verify.ts";

/**
 * A callout's first line: its type, an optional fold marker, and its title,
 * which ends before the last " · " that leads to the page link. A callout
 * with no title on its first line gets no match.
 */
const CALLOUT_TITLE = regex(
  "^> \\[![^\\]]+\\][-+]? (?<title>.*?)(?: · [^·]*)?$",
  "m",
);

/**
 * The key a Profile's own rendering gives its highlights, read from the
 * callout title each Zotero color gets: the nine Zotero colors, then the
 * title of any other color. Null when the highlights are not callouts, or
 * when every color gets the same title, so the key would tell nothing.
 * `changeWith` is the entry that explains how to change the meanings.
 */
export function colorKey(
  annotations: readonly AnnotationSample[],
  changeWith: string | null,
): ColorKey | null {
  const highlights = annotations.filter(({ type }) => type === "highlight");
  const titleOf = (found: AnnotationSample | undefined): string | null =>
    found?.output?.match(CALLOUT_TITLE)?.groups?.title?.trim() || null;
  const rows: ColorKeyRow[] = [];
  for (const { name, hex } of ZOTERO_COLORS) {
    const meaning = titleOf(
      highlights.find(
        ({ color }) => color !== null && "name" in color && color.name === name,
      ),
    );
    if (meaning === null) return null;
    rows.push({ color: name, hex, meaning });
  }
  const other = titleOf(
    highlights.find(({ color }) => color !== null && "hex" in color),
  );
  if (other !== null) rows.push({ color: null, hex: null, meaning: other });
  return new Set(rows.map(({ meaning }) => meaning)).size > 1
    ? { rows, changeWith }
    : null;
}
