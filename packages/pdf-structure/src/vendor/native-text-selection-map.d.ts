// Hand-written types for the pinned `native-text-selection-map.js` copy, which
// ships as JS. Only the functions the port calls are declared.

import type { StructuredChar } from "@/chars";

/**
 * The text's NFKD code points with every whitespace one dropped: the units
 * both sides of the alignment are compared in.
 */
export declare function getNormalizedUnits(
  text: string | null | undefined,
): string[];

/**
 * For every boundary between DOM units, the boundary between reader units it
 * falls on. Index `i` is the boundary before DOM unit `i`; the array is one
 * longer than `domUnits`.
 */
export declare function alignTextUnits(
  domUnits: readonly string[],
  readerUnits: readonly string[],
): number[];

/**
 * The page's characters as reader units, with the character offset each unit
 * boundary stands for — `readerStartOffsets` for a selection's start,
 * `readerEndOffsets` for its end.
 */
export declare function buildReaderUnitMap(chars: readonly StructuredChar[]): {
  readerUnits: string[];
  readerStartOffsets: number[];
  readerEndOffsets: number[];
};

/**
 * Whether the DOM's selected text and the text the mapped range quotes agree,
 * whitespace and discretionary line-end hyphens aside.
 */
export declare function selectionTextMatches(
  selectionText: string,
  rangeText: string,
): boolean;
