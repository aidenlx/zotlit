// Hand-written types for the pinned `structure.js` copy, which ships as JS.

import type { StructuredChar, ZoteroChar } from "@/chars";

/**
 * Deduplicates a page's characters on `c` plus its rectangle, regroups them
 * into words, lines and paragraphs, and stamps each survivor with its `offset`
 * — the index a Sort Index carries.
 *
 * Mutates and returns the array it is given.
 */
export declare function getStructuredChars(
  chars: readonly ZoteroChar[],
): StructuredChar[];
