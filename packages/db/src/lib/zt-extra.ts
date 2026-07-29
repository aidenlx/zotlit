// Best-effort key-value parse of Zotero's free-text Extra field.
import { regex } from "arkregex";

import { defineToString } from "./to-string";

/**
 * One source row of an Extra field, in document order: a parsed pair (`key`
 * plus trimmed `value`) or a non-pair text/blank row (`key: null`). `raw` is the
 * verbatim line so interleaved prose is never dropped.
 *
 * A line splits on its first `:` or `=`, and is a pair only when the key starts
 * with an ASCII letter and otherwise holds ASCII letters, digits, spaces, dots,
 * hyphens, or underscores. A line that does not match, and one whose value is
 * empty, becomes a text row.
 *
 * A non-enumerable `toString` returns `raw`, same mechanism as {@link ItemExtra}.
 */
export type ExtraLine = (
  | {
      /** Verbatim source line. */
      readonly raw: string;
      /** Parsed key, trimmed. */
      readonly key: string;
      /** Parsed value, trimmed; always non-empty on a pair row. */
      readonly value: string;
    }
  | {
      /** Verbatim source line. */
      readonly raw: string;
      /** Always `null` — prose, blank, and empty-value rows carry no key. */
      readonly key: null;
    }
) & {
  /** The line's `raw` text verbatim. */
  toString(): string;
};

/**
 * Best-effort structured view of Zotero's `extra` field. Plain data so it is
 * directly indexable in Liquid, Eta, and JS.
 *
 * `toString` is non-enumerable, so a spread, `JSON.stringify`, or
 * `Object.keys` sees the three data properties alone.
 *
 * @see docs/adr/0007-item-extra-is-plain-data-not-urlsearchparams.md
 */
export interface ItemExtra {
  /** Original field text verbatim, for a full round-trip. */
  readonly raw: string;
  /**
   * First value per key — the common-case lookup, e.g.
   * `zt.extra.fields["tex.mendeley-tags"]`. First-wins: a repeated key keeps
   * its first occurrence.
   */
  readonly fields: Readonly<Record<string, string>>;
  /**
   * Every source row in order, the source of truth {@link ItemExtra.fields}
   * derives from. Scan it to recover every value of a repeated key.
   */
  readonly lines: readonly ExtraLine[];
  /**
   * The stored {@link ItemExtra.raw} text — never a reconstruction from pairs
   * — so bare interpolation (`{{ zt.extra }}`) prints the field as the user
   * typed it and the Template Data Explorer shows a raw preview.
   */
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
