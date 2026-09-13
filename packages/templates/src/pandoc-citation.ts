// Complete formatting and scanning for ZotLit's supported Pandoc Citation source.

import { regex } from "arkregex";

const SIMPLE_KEY_SOURCE =
  "[\\p{L}\\p{N}_*](?:[\\p{L}\\p{N}_]|[:.#$%&+?<>~/-](?=[\\p{L}\\p{N}_])|[:/](?=/))*";

const CITEKEY = regex(
  `(?<![\\p{L}\\p{N}.])(?<suppress>-)?@(?:(?<key>${SIMPLE_KEY_SOURCE})|\\{)`,
  "gu",
);

const WHOLE_SIMPLE_KEY =
  /^[\p{L}\p{N}_*](?:[\p{L}\p{N}_]|[:.#$%&+?<>~/-](?=[\p{L}\p{N}_])|[:/](?=\/))*$/u;

export type PandocCitationMode =
  | "normal"
  | "author-in-text"
  | "suppress-author";

export type PandocCitationForm = "normal" | "prefer-author-in-text";

export interface PandocTextSpan {
  readonly start: number;
  readonly end: number;
}

export interface PandocLocator {
  readonly label: string;
  readonly value: string;
}

export interface PandocCitationItem {
  readonly citationKey: string | null;
  readonly prefix: string | null;
  readonly suffix: string | null;
  readonly locator: PandocLocator | null;
  readonly suppressAuthor: boolean;
}

export interface ScannedPandocCitationItem extends PandocTextSpan {
  readonly citationKey: string;
  readonly mode: PandocCitationMode;
  readonly suppressAuthor: boolean;
  readonly prefix: string | null;
  readonly suffix: string | null;
  readonly locator: PandocLocator | null;
}

export interface ScannedPandocCitation extends PandocTextSpan {
  readonly mode: PandocCitationMode;
  readonly items: readonly ScannedPandocCitationItem[];
}

export type PandocCitationErrorCode =
  | "invalid-input"
  | "unrepresentable-value"
  | "unsafe-affix"
  | "unsafe-locator"
  | "formatter-invariant";

export type PandocCitationProperty =
  | "items"
  | "form"
  | "citationKey"
  | "prefix"
  | "suffix"
  | "locator"
  | "locator.label"
  | "locator.value";

export class PandocCitationError extends Error {
  readonly code: PandocCitationErrorCode;
  readonly itemIndex: number | null;
  readonly property: PandocCitationProperty;

  constructor(
    code: PandocCitationErrorCode,
    message: string,
    {
      itemIndex = null,
      property,
      cause,
    }: {
      itemIndex?: number | null;
      property: PandocCitationProperty;
      cause?: unknown;
    },
  ) {
    super(message, { cause });
    this.name = "PandocCitationError";
    this.code = code;
    this.itemIndex = itemIndex;
    this.property = property;
  }
}

/**
 * @param items Citation Items in source order. Items with a null key are omitted.
 * @param form `normal`, or a preference that falls back when author-in-text
 *   syntax cannot preserve the first keyed item.
 * @returns one complete Citation, or an empty string when no keyed item remains.
 * @throws {PandocCitationError} for invalid input, unrepresentable values,
 *   unsafe source structure, or a formatter/scanner invariant failure.
 */
export function formatPandocCitation(
  items: readonly PandocCitationItem[],
  form: PandocCitationForm = "normal",
): string {
  assertFormatInput(items, form);
  const keyed = items.flatMap((item, itemIndex) =>
    item.citationKey === null ? [] : [{ item, itemIndex }],
  );
  if (keyed.length === 0) return "";
  for (const { item, itemIndex } of keyed) {
    assertSafeItemProperties(item, itemIndex);
  }
  const first = keyed[0]!;
  const authorInText =
    form === "prefer-author-in-text" &&
    first.item.prefix === null &&
    !first.item.suppressAuthor;
  const source = authorInText
    ? formatAuthorInText(first, keyed.slice(1))
    : `[${keyed
        .map(({ item, itemIndex }) => formatNormalItem(item, itemIndex))
        .join("; ")}]`;
  assertFormattedSource(source, keyed, authorInText);
  return source;
}

function assertFormatInput(
  items: readonly PandocCitationItem[],
  form: PandocCitationForm,
): void {
  if (form !== "normal" && form !== "prefer-author-in-text") {
    throw invalidInput(`Unknown Pandoc Citation form: ${String(form)}`, "form");
  }
  if (!Array.isArray(items)) {
    throw invalidInput("Pandoc Citation Items must be an array", "items");
  }
  for (const [itemIndex, item] of items.entries()) {
    if (
      typeof item !== "object" ||
      item === null ||
      (typeof item.citationKey !== "string" && item.citationKey !== null) ||
      (typeof item.prefix !== "string" && item.prefix !== null) ||
      (typeof item.suffix !== "string" && item.suffix !== null) ||
      typeof item.suppressAuthor !== "boolean" ||
      !isLocator(item.locator)
    ) {
      throw invalidInput(
        `Citation Item ${itemIndex + 1} has an invalid shape`,
        "items",
        itemIndex,
      );
    }
  }
}

function isLocator(value: unknown): value is PandocLocator | null {
  if (value === null) return true;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { label?: unknown }).label === "string" &&
    typeof (value as { value?: unknown }).value === "string"
  );
}

function invalidInput(
  message: string,
  property: "items" | "form",
  itemIndex: number | null = null,
): PandocCitationError {
  return new PandocCitationError("invalid-input", message, {
    itemIndex,
    property,
  });
}

function assertSafeItemProperties(
  item: PandocCitationItem,
  itemIndex: number,
): void {
  if (item.prefix !== null && !isSafeAffix(item.prefix, "prefix")) {
    throw unsafeAffix("prefix", itemIndex);
  }
  if (item.suffix !== null && !isSafeAffix(item.suffix, "suffix")) {
    throw unsafeAffix("suffix", itemIndex);
  }
  if (item.locator === null) return;
  const { label, value } = item.locator;
  if (label === "" || /\s/u.test(label)) {
    throw unsafeLocator("locator.label", itemIndex);
  }
  if (value === "" || /[\r\n]/u.test(value)) {
    throw unsafeLocator("locator.value", itemIndex);
  }
  const [labelProbe] = scanPandocCitations(`[@probe, {${label} value}]`);
  if (labelProbe?.items[0]?.locator?.label !== label) {
    throw unsafeLocator("locator.label", itemIndex);
  }
  const [valueProbe] = scanPandocCitations(`[@probe, {p. ${value}}]`);
  if (valueProbe?.items[0]?.locator?.value !== value) {
    throw unsafeLocator("locator.value", itemIndex);
  }
}

function isSafeAffix(value: string, property: "prefix" | "suffix"): boolean {
  const source =
    property === "prefix" ? `[${value}@probe]` : `[@probe${value}]`;
  const [citation] = scanPandocCitations(source);
  const item = citation?.items[0];
  return (
    citation !== undefined &&
    citation.start === 0 &&
    citation.end === source.length &&
    citation.items.length === 1 &&
    (property === "prefix" ? item?.prefix : item?.suffix) ===
      (value === "" ? null : value)
  );
}

function unsafeAffix(
  property: "prefix" | "suffix",
  itemIndex: number,
): PandocCitationError {
  return new PandocCitationError(
    "unsafe-affix",
    `Citation Item ${itemIndex + 1} has a ${property} that changes Citation structure`,
    { itemIndex, property },
  );
}

function unsafeLocator(
  property: "locator.label" | "locator.value",
  itemIndex: number,
): PandocCitationError {
  return new PandocCitationError(
    "unsafe-locator",
    `Citation Item ${itemIndex + 1} has a ${property} Pandoc cannot preserve`,
    { itemIndex, property },
  );
}

function assertFormattedSource(
  source: string,
  keyed: readonly { item: PandocCitationItem; itemIndex: number }[],
  authorInText: boolean,
): void {
  const [citation, ...extra] = scanPandocCitations(source);
  const expectedMode = authorInText ? "author-in-text" : "normal";
  const complete =
    citation !== undefined &&
    extra.length === 0 &&
    citation.start === 0 &&
    citation.end === source.length &&
    citation.mode === expectedMode &&
    citation.items.length === keyed.length;
  const itemsMatch =
    complete &&
    citation.items.every((actual, position) => {
      const expected = keyed[position]!.item;
      const mode =
        authorInText && position === 0
          ? "author-in-text"
          : expected.suppressAuthor
            ? "suppress-author"
            : "normal";
      return (
        actual.citationKey === expected.citationKey &&
        actual.mode === mode &&
        actual.suppressAuthor === expected.suppressAuthor &&
        actual.prefix === (expected.prefix || null) &&
        actual.suffix === (expected.suffix || null) &&
        sameLocator(actual.locator, expected.locator)
      );
    });
  if (itemsMatch) return;

  const affected = keyed.find(
    ({ item }) => item.prefix !== null || item.suffix !== null,
  );
  if (affected?.item.prefix !== null && affected?.item.prefix !== undefined) {
    throw unsafeAffix("prefix", affected.itemIndex);
  }
  if (affected?.item.suffix !== null && affected?.item.suffix !== undefined) {
    throw unsafeAffix("suffix", affected.itemIndex);
  }
  throw new PandocCitationError(
    "formatter-invariant",
    "Formatted Pandoc Citation did not round-trip through the shared scanner",
    { property: "items" },
  );
}

function sameLocator(
  actual: PandocLocator | null,
  expected: PandocLocator | null,
): boolean {
  return (
    actual === expected ||
    (actual !== null &&
      expected !== null &&
      actual.label === expected.label &&
      actual.value === expected.value)
  );
}

function formatAuthorInText(
  first: { item: PandocCitationItem; itemIndex: number },
  later: readonly { item: PandocCitationItem; itemIndex: number }[],
): string {
  const key = encodeKey(first.item.citationKey!, first.itemIndex);
  const firstTrailing = `${authorLocatorSource(first.item.locator)}${
    first.item.suffix ?? ""
  }`;
  const laterItems = later.map(({ item, itemIndex }) =>
    formatNormalItem(item, itemIndex),
  );
  const trailing = [firstTrailing, ...laterItems]
    .filter((part) => part !== "")
    .join("; ");
  return trailing === "" ? key : `${key} [${trailing}]`;
}

function formatNormalItem(item: PandocCitationItem, itemIndex: number): string {
  return `${item.prefix ?? ""}${item.suppressAuthor ? "-" : ""}${encodeKey(
    item.citationKey!,
    itemIndex,
  )}${locatorSource(item.locator)}${item.suffix ?? ""}`;
}

function encodeKey(citationKey: string, itemIndex: number): string {
  if (citationKey === "" || /\s/u.test(citationKey)) {
    throw unrepresentableKey(citationKey, itemIndex);
  }
  if (WHOLE_SIMPLE_KEY.test(citationKey)) return `@${citationKey}`;
  if (!hasBalancedBraces(citationKey)) {
    throw unrepresentableKey(citationKey, itemIndex);
  }
  return `@{${citationKey}}`;
}

function unrepresentableKey(
  citationKey: string,
  itemIndex: number,
): PandocCitationError {
  return new PandocCitationError(
    "unrepresentable-value",
    `Citation Item ${itemIndex + 1} has a citation key Pandoc cannot represent: ${JSON.stringify(citationKey)}`,
    { itemIndex, property: "citationKey" },
  );
}

function hasBalancedBraces(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === "{") depth += 1;
    if (char === "}" && (depth -= 1) < 0) return false;
  }
  return depth === 0;
}

function locatorSource(locator: PandocLocator | null): string {
  return locator === null ? "" : `, {${locator.label} ${locator.value}}`;
}

function authorLocatorSource(locator: PandocLocator | null): string {
  return locator === null ? "" : `{${locator.label} ${locator.value}}`;
}

/**
 * @param source Markdown source to scan for supported single-line Citations.
 * @returns Citations in source order. All spans are half-open UTF-16 offsets
 *   into `source`.
 */
export function scanPandocCitations(source: string): ScannedPandocCitation[] {
  const keys = scanCitationKeys(source);
  const citations = scanNormalCitations(source, keys);
  const claimedKeyStarts = new Set(
    citations.flatMap((citation) => citation.items.map((item) => item.start)),
  );
  for (const key of keys) {
    if (claimedKeyStarts.has(key.start)) continue;
    const citation = key.suppressAuthor
      ? standaloneCitation(key, "suppress-author")
      : (readAuthorInTextCitation(source, key, { keys, claimedKeyStarts }) ??
        standaloneCitation(key, "author-in-text"));
    citations.push(citation);
    for (const item of citation.items) claimedKeyStarts.add(item.start);
  }
  return citations.sort((a, b) => a.start - b.start);
}

interface ScannedKey extends PandocTextSpan {
  readonly citationKey: string;
  readonly suppressAuthor: boolean;
}

function scanCitationKeys(source: string): ScannedKey[] {
  const exclusions = [
    ...noteReferenceSpans(source),
    ...codeSpanSpans(source),
    ...linkedBracketSpans(source),
  ];
  const found: ScannedKey[] = [];
  CITEKEY.lastIndex = 0;
  for (let match = CITEKEY.exec(source); match; match = CITEKEY.exec(source)) {
    const { suppress, key } = match.groups;
    const start = match.index;
    const keyStart = start + (suppress ? 2 : 1);
    if (key !== undefined) {
      found.push({
        citationKey: key,
        start,
        end: keyStart + key.length,
        suppressAuthor: Boolean(suppress),
      });
      continue;
    }
    const balanced = readBalanced(source, keyStart, {
      rejectWhitespace: true,
    });
    if (balanced === null) {
      CITEKEY.lastIndex = keyStart;
      continue;
    }
    found.push({
      citationKey: source.slice(keyStart + 1, balanced - 1),
      start,
      end: balanced,
      suppressAuthor: Boolean(suppress),
    });
    CITEKEY.lastIndex = balanced;
  }
  return found.filter(
    (key) =>
      !exclusions.some(
        ({ start, end }) => key.start >= start && key.start < end,
      ),
  );
}

function scanNormalCitations(
  source: string,
  keys: readonly ScannedKey[],
): ScannedPandocCitation[] {
  const citations: ScannedPandocCitation[] = [];
  for (
    let open = source.indexOf("[");
    open >= 0;
    open = source.indexOf("[", open + 1)
  ) {
    if (
      keys.some(
        (key) =>
          !key.suppressAuthor &&
          key.end < open &&
          /^[ \t]+$/u.test(source.slice(key.end, open)),
      )
    ) {
      continue;
    }
    const bounds = opensInlineNote(source, open)
      ? null
      : readBracket(source, open);
    if (bounds === null || opensTrailer(source, bounds.end)) continue;
    const items = parseKeyedSegments(source, {
      contentStart: bounds.contentStart,
      contentEnd: bounds.contentEnd,
      separators: bounds.separators,
      keys,
    });
    if (items === null) continue;
    citations.push({
      start: open,
      end: bounds.end,
      mode: "normal",
      items,
    });
    open = bounds.end - 1;
  }
  return citations;
}

function standaloneCitation(
  key: ScannedKey,
  mode: "author-in-text" | "suppress-author",
): ScannedPandocCitation {
  return {
    start: key.start,
    end: key.end,
    mode,
    items: [
      sourceItem(key, {
        mode,
        prefix: null,
        suffix: null,
        locator: null,
      }),
    ],
  };
}

function readAuthorInTextCitation(
  source: string,
  firstKey: ScannedKey,
  {
    keys,
    claimedKeyStarts,
  }: {
    keys: readonly ScannedKey[];
    claimedKeyStarts: ReadonlySet<number>;
  },
): ScannedPandocCitation | null {
  let open = firstKey.end;
  while (source[open] === " " || source[open] === "\t") open += 1;
  if (open === firstKey.end || source[open] !== "[") return null;
  const bounds = readBracket(source, open);
  if (bounds === null || opensTrailer(source, bounds.end)) return null;

  const bracketKeys = keys.filter(
    (key) =>
      key.start >= bounds.contentStart &&
      key.end <= bounds.contentEnd &&
      !claimedKeyStarts.has(key.start),
  );
  const segmentBounds = segmentRanges(bounds);
  const firstKeyedSegment = segmentBounds.findIndex(({ from, to }) =>
    bracketKeys.some((key) => key.start >= from && key.end <= to),
  );
  const firstTrailingEnd =
    firstKeyedSegment < 0
      ? bounds.contentEnd
      : firstKeyedSegment === 0
        ? bounds.contentStart
        : segmentBounds[firstKeyedSegment - 1]!.to;
  const firstTrailing = parseTrailing(source, {
    from: bounds.contentStart,
    to: firstTrailingEnd,
    authorInText: true,
  });
  if (firstTrailing === null) return null;

  const laterFrom =
    firstKeyedSegment < 0
      ? bounds.contentEnd
      : segmentBounds[firstKeyedSegment]!.from;
  const laterContentStart =
    source[laterFrom] === " " || source[laterFrom] === "\t"
      ? laterFrom + 1
      : laterFrom;
  const laterSeparators = bounds.separators.filter(
    (separator) => separator >= laterFrom,
  );
  const later =
    firstKeyedSegment < 0
      ? []
      : parseKeyedSegments(source, {
          contentStart: laterContentStart,
          contentEnd: bounds.contentEnd,
          separators: laterSeparators,
          keys: bracketKeys,
        });
  if (later === null) return null;
  return {
    start: firstKey.start,
    end: bounds.end,
    mode: "author-in-text",
    items: [
      sourceItem(firstKey, {
        mode: "author-in-text",
        prefix: null,
        suffix: firstTrailing.suffix,
        locator: firstTrailing.locator,
      }),
      ...later,
    ],
  };
}

function linkedBracketSpans(source: string): PandocTextSpan[] {
  const spans: PandocTextSpan[] = [];
  for (
    let open = source.indexOf("[");
    open >= 0;
    open = source.indexOf("[", open + 1)
  ) {
    const bounds = readBracket(source, open);
    if (bounds !== null && opensTrailer(source, bounds.end)) {
      spans.push({ start: open, end: bounds.end });
      open = bounds.end - 1;
    }
  }
  return spans;
}

interface BracketBounds {
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly end: number;
  readonly separators: readonly number[];
}

function readBracket(source: string, open: number): BracketBounds | null {
  const separators: number[] = [];
  let squareDepth = 1;
  for (let at = open + 1; at < source.length; at += 1) {
    const char = source[at]!;
    if (char === "\n" || char === "\r") return null;
    if (char === "`") {
      const end = readCodeSpan(source, at);
      if (end !== null) at = end - 1;
      continue;
    }
    if (char === "{" && source[at - 1] === "@") {
      const end = readBalanced(source, at, { rejectWhitespace: false });
      if (end !== null) at = end - 1;
      continue;
    }
    if (char === "[") {
      squareDepth += 1;
      continue;
    }
    if (char === "]" && (squareDepth -= 1) === 0) {
      return {
        contentStart: open + 1,
        contentEnd: at,
        end: at + 1,
        separators,
      };
    }
    if (char === ";" && squareDepth === 1) separators.push(at);
  }
  return null;
}

function segmentRanges({
  contentStart,
  contentEnd,
  separators,
}: BracketBounds): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  let from = contentStart;
  for (const to of [...separators, contentEnd]) {
    ranges.push({ from, to });
    from = to + 1;
  }
  return ranges;
}

function parseKeyedSegments(
  source: string,
  {
    contentStart,
    contentEnd,
    separators,
    keys,
  }: {
    contentStart: number;
    contentEnd: number;
    separators: readonly number[];
    keys: readonly ScannedKey[];
  },
): ScannedPandocCitationItem[] | null {
  const items: ScannedPandocCitationItem[] = [];
  let from = contentStart;
  for (const [position, to] of [...separators, contentEnd].entries()) {
    const segmentKeys = keys.filter(
      (key) => key.start >= from && key.end <= to,
    );
    if (segmentKeys.length !== 1) return null;
    const key = segmentKeys[0]!;
    let prefix = source.slice(from, key.start);
    if (position > 0 && (prefix[0] === " " || prefix[0] === "\t")) {
      prefix = prefix.slice(1);
    }
    const trailing = parseTrailing(source, {
      from: key.end,
      to,
      authorInText: false,
    });
    if (trailing === null) return null;
    items.push(
      sourceItem(key, {
        mode: key.suppressAuthor ? "suppress-author" : "normal",
        prefix: prefix === "" ? null : prefix,
        suffix: trailing.suffix,
        locator: trailing.locator,
      }),
    );
    from = to + 1;
  }
  return items;
}

function sourceItem(
  key: ScannedKey,
  {
    mode,
    prefix,
    suffix,
    locator,
  }: {
    mode: PandocCitationMode;
    prefix: string | null;
    suffix: string | null;
    locator: PandocLocator | null;
  },
): ScannedPandocCitationItem {
  return {
    ...key,
    mode,
    prefix,
    suffix,
    locator,
  };
}

function parseTrailing(
  source: string,
  {
    from,
    to,
    authorInText,
  }: { from: number; to: number; authorInText: boolean },
): { locator: PandocLocator | null; suffix: string | null } | null {
  const raw = source.slice(from, to);
  const locatorOpen = authorInText
    ? raw.startsWith("{")
      ? from
      : -1
    : raw.startsWith(", {")
      ? from + 2
      : -1;
  if (locatorOpen < 0) {
    return { locator: null, suffix: raw === "" ? null : raw };
  }
  const locatorEnd = readBalanced(source, locatorOpen, {
    rejectWhitespace: false,
  });
  if (locatorEnd === null || locatorEnd > to) return null;
  const locatorBody = source.slice(locatorOpen + 1, locatorEnd - 1);
  const split = locatorBody.indexOf(" ");
  if (split <= 0 || split === locatorBody.length - 1) return null;
  const suffix = source.slice(locatorEnd, to);
  return {
    locator: {
      label: locatorBody.slice(0, split),
      value: locatorBody.slice(split + 1),
    },
    suffix: suffix === "" ? null : suffix,
  };
}

function readBalanced(
  source: string,
  open: number,
  { rejectWhitespace }: { rejectWhitespace: boolean },
): number | null {
  let depth = 0;
  for (let at = open; at < source.length; at += 1) {
    const char = source[at]!;
    if (rejectWhitespace && /\s/u.test(char)) return null;
    if (char === "{") depth += 1;
    if (char === "}" && (depth -= 1) === 0) return at + 1;
  }
  return null;
}

function noteReferenceSpans(source: string): PandocTextSpan[] {
  const spans: PandocTextSpan[] = [];
  for (
    let open = source.indexOf("[^");
    open >= 0;
    open = source.indexOf("[^", open + 2)
  ) {
    for (let at = open + 2; at < source.length; at += 1) {
      const char = source[at]!;
      if (/\s|\^|\[/u.test(char)) break;
      if (char !== "]") continue;
      if (at > open + 2) spans.push({ start: open, end: at + 1 });
      break;
    }
  }
  return spans;
}

function codeSpanSpans(source: string): PandocTextSpan[] {
  const spans: PandocTextSpan[] = [];
  for (
    let open = source.indexOf("`");
    open >= 0;
    open = source.indexOf("`", open)
  ) {
    const end = readCodeSpan(source, open);
    if (end === null) {
      open += 1;
      continue;
    }
    spans.push({ start: open, end });
    open = end;
  }
  return spans;
}

function readCodeSpan(source: string, open: number): number | null {
  if (isBackslashEscaped(source, open)) return null;
  let content = open;
  while (source[content] === "`") content += 1;
  const ticks = content - open;
  for (let at = content; at < source.length; at += 1) {
    if (source[at] !== "`") continue;
    let end = at;
    while (source[end] === "`") end += 1;
    if (end - at === ticks) return end;
    at = end - 1;
  }
  return null;
}

function opensInlineNote(source: string, open: number): boolean {
  return source[open - 1] === "^" && !isBackslashEscaped(source, open - 1);
}

function isBackslashEscaped(source: string, at: number): boolean {
  let firstBackslash = at;
  while (source[firstBackslash - 1] === "\\") firstBackslash -= 1;
  return (at - firstBackslash) % 2 === 1;
}

const TRAILERS = { "(": ")", "[": "]", "{": "}" } as const;

function opensTrailer(source: string, at: number): boolean {
  const closer = TRAILERS[source[at] as keyof typeof TRAILERS];
  if (!closer) return false;
  const lineEnd = source.indexOf("\n", at);
  const closeAt = source.indexOf(closer, at + 1);
  return closeAt >= 0 && (lineEnd < 0 || closeAt < lineEnd);
}
