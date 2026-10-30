// Brings Obsidian's per-glyph text content to parity with the character stream
// Zotero's PDF text structure is built from.

import { getStructuredChars } from "@/vendor/structure.js";

/** `[x1, y1, x2, y2]` in PDF page space. */
export type Rect = readonly [number, number, number, number];

/** One glyph of `page.getTextContent({ includeChars: true })` on Obsidian. */
export interface ObsidianGlyph {
  /** The glyph's Unicode, raw — Obsidian applies no normalisation. */
  readonly c: string;
  readonly u: string;
  /** The glyph's axis-aligned bounding rect, in PDF page space. */
  readonly r: Rect;
}

/** One item of `page.getTextContent({ includeChars: true })` on Obsidian. */
export interface ObsidianTextItem {
  readonly chars?: readonly ObsidianGlyph[];
  /** The chunk's text matrix, `[a, b, c, d, e, f]`. */
  readonly transform: readonly number[];
  readonly fontName: string;
}

/** A character in the shape Zotero's `structure.js` consumes. */
export interface ZoteroChar {
  c: string;
  u: string;
  rect: Rect;
  fontSize: number;
  fontName: string;
  /** Snapped to 0, 90, 180 or 270. */
  rotation: number;
  baseline: number;
}

/** A `ZoteroChar` after the line grouping ran over its page. */
export interface StructuredChar extends ZoteroChar {
  /** Index into the page's Structured Characters — what a Sort Index carries. */
  offset: number;
  /** `rect`, stretched to the height (or width) of its line. */
  inlineRect: Rect;
  /** Stamped by the caller, as Zotero's own provider does. */
  pageIndex?: number;
  spaceAfter?: boolean;
  wordBreakAfter?: boolean;
  lineBreakAfter?: boolean;
  paragraphBreakAfter?: boolean;
  ignorable?: boolean;
}

/**
 * Chunk-wide values Zotero derives per glyph from the current text transform.
 * Every glyph of one item shares them, because a chunk breaks when the
 * transform changes.
 *
 * @see https://github.com/zotero/pdf.js/blob/f57fc80d1c07e4cdc50a767ae0b500b5272123b4/src/core/evaluator.js#L3144-L3237
 */
export function itemMetrics(
  transform: readonly number[],
): Pick<ZoteroChar, "baseline" | "fontSize" | "rotation"> {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = transform;
  const rotation = closestStandardAngle(matrixToDegrees(a, b));
  return {
    // The distance between the transformed origin and the transformed unit
    // vector on the y axis, which is algebraically `hypot(c, d)`. Zotero adds
    // the translation to both points and subtracts it again, and floating
    // point makes that order visible in the last bits, so the port repeats it.
    fontSize: Math.hypot(e - (c + e), f - (d + f)),
    rotation,
    baseline: rotation === 90 || rotation === 270 ? e : f,
  };
}

function matrixToDegrees(a: number, b: number): number {
  let radians = Math.atan2(b, a);
  if (radians < 0) radians += 2 * Math.PI;
  return Math.round(radians * (180 / Math.PI)) % 360;
}

/** Nearest of 0/90/180/270 by plain distance, with no wrap-around. */
function closestStandardAngle(degrees: number): number {
  const standard = [0, 90, 180, 270];
  let closest = 0;
  let smallest = Number.POSITIVE_INFINITY;
  for (const angle of standard) {
    const difference = Math.abs(degrees - angle);
    if (difference < smallest) {
      smallest = difference;
      closest = angle;
    }
  }
  return closest;
}

/**
 * The 22 accented Latin letters Zotero puts back together after NFKD, keyed by
 * their decomposed form.
 */
const LATIN_RECOMPOSITIONS = new Map(
  [
    "\u00E9",
    "\u00E1",
    "\u00ED",
    "\u00F3",
    "\u00FA",
    "\u00E8",
    "\u00E0",
    "\u00EC",
    "\u00F2",
    "\u00F9",
    "\u00EA",
    "\u00E2",
    "\u00EE",
    "\u00F4",
    "\u00FB",
    "\u00EB",
    "\u00E4",
    "\u00EF",
    "\u00F6",
    "\u00FC",
    "\u00E7",
    "\u00F1",
  ].map((letter) => [letter.normalize("NFKD"), letter] as const),
);

/**
 * NFKD, so ligatures split, then Zotero's recomposition table, which puts the
 * common accented Latin letters back together. Plain NFKD is not enough: a
 * decomposed `è` would disagree with Zotero's `c` on every accented glyph.
 *
 * @see https://github.com/zotero/pdf.js/blob/f57fc80d1c07e4cdc50a767ae0b500b5272123b4/src/core/evaluator.js#L3245-L3281
 */
export function normalizeChar(char: string): string {
  const normalized = char.normalize("NFKD");
  return LATIN_RECOMPOSITIONS.get(normalized) ?? normalized;
}

/** ASCII and extended control characters, which Zotero never records. */
function isControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/**
 * The four filter rules that make an Obsidian glyph stream index-for-index
 * equal to Zotero's: drop space glyphs, drop control characters, normalise `c`,
 * keep `u` raw. Obsidian pushes spaces and keeps `c` raw; Zotero does neither,
 * and `offset` is an index, so one extra record misplaces every Annotation
 * after it on that page.
 *
 * Obsidian already skips a zero-font-size glyph, so that rule needs nothing
 * here.
 */
export function toZoteroChars(items: Iterable<ObsidianTextItem>): ZoteroChar[] {
  const chars: ZoteroChar[] = [];
  for (const item of items) {
    if (!item.chars?.length) continue;
    const { baseline, fontSize, rotation } = itemMetrics(item.transform);
    for (const glyph of item.chars) {
      if (glyph.c === " " || isControl(glyph.c.charCodeAt(0))) continue;
      chars.push({
        c: normalizeChar(glyph.c),
        u: glyph.u,
        // Copied, because the line grouping writes through the characters.
        rect: [...glyph.r],
        fontSize,
        fontName: item.fontName,
        rotation,
        baseline,
      });
    }
  }
  return chars;
}

/** One page's Structured Characters, with the page box the Sort Index needs. */
export interface StructuredPage {
  readonly pageIndex: number;
  /** `page.view` — the PDF page box. */
  readonly viewBox: Rect;
  readonly chars: readonly StructuredChar[];
}

/**
 * Runs the pinned line grouping over one page's glyphs and stamps each
 * character with its page, as Zotero's own provider does.
 */
export function structurePage(
  pageIndex: number,
  viewBox: Rect,
  items: Iterable<ObsidianTextItem>,
): StructuredPage {
  const chars = getStructuredChars(toZoteroChars(items));
  for (const char of chars) char.pageIndex = pageIndex;
  return { pageIndex, viewBox, chars };
}
