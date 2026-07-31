// Normalizes arbitrary text (typically a Zotero tag) into Obsidian tag format.

/**
 * Characters Obsidian rejects inside a tag, copied from its inline tag
 * tokenizer. Obsidian defines the tag alphabet as a blacklist, not an
 * allowlist, so everything outside these ranges — CJK ideographs and
 * punctuation, fullwidth forms, `©`, arrows, emoji — stays as written. An
 * allowlist built from the public help page ("alphabetical letters, numbers,
 * ... commonly accepted Unicode characters") would strip all of them.
 *
 * `\u2000-\u206F` is General Punctuation, which holds the zero-width joiner,
 * so a ZWJ emoji splits into its parts here exactly as it does in Obsidian.
 *
 * @see https://obsidian.md/help/tags#Tag+format
 */
const DISALLOWED =
  /[\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+/g;

/** Runs of `/`, which Obsidian tolerates but which nest a tag under a blank parent. */
const REPEATED_SLASH = /\/{2,}/g;

/** Separators left at the edges once disallowed runs became underscores. */
const EDGE_SEPARATORS = /^[_/]+|[_/]+$/g;

/** Obsidian rejects a tag whose whole body is ASCII digits: `#1984` is not a tag. */
const ALL_DIGITS = /^[0-9]+$/;

/**
 * Normalizes `name` into a valid Obsidian tag body, or `""` when nothing
 * survives. The leading `#` of a name such as `#todo` needs no special case:
 * `#` is disallowed, so it becomes an underscore that the edge trim removes.
 */
export function normalizeObsidianTag(name: string): string {
  const body = name
    .replace(DISALLOWED, "_")
    .replace(REPEATED_SLASH, "/")
    .replace(EDGE_SEPARATORS, "");
  return ALL_DIGITS.test(body) ? `_${body}` : body;
}
