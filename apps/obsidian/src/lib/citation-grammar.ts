// Pandoc citation grammar: the shared recognizer for citekeys, braced keys, and bracketed clusters.

import { regex } from "arkregex";

/**
 * Key characters Pandoc's `regchar` accepts: `isAlphaNum` (Unicode letters and
 * numbers) plus `_`.
 */
const REG_CHAR = "[\\p{L}\\p{N}_]";

/**
 * Pandoc's `simpleCiteIdentifier`: a letter, digit, `_`, or the `@*` nocite
 * wildcard, then key characters, punctuation from `:.#$%&-+?<>~/` that is
 * *internal* (followed by another key character), and the URL exception where
 * `:` or `/` is kept when a `/` follows.
 *
 * @see https://github.com/jgm/pandoc/blob/3.10.1/src/Text/Pandoc/Parsing/Citations.hs
 */
const SIMPLE_KEY = `[\\p{L}\\p{N}_*](?:${REG_CHAR}|[:.#$%&+?<>~/-](?=${REG_CHAR})|[:/](?=/))*`;

/**
 * A citation `@` may not directly follow a `Str` inline, which Pandoc's
 * markdown reader builds from alphanumerics and non-repeated `.` — so
 * `a@b.com` and `x.@key` are text while `_@key` and `a-@key` are citations.
 * The optional `-` is Pandoc's author suppression, and it carries the same
 * guard: in `a-@key` the guard rejects the `-`, and the scan restarts at the
 * `@` as a plain author-in-text citation.
 *
 * @see https://github.com/jgm/pandoc/blob/3.10.1/src/Text/Pandoc/Parsing/Capabilities.hs — `notAfterString`
 * @see https://github.com/jgm/pandoc/blob/3.10.1/src/Text/Pandoc/Readers/Markdown.hs — `str`
 */
const CITEKEY_RE = regex(
  `(?<![\\p{L}\\p{N}.])(?<suppress>-)?@(?:(?<key>${SIMPLE_KEY})|\\{)`,
  "gu",
);

/** The closing delimiter of each construct that turns a `[...]` into something other than a citation. */
const TRAILERS = { "(": ")", "[": "]", "{": "}" } as const;

/** Characters Pandoc's `noteMarker` bars from a footnote label, `]` aside. */
const NOTE_LABEL_BREAK = /[\s^[]/u;

/** A half-open `[start, end)` character range. */
export interface TextSpan {
  start: number;
  end: number;
}

/** A `@citekey` occurrence, with the braces of a `@{...}` key already stripped. */
export interface CitekeySpan {
  citekey: string;
  /** Offset of the leading `@`, or of the `-` when the author is suppressed. */
  start: number;
  /** Offset just past the key — past the closing `}` for a braced key. */
  end: number;
  suppressAuthor: boolean;
}

/** One `;`-separated entry of a citation cluster. */
export interface CitationItem {
  key: CitekeySpan;
  prefix: TextSpan | null;
  suffix: TextSpan | null;
}

/** A bracketed citation cluster such as `[see @a, p. 3; @b]`. */
export interface CitationCluster extends TextSpan {
  items: CitationItem[];
}

/**
 * Recognition is Pandoc's, so an `@` in URL path position
 * (`https://example.com/@handle`) is a key here exactly as Pandoc reads it;
 * callers exclude those through their own gate — the editor's token classes or
 * the index's masking scanner.
 *
 * Two Pandoc rules stay out, both needing state a line-scoped scan does not
 * carry: an emphasis ender also blocks the `@` (`*foo*@key` is text to Pandoc,
 * a key here — while a lone `*@key` is a key to both), and Pandoc's smart
 * extension turns `--` into a dash before the author-suppression `-` is read.
 *
 * @returns every `@citekey` in `text`, in document order, including the keys
 *   inside citation clusters.
 */
export function scanCitekeys(text: string): CitekeySpan[] {
  const notes = noteRefSpans(text);
  const found: CitekeySpan[] = [];
  CITEKEY_RE.lastIndex = 0;
  for (
    let match = CITEKEY_RE.exec(text);
    match;
    match = CITEKEY_RE.exec(text)
  ) {
    const { suppress, key } = match.groups;
    const start = match.index;
    const keyStart = start + (suppress ? 2 : 1);
    if (key !== undefined) {
      found.push({
        citekey: key,
        start,
        end: keyStart + key.length,
        suppressAuthor: Boolean(suppress),
      });
      continue;
    }
    const balanced = readBalancedBraces(text, keyStart);
    if (!balanced) {
      // Not a key at all: resume just past the `@` so a later one still matches.
      CITEKEY_RE.lastIndex = keyStart;
      continue;
    }
    found.push({
      citekey: text.slice(keyStart + 1, balanced - 1),
      start,
      end: balanced,
      suppressAuthor: Boolean(suppress),
    });
    CITEKEY_RE.lastIndex = balanced;
  }
  return found.filter(
    (key) =>
      !notes.some(({ start, end }) => key.start >= start && key.end <= end),
  );
}

/**
 * Pandoc reads `[^label]` as a footnote reference before it ever tries a
 * citation, and an undefined label stays literal rather than becoming one. The
 * label bars whitespace, `^`, and `[`, so `[^see @key]` is no reference at all
 * and its `@key` still counts.
 *
 * @see https://github.com/jgm/pandoc/blob/3.10.1/src/Text/Pandoc/Readers/Markdown.hs — `noteMarker`
 */
function noteRefSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  for (
    let open = text.indexOf("[^");
    open >= 0;
    open = text.indexOf("[^", open + 2)
  ) {
    for (let at = open + 2; at < text.length; at += 1) {
      const char = text[at]!;
      if (NOTE_LABEL_BREAK.test(char)) break;
      if (char !== "]") continue;
      if (at > open + 2) spans.push({ start: open, end: at + 1 });
      break;
    }
  }
  return spans;
}

/**
 * A cluster holds one `;`-separated item per key, each with its optional prefix
 * and suffix. A bracket whose items do not all carry a key is no citation, and
 * neither is one that opens a link, a reference link, or a bracketed span.
 *
 * Two Pandoc groupings stay out. Clusters never span a line break, which Pandoc
 * allows and the editor does not. And a bracket that directly follows an
 * author-in-text key belongs to that citation for Pandoc — `@a [p. 3]` is one
 * citation with a suffix, and `@a [-@b; @c]` is one citation of three — while
 * here the key and the bracket stay separate.
 *
 * @returns every bracketed citation cluster in `text`, in document order.
 * @see https://github.com/jgm/pandoc/blob/3.10.1/src/Text/Pandoc/Readers/Markdown.hs — `normalCite`, `citeList`, `citation`, `bareloc`
 */
export function scanCitationClusters(text: string): CitationCluster[] {
  const keys = scanCitekeys(text);
  const clusters: CitationCluster[] = [];
  for (
    let open = text.indexOf("[");
    open >= 0;
    open = text.indexOf("[", open)
  ) {
    const cluster = readCluster(text, open, keys);
    if (!cluster) {
      open += 1;
      continue;
    }
    clusters.push(cluster);
    open = cluster.end;
  }
  return clusters;
}

/**
 * One citation as the source writes it, which is the unit a renderer formats:
 * a whole bracketed cluster, or a bare author-in-text key.
 */
export interface CitationSpan extends TextSpan {
  /** The keys this citation cites, in source order. */
  keys: CitekeySpan[];
}

/**
 * A bare key inside a cluster belongs to that cluster, so every key appears in
 * exactly one citation.
 *
 * @returns every citation in `text`, in document order.
 */
export function scanCitations(text: string): CitationSpan[] {
  const clusters = scanCitationClusters(text);
  const citations: CitationSpan[] = clusters.map(({ start, end, items }) => ({
    start,
    end,
    keys: items.map((item) => item.key),
  }));
  for (const key of scanCitekeys(text)) {
    const held = clusters.some(
      ({ start, end }) => key.start >= start && key.end <= end,
    );
    if (!held) citations.push({ start: key.start, end: key.end, keys: [key] });
  }
  return citations.sort((a, b) => a.start - b.start);
}

/** The simple key on its own, which is what a derived key must match whole. */
const WHOLE_SIMPLE_KEY = regex(`^${SIMPLE_KEY}$`, "u");

/**
 * `citekey` as the Pandoc source that names it: the bare `@key`, or the braced
 * `@{key}` for a key the simple form cannot carry — a Literature Note filename
 * standing in for an Item with no native citation key holds whatever the
 * filesystem allows.
 *
 * Braces are Pandoc's own escape hatch and take any non-space character, so a
 * key holding a space is beyond both forms and keeps the bare form, which at
 * least reads as the key the note carries. {@link scanCitekeys} reads such a
 * derivation back as a different key, which is how a caller finds out that no
 * engine will format it.
 */
export function citekeyToken(citekey: string): string {
  if (WHOLE_SIMPLE_KEY.test(citekey)) return `@${citekey}`;
  return /\s/u.test(citekey) ? `@${citekey}` : `@{${citekey}}`;
}

/**
 * Both span ends are inclusive, so a click on the leading `@` or on the
 * trailing key character still resolves.
 *
 * @returns the `@citekey` covering `offset`, or `null` when there is none.
 */
export function citekeyAt(text: string, offset: number): CitekeySpan | null {
  return (
    scanCitekeys(text).find(
      (key) => offset >= key.start && offset <= key.end,
    ) ?? null
  );
}

/**
 * Pandoc's braced key accepts any non-space character, so whitespace ends the
 * attempt.
 *
 * @returns offset just past the `}` that closes the braces opening at `open`,
 *   or `null` when they never balance.
 * @see https://github.com/jgm/pandoc/blob/3.10.1/src/Text/Pandoc/Parsing/General.hs — `charsInBalanced`
 */
function readBalancedBraces(text: string, open: number): number | null {
  let depth = 0;
  for (let at = open; at < text.length; at += 1) {
    const char = text[at]!;
    if (isSpace(char)) return null;
    if (char === "{") depth += 1;
    else if (char === "}" && (depth -= 1) === 0) return at + 1;
  }
  return null;
}

function readCluster(
  text: string,
  open: number,
  keys: readonly CitekeySpan[],
): CitationCluster | null {
  const separators: number[] = [];
  let close = -1;
  for (let at = open + 1; at < text.length && close < 0; at += 1) {
    const char = text[at]!;
    if (char === "\n" || char === "[") return null;
    // A braced key and an inline code span both hold `;` and `]` as content.
    if (char === "{" && text[at - 1] === "@") {
      at = (readBalancedBraces(text, at) ?? at + 1) - 1;
      continue;
    }
    if (char === "`") {
      const fenced = readCodeSpan(text, at);
      if (fenced) {
        at = fenced - 1;
        continue;
      }
    }
    if (char === "]") close = at;
    else if (char === ";") separators.push(at);
  }
  if (close < 0) return null;
  if (opensTrailer(text, close + 1)) return null;

  const items: CitationItem[] = [];
  let from = open + 1;
  for (const to of [...separators, close]) {
    const key = keys.find(
      (candidate) => candidate.start >= from && candidate.end <= to,
    );
    if (!key) return null;
    items.push({
      key,
      prefix: trimSpan(text, from, key.start),
      suffix: trimSpan(text, key.end, to),
    });
    from = to + 1;
  }
  return { start: open, end: close + 1, items };
}

/**
 * @returns offset just past the backtick run that closes the code span opening
 *   at `open`, or `null` when the run never closes on this line.
 */
function readCodeSpan(text: string, open: number): number | null {
  let content = open;
  while (text[content] === "`") content += 1;
  const ticks = content - open;
  for (let at = content; at < text.length; at += 1) {
    if (text[at] === "\n") return null;
    if (text[at] !== "`") continue;
    let runEnd = at;
    while (text[runEnd] === "`") runEnd += 1;
    if (runEnd - at === ticks) return runEnd;
    at = runEnd - 1;
  }
  return null;
}

/**
 * Whether `at` opens a link destination, a reference label, or an attribute
 * block — the constructs Pandoc looks ahead for to rule out a citation. Pandoc
 * parses each one whole, so a delimiter that never closes on the line leaves
 * the citation standing.
 */
function opensTrailer(text: string, at: number): boolean {
  const closer = TRAILERS[text[at] as keyof typeof TRAILERS];
  if (!closer) return false;
  const lineEnd = text.indexOf("\n", at);
  const closeAt = text.indexOf(closer, at + 1);
  return closeAt >= 0 && (lineEnd < 0 || closeAt < lineEnd);
}

/** @returns the `[from, to)` range with surrounding whitespace removed, or `null` when it is blank. */
function trimSpan(text: string, from: number, to: number): TextSpan | null {
  let start = from;
  let end = to;
  while (start < end && isSpace(text[start]!)) start += 1;
  while (end > start && isSpace(text[end - 1]!)) end -= 1;
  return end > start ? { start, end } : null;
}

function isSpace(char: string): boolean {
  return /\s/u.test(char);
}
