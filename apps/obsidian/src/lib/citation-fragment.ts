// Citation Fragment parsing and Citation Display Text derivation for wikilinks.

import { citekeyToken, scanCitations } from "./citation-grammar";
import type { TextSpan } from "./citation-grammar";

/** The three Pandoc citation modes a Citation Fragment can request. */
export type CitationMode = "normal" | "author-in-text" | "suppress-author";

/** The locator labels citeproc parses out of a Citation suffix. */
export type CitationLocatorLabel =
  | "book"
  | "chapter"
  | "column"
  | "figure"
  | "folio"
  | "issue"
  | "line"
  | "note"
  | "opus"
  | "page"
  | "paragraph"
  | "part"
  | "section"
  | "sub-verbo"
  | "verse"
  | "volume";

/** The five named parameters of a Citation Fragment, all percent-decoded. */
export interface CitationFragment {
  mode: CitationMode;
  prefix: string | null;
  label: CitationLocatorLabel | null;
  locator: string | null;
  suffix: string | null;
}

export type CitationFragmentParseResult =
  | { ok: true; details: CitationFragment }
  | { ok: false; reason: string };

/**
 * Parse the text after `#cite:` into its Citation details. Strict, matching
 * the Lua filter's fatal-error conditions one for one: every defect the
 * exporter would reject comes back as the same reason string, so a consumer
 * can render raw instead of guessing.
 *
 * @see apps/obsidian/src/services/pandoc/filter/zotlit-cite.lua — `parse_fragment`
 */
export function parseCitationFragment(
  fragment: string,
): CitationFragmentParseResult {
  if (fragment === "") {
    return { ok: false, reason: "the Citation Fragment is empty" };
  }

  // A parameter is recorded only once it passes every value check, so a
  // recorded name is exactly the filter's `seen` marker.
  const values: Partial<Record<CitationFragmentParameter, string>> = {};

  for (const pair of fragment.split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      return { ok: false, reason: `"${pair}" is missing its "="` };
    }
    const name = pair.slice(0, eq);
    if (name === "") {
      return { ok: false, reason: `"${pair}" has an empty parameter name` };
    }
    if (!isParameter(name)) {
      return {
        ok: false,
        reason: `"${name}" is not a Citation Fragment parameter`,
      };
    }
    if (values[name] !== undefined) {
      return { ok: false, reason: `"${name}" appears more than once` };
    }

    const decoded = decodeValue(pair.slice(eq + 1));
    if (!decoded.ok) {
      return { ok: false, reason: `"${name}" has ${decoded.reason}` };
    }
    const defect = textDefect(decoded.value);
    if (defect) {
      return { ok: false, reason: `"${name}" has ${defect}` };
    }
    values[name] = decoded.value;
  }

  const { mode = "normal", prefix, label, locator, suffix } = values;
  if (!isMode(mode)) {
    return { ok: false, reason: `"mode" does not support "${mode}"` };
  }
  if (label !== undefined && !isLocatorLabel(label)) {
    return { ok: false, reason: `"label" does not support "${label}"` };
  }
  if (label !== undefined && locator === undefined) {
    return { ok: false, reason: `"label" needs a "locator"` };
  }
  if (mode === "author-in-text" && prefix !== undefined) {
    return {
      ok: false,
      reason:
        '"prefix" does not combine with mode=author-in-text; keep the introduction outside the link',
    };
  }
  return {
    ok: true,
    details: {
      mode,
      prefix: prefix ?? null,
      label: label ?? null,
      locator: locator ?? null,
      suffix: suffix ?? null,
    },
  };
}

type CitationFragmentParameter = keyof CitationFragment;

// Keyed on the unions rather than listed, so widening either one fails to
// compile until the accepted set grows with it.
const PARAMETERS: Readonly<Record<CitationFragmentParameter, true>> = {
  mode: true,
  prefix: true,
  label: true,
  locator: true,
  suffix: true,
};
const MODES: Readonly<Record<CitationMode, true>> = {
  normal: true,
  "author-in-text": true,
  "suppress-author": true,
};

function isParameter(name: string): name is CitationFragmentParameter {
  return Object.hasOwn(PARAMETERS, name);
}

function isMode(value: string): value is CitationMode {
  return Object.hasOwn(MODES, value);
}

function isLocatorLabel(value: string): value is CitationLocatorLabel {
  return Object.hasOwn(LOCATOR_LABEL_SHORT, value);
}

type DecodeResult =
  | { ok: true; value: string }
  | {
      ok: false;
      reason: "malformed percent encoding" | "invalid UTF-8 after decoding";
    };

/**
 * Percent-decode one fragment value byte-wise, then require valid UTF-8 —
 * the same decode-then-validate order as the Lua filter's `decode_value`, so
 * `%zz`, a bare `%`, and `%FF`/`%C3` each fail where the exporter fails.
 */
function decodeValue(raw: string): DecodeResult {
  const bytes = new TextEncoder().encode(raw);
  const decoded: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!;
    if (byte !== PERCENT) {
      decoded.push(byte);
      continue;
    }
    const hi = bytes[index + 1];
    const lo = bytes[index + 2];
    if (
      hi === undefined ||
      lo === undefined ||
      !isHexDigit(hi) ||
      !isHexDigit(lo)
    ) {
      return { ok: false, reason: "malformed percent encoding" };
    }
    decoded.push(hexValue(hi) * 16 + hexValue(lo));
    index += 2;
  }
  try {
    return {
      ok: true,
      value: new TextDecoder("utf-8", { fatal: true }).decode(
        new Uint8Array(decoded),
      ),
    };
  } catch {
    return { ok: false, reason: "invalid UTF-8 after decoding" };
  }
}

const PERCENT = 0x25;

function isHexDigit(byte: number): boolean {
  return (
    (byte >= 0x30 && byte <= 0x39) ||
    (byte >= 0x41 && byte <= 0x46) ||
    (byte >= 0x61 && byte <= 0x66)
  );
}

function hexValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  return byte - 0x61 + 10;
}

/**
 * Check order mirrors the Lua filter's `text_defect`, defect for defect, and
 * every class runs over the value's UTF-8 bytes, because Lua's `%s` and `%c`
 * are byte classes rather than codepoint classes. The consequences are not
 * intuitive: a trailing `a-grave` (0xC3 0xA0) is trailing whitespace to the
 * exporter while a leading one is not, and a euro sign (0xE2 0x82 0xAC) or a
 * Han character (0xE6 0xB1 0x89) carries a control byte.
 */
function textDefect(value: string): string | null {
  if (value === "") return "an empty value";
  const bytes = new TextEncoder().encode(value);
  if (isSpaceByte(bytes[0]!) || isSpaceByte(bytes.at(-1)!)) {
    return "leading or trailing whitespace";
  }
  if (bytes.some((byte) => byte === 0x0a || byte === 0x0d)) {
    return "a line break";
  }
  if (bytes.some(isControlByte)) return "a control character";
  return null;
}

/** Lua's `%s` under the UTF-8 locales the filter runs in: the C0 spaces, space, 0xA0. */
function isSpaceByte(byte: number): boolean {
  return (byte >= 0x09 && byte <= 0x0d) || byte === 0x20 || byte === 0xa0;
}

/** Lua's `%c` under the same locales: the C0 controls, DEL, and the C1 bytes. */
function isControlByte(byte: number): boolean {
  return byte <= 0x1f || byte === 0x7f || (byte >= 0x80 && byte <= 0x9f);
}

/** The resolved Literature Note plus the raw fragment a wikilink carries. */
export interface CitationDisplaySource {
  /**
   * The Item's native Zotero citation key, from the Citation Index's
   * resolution snapshot, or `null`/`""` when the Item carries none — the
   * display falls back to the note's filename.
   */
  citationKey: string | null;
  /** The note's vault path; only its basename without extension is used. */
  notePath: string;
  /**
   * The raw text after `#cite:` (the fragment parameters), or `null` when the
   * link carries no Citation Fragment. A non-`cite:` subpath is the caller's
   * to leave alone.
   */
  fragment: string | null;
}

/** The Citation one wikilink writes, and the text it shows on its own. */
export interface CitationDisplay {
  item: CitationRunItem;
  /**
   * The Citation Display Text: `@` plus the Item's native Zotero citation key
   * from the resolution snapshot, falling back to `@` plus the note's
   * filename, never the folder path, and a Citation Fragment as the
   * equivalent Pandoc citation source text.
   *
   * A fragment-less link keeps the bare `@citekey` here while
   * {@link citationRunSource} writes it as the parenthetical `[@citekey]` the
   * exporter produces: this is the text shown until a render lands, and the
   * exporter's own form only once one has.
   */
  text: string;
}

/**
 * The Citation a resolved Literature Note and the fragment naming it write.
 *
 * @returns null for anything the exporter would reject, so a caller shows raw
 *   text rather than a guess.
 */
export function citationDisplay(
  source: CitationDisplaySource,
): CitationDisplay | null {
  const citekey =
    source.citationKey || basenameWithoutExtension(source.notePath);
  if (source.fragment === null) {
    return {
      item: { citekey, details: NORMAL_CITATION },
      text: `@${citekey}`,
    };
  }
  const parsed = parseCitationFragment(source.fragment);
  if (!parsed.ok) return null;
  const item = { citekey, details: parsed.details };
  return { item, text: citationRunSource([item]).source };
}

/** A fragment-less wikilink, which is a normal-mode Citation of its note. */
const NORMAL_CITATION: CitationFragment = {
  mode: "normal",
  prefix: null,
  label: null,
  locator: null,
  suffix: null,
};

/** One work a Citation names, with the details it names that work under. */
export interface CitationRunItem {
  /** The citekey the Pandoc source names the work by. */
  citekey: string;
  details: CitationFragment;
}

/** One `@citekey` of a citation, at its offset within the citation's own source. */
export interface CitationKey extends TextSpan {
  citekey: string;
}

/** One citation as source text, with the keys it names located in it. */
export interface CitationSource {
  /** The citation exactly as a note writes it, or as a derivation writes it. */
  source: string;
  keys: CitationKey[];
}

/**
 * The Pandoc source text a standalone Citation or a whole Citation Run is
 * written as — the very text the equivalent Citation Cluster carries, so both
 * citing syntaxes reach one render and read alike.
 *
 * A run of several works is one bracketed cluster, which is also the only form
 * the citekey syntax can write a group in: an author-in-text item keeps its
 * textual `@key [locator]` form only while it stands alone. That is where this
 * derivation and export part company — the Lua filter keeps the author-in-text
 * mode of a run's first item — and it parts company on purpose: parity with the
 * equivalent Citation Cluster is what a reader compares the two syntaxes by,
 * and no bracketed cluster can carry an author-in-text item.
 *
 * @see apps/obsidian/src/services/pandoc/filter/zotlit-cite.lua — `build_cite`
 *
 * @param items the works of one Citation, in the order the source names them.
 */
export function citationRunSource(
  items: readonly CitationRunItem[],
): CitationSource {
  const keys: CitationKey[] = [];
  const only = items.length === 1 ? items[0]! : null;
  if (only && only.details.mode === "author-in-text") {
    let source = citekeyToken(only.citekey);
    keys.push({ citekey: only.citekey, start: 0, end: source.length });
    const inside = joinParts([locatorText(only.details), only.details.suffix]);
    if (inside) source += ` [${inside}]`;
    return { source, keys };
  }

  let source = "[";
  for (const [position, { citekey, details }] of items.entries()) {
    if (position > 0) source += "; ";
    if (details.prefix) source += `${details.prefix} `;
    const start = source.length;
    // The suppression `-` belongs to the key it marks, which is what lets a
    // summary fallback take the whole token's place.
    if (details.mode === "suppress-author") source += "-";
    source += citekeyToken(citekey);
    keys.push({ citekey, start, end: source.length });
    const trailing = joinParts([locatorText(details), details.suffix]);
    if (trailing) source += `, ${trailing}`;
  }
  return { source: `${source}]`, keys };
}

/**
 * Whether a derived source is text the engine reads back as the citation it was
 * derived from.
 *
 * A derivation writes a citekey and a Citation Fragment's own prose into Pandoc
 * source, and neither is guaranteed to survive the trip: a Literature Note
 * filename standing in for an Item with no native citation key may hold a
 * space, which no Pandoc key carries, braced or not; and a prefix or suffix
 * may hold the `;` that ends an item. The shared grammar is the authority on
 * what Pandoc reads, so the check is a round trip through it — a citation
 * that starts where the derivation started and names the same keys in the
 * same order is one the engine will format as meant. Anything else stays out
 * of the render, and the Citation Display Text stands in its place.
 *
 * The span's end is left out: a standalone author-in-text Citation writes its
 * locator in a trailing bracket that the grammar reads as text of its own,
 * exactly as Pandoc's own reader takes it for the citation's suffix.
 */
export function isRenderableCitation({
  source,
  keys,
}: CitationSource): boolean {
  const scanned = scanCitations(source);
  const only = scanned.length === 1 ? scanned[0]! : null;
  if (only === null || only.start !== 0) return false;
  if (only.keys.length !== keys.length) return false;
  return only.keys.every(
    (key, at) =>
      key.citekey === keys[at]!.citekey && key.start === keys[at]!.start,
  );
}

/** `p. 4`, `chap. 2`, or nothing at all when the Citation names no locator. */
function locatorText(details: CitationFragment): string | null {
  if (!details.locator) return null;
  return `${LOCATOR_LABEL_SHORT[details.label ?? "page"]} ${details.locator}`;
}

function joinParts(parts: readonly (string | null)[]): string {
  return parts.filter((part) => part).join(", ");
}

function basenameWithoutExtension(path: string): string {
  const slash = path.lastIndexOf("/");
  const file = slash === -1 ? path : path.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

/**
 * The CSL short-form locator labels, English for now — the same abbreviations
 * Pandoc resolves against the en-US locale.
 *
 * @see https://github.com/citation-style-language/locales/blob/v0.0.97/locales-en-US.xml
 */
const LOCATOR_LABEL_SHORT: Readonly<Record<CitationLocatorLabel, string>> = {
  book: "bk.",
  chapter: "chap.",
  column: "col.",
  figure: "fig.",
  folio: "fol.",
  issue: "no.",
  line: "l.",
  note: "n.",
  opus: "op.",
  page: "p.",
  paragraph: "para.",
  part: "pt.",
  section: "sec.",
  "sub-verbo": "s.v.",
  verse: "v.",
  volume: "vol.",
};
