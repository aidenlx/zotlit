// Best-effort key-value parse of Zotero's free-text Extra field.
import { regex } from "arkregex";

import { defineToString } from "./to-string";

/**
 * One source row of an Extra field, in document order: a parsed pair (`key`
 * plus trimmed `value`) or a non-pair text/blank row (`key: null`). `raw` is the
 * verbatim line so interleaved prose is never dropped.
 *
 * A non-enumerable `toString` returns `raw`, same mechanism as {@link ItemExtra}.
 */
export type ExtraLine = (
  | { readonly raw: string; readonly key: string; readonly value: string }
  | { readonly raw: string; readonly key: null }
) & { toString(): string };

/**
 * Best-effort structured view of Zotero's `extra` field. Plain data so it is
 * directly indexable in Liquid, Eta, and JS.
 *
 * - `raw` — verbatim original, full round-trip.
 * - `fields` — first value per key; the common-case lookup.
 * - `lines` — every source row in order; the source of truth `fields` derives
 *   from. Scan it to recover every value of a repeated key.
 *
 * A non-enumerable `toString` returns the stored `raw` — never a reconstruction
 * from pairs — so bare interpolation prints the field text and the Template Data
 * Explorer shows a raw preview.
 *
 * @see docs/adr/0007-item-extra-is-plain-data-not-urlsearchparams.md
 */
export interface ItemExtra {
  readonly raw: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly lines: readonly ExtraLine[];
  toString(): string;
}

function toRaw(this: { raw: string }): string {
  return this.raw;
}

const LINE_RE = /\r?\n/;

/**
 * A line is a pair when it matches, on the first `:` or `=`, a key that starts
 * with a letter and otherwise contains only letters, digits, spaces, dots,
 * hyphens, or underscores. The value keeps any later `:` / `=`.
 */
const PAIR_RE = regex("^(?<key>[A-Za-z][\\w .-]*?)\\s*[:=]\\s*(?<value>.+)$");

/**
 * @returns `null` for nullish / empty / whitespace-only input, matching
 * `parseItemDate` / `parseItemLanguage`.
 */
export function parseItemExtra(
  raw: string | null | undefined,
): ItemExtra | null {
  if (!raw?.trim()) return null;

  const lines: ExtraLine[] = [];
  const fields = Object.create(null) as Record<string, string>;

  for (const line of raw.split(LINE_RE)) {
    const match = PAIR_RE.exec(line);
    const value = match?.groups.value.trim();
    if (match && value) {
      const key = match.groups.key.trim();
      lines.push(defineToString<ExtraLine>({ raw: line, key, value }, toRaw));
      fields[key] ??= value;
    } else {
      lines.push(defineToString<ExtraLine>({ raw: line, key: null }, toRaw));
    }
  }

  return defineToString<ItemExtra>({ raw, fields, lines }, toRaw);
}
