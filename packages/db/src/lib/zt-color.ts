import { regex } from "arkregex";

/**
 * Names for the colors that can occur in the `itemAnnotations.color` column,
 * keyed by canonical uppercase `#rrggbb`.
 *
 * Only two subsystems write that column: the reader, when a user picks a swatch,
 * and importers, which write hex directly. Tag colors never reach it — they are
 * a per-tag display overlay (`xpcom/annotations.js` sets `o.color` from the
 * stored value, not from `Zotero.Tags.getColors`) — so the tag-picker palette
 * (teal/indigo/plum/…) is deliberately absent.
 */
const ANNOTATION_COLOR_NAMES = {
  // Reader palette since Zotero 6 — the five swatches that predate the Z7 expansion.
  // @see https://github.com/zotero/reader/blob/4ebfe4b10fef885190ec3fe061f75c47cbfdc02f/src/lib/colors.js#L3-L9
  "#FFD400": "yellow",
  "#FF6666": "red",
  "#5FB236": "green",
  "#2EA8E5": "blue",
  "#A28AE5": "purple",
  // Added to the reader palette in Zotero 7 ("Add three more colors").
  // @see https://github.com/zotero/reader/blob/9375b4f2bb89b4187adcb6eca209119a1dedf81a/src/common/defines.js#L2-L11
  "#E56EEE": "magenta",
  "#F19837": "orange",
  "#AAAAAA": "gray",
  // Never offered by the reader; the Citavi importer is the lone writer of both
  // — pre-Z7 orange and plum (Zotero's SCSS `tag-plum`).
  // @see https://github.com/zotero/zotero/blob/451d96a8240bbb607a220f949673d6bc704bb58d/chrome/content/zotero/import/citavi.js#L117-L146
  "#FF8C19": "orange",
  "#A6507B": "plum",
} as const;

export type AnnotationColorName =
  (typeof ANNOTATION_COLOR_NAMES)[keyof typeof ANNOTATION_COLOR_NAMES];

/**
 * @param raw - the `itemAnnotations.color` value, a `#rrggbb` hex string.
 * @returns the palette name, or `null` for any color not in the reader/Citavi
 *   palette (e.g. an unmapped raw hex carried over by Mendeley import).
 */
export function annotationColorToName(
  raw: string | null | undefined,
): AnnotationColorName | null {
  if (!raw) return null;
  return (
    ANNOTATION_COLOR_NAMES[
      raw.toUpperCase() as keyof typeof ANNOTATION_COLOR_NAMES
    ] ?? null
  );
}

/**
 * Note-editor highlight (background) palette, keyed by canonical uppercase
 * `#rrggbb`. Distinct from {@link ANNOTATION_COLOR_NAMES}: these are the colors
 * the rich-text note editor writes as `background-color`. The eight base hues
 * happen to match the reader swatches, but Zotero serializes them at 50% opacity
 * (`#ffd40080`) since Zotero 6.
 *
 * The schema's `toDOM` emits `#rrggbbaa`, but Firefox normalizes the inline
 * `style` attribute when the editor reads `innerHTML` back out, so the on-disk
 * form is `rgba(255, 212, 0, 0.5)` — confirmed by Zotero's own export path,
 * which converts rgba back to rgb for word processors.
 * @see https://github.com/zotero/note-editor/blob/20ce6e9505512e27c965d96221e8ac634f3d99be/src/core/schema/marks.js#L127
 * @see https://github.com/zotero/note-editor/blob/20ce6e9505512e27c965d96221e8ac634f3d99be/src/core/schema/utils.js#L70
 * @see https://github.com/zotero/zotero/blob/451d96a8240bbb607a220f949673d6bc704bb58d/chrome/content/zotero/xpcom/data/notes.js#L388-L399
 */
const NOTE_HIGHLIGHT_COLOR_NAMES = {
  // Note-editor palette since Zotero 6 — the five that predate the Z7 expansion.
  // @see https://github.com/zotero/note-editor/blob/4ff5ba2793acb6c20891724d6f040d1911df53bf/src/core/schema/colors.js#L2-L8
  "#FFD400": "yellow",
  "#FF6666": "red",
  "#5FB236": "green",
  "#2EA8E5": "blue",
  "#A28AE5": "purple",
  // Added to the note-editor palette in Zotero 7 ("Add three more colors").
  // @see https://github.com/zotero/note-editor/blob/20ce6e9505512e27c965d96221e8ac634f3d99be/src/core/schema/colors.js#L13-L22
  "#F19837": "orange",
  "#E56EEE": "magenta",
  "#AAAAAA": "gray",
} as const;

/**
 * Note-editor text-color palette, keyed by canonical uppercase `#rrggbb`. A
 * separate, more-saturated set the editor writes as `color` (not
 * `background-color`), opaque — no alpha suffix.
 */
const NOTE_TEXT_COLOR_NAMES = {
  // Introduced in Zotero 7 alongside the text-color popup ("introduce text color popup").
  // @see https://github.com/zotero/note-editor/blob/20ce6e9505512e27c965d96221e8ac634f3d99be/src/core/schema/colors.js#L2-L11
  "#FF2020": "red",
  "#FF7700": "orange",
  "#FFCB00": "yellow",
  "#4EB31C": "green",
  "#7953E3": "purple",
  "#EB52F7": "magenta",
  "#05A2EF": "blue",
  "#7E8386": "gray",
} as const;

// The highlight and text palettes share the same eight names by design.
export type NoteHighlightColorName =
  (typeof NOTE_HIGHLIGHT_COLOR_NAMES)[keyof typeof NOTE_HIGHLIGHT_COLOR_NAMES];
export type NoteTextColorName =
  (typeof NOTE_TEXT_COLOR_NAMES)[keyof typeof NOTE_TEXT_COLOR_NAMES];

const RGB_FUNCTIONAL = regex(
  "^rgba?\\(\\s*(?<r>\\d+)[\\s,]+(?<g>\\d+)[\\s,]+(?<b>\\d+)",
  "i",
);

/**
 * Normalize a CSS color value pulled from a note's inline `style` attribute to
 * the canonical uppercase `#RRGGBB` key shared by the highlight/text palette
 * lookups. Drops any alpha channel — the palettes are keyed on hue alone.
 *
 * Accepts `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)`, and `rgba(r, g, b, a)` (with
 * either comma- or space-separated components, per modern CSS).
 */
function toCanonicalHex6(raw: string): string | null {
  if (raw.startsWith("#")) return raw.slice(0, 7).toUpperCase();
  const match = RGB_FUNCTIONAL.exec(raw);
  if (!match) return null;
  const { r, g, b } = match.groups;
  const hex = (n: string) =>
    Number(n).toString(16).padStart(2, "0").toUpperCase();
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * @param raw - a note highlight `background-color`. The on-disk form is
 *   `rgba(r, g, b, 0.5)` (Firefox-normalized from the editor's `#rrggbbaa`),
 *   but `#rrggbb`/`#rrggbbaa` are accepted for legacy/pre-normalized input.
 * @returns the palette name, or `null` for any color outside the palette.
 */
export function highlightColorToName(
  raw: string | null | undefined,
): NoteHighlightColorName | null {
  if (!raw) return null;
  const key = toCanonicalHex6(raw);
  if (!key) return null;
  return (
    NOTE_HIGHLIGHT_COLOR_NAMES[
      key as keyof typeof NOTE_HIGHLIGHT_COLOR_NAMES
    ] ?? null
  );
}

/**
 * @param raw - a note `color` (text color). The on-disk form is `rgb(r, g, b)`
 *   (Firefox-normalized from the editor's `#rrggbb`); hex is accepted too.
 * @returns the palette name, or `null` for any color outside the palette.
 */
export function textColorToName(
  raw: string | null | undefined,
): NoteTextColorName | null {
  if (!raw) return null;
  const key = toCanonicalHex6(raw);
  if (!key) return null;
  return (
    NOTE_TEXT_COLOR_NAMES[key as keyof typeof NOTE_TEXT_COLOR_NAMES] ?? null
  );
}
