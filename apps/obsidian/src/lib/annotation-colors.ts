// Zotero's annotation palette: the eight swatches its reader offers, the name
// each one goes by wherever ZotLit shows a colour, and the one menu every
// surface that recolours opens.

import type { Menu } from "obsidian";

import { annotationColorToName } from "@zotlit/db";
import type { AnnotationColorName } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";

/**
 * The eight colours Zotero's reader offers, in its own order, so a swatch list
 * and the `1`–`8` keys name the same colour in ZotLit as in Zotero.
 *
 * Lower case because that is the form a write carries: Zotero matches
 * `annotationColor` against a case-sensitive lower-case hex rule.
 *
 * @see https://github.com/zotero/reader/blob/9375b4f2bb89b4187adcb6eca209119a1dedf81a/src/common/defines.js#L2-L11
 */
export const ANNOTATION_COLORS: readonly string[] = [
  "#ffd400",
  "#ff6666",
  "#5fb236",
  "#2ea8e5",
  "#a28ae5",
  "#e56eee",
  "#f19837",
  "#aaaaaa",
];

const COLOR_MESSAGE: Record<AnnotationColorName, () => string> = {
  yellow: m.annot_view_color_yellow,
  red: m.annot_view_color_red,
  green: m.annot_view_color_green,
  blue: m.annot_view_color_blue,
  purple: m.annot_view_color_purple,
  magenta: m.annot_view_color_magenta,
  orange: m.annot_view_color_orange,
  gray: m.annot_view_color_gray,
  plum: m.annot_view_color_plum,
};

/**
 * The colour's own name, falling back to the raw hex for one outside Zotero's
 * reader and importer palettes — a colour carried in from another tool.
 */
export function annotationColorLabel(hex: string): string {
  const name = annotationColorToName(hex);
  return name ? COLOR_MESSAGE[name]() : hex;
}

/**
 * Whether a stored colour is one swatch, whatever case it was stored in: the
 * database and the two importers disagree on case, and a swatch list has to
 * mark the colour a record already carries.
 */
export function isColor(stored: string | null, swatch: string): boolean {
  return stored !== null && stored.toLowerCase() === swatch.toLowerCase();
}

/**
 * The swatches to offer, `count` at most: the recently used ones first, most
 * recent first, then the rest of the palette in Zotero's own order. A colour
 * outside the palette is not offered.
 *
 * @param recent the colours used last, most recent first, in any case.
 */
export function offeredSwatches(
  recent: readonly string[],
  count: number,
): readonly string[] {
  const used = recent.flatMap((color) =>
    ANNOTATION_COLORS.filter((hex) => isColor(color, hex)),
  );
  return [...new Set([...used, ...ANNOTATION_COLORS])].slice(0, count);
}

/**
 * The recent list after one more use: that colour first, each colour once,
 * never longer than the palette.
 */
export function withRecentColor(
  recent: readonly string[],
  color: string,
): string[] {
  return [color, ...recent.filter((stored) => !isColor(stored, color))].slice(
    0,
    ANNOTATION_COLORS.length,
  );
}

export interface ColorMenuInput {
  /** The colour in hand, in whatever case it was stored; that entry shows checked. */
  color: string | null;
  onSelect: (hex: string) => void;
}

/**
 * Zotero's eight swatches as menu entries. Each title is a fragment, so the
 * colour itself stands beside its name the way an Annotation card's own dot
 * does — `setTitle` takes a `DocumentFragment`, so this needs nothing private.
 *
 * Written once here because every surface that recolours — the Annotation
 * View's card, the reader's mark popup, the reader's creation toolbar — offers
 * the same palette, and none of them may drift from the others.
 */
export function buildColorMenu(
  menu: Menu,
  { color, onSelect }: ColorMenuInput,
): void {
  for (const hex of ANNOTATION_COLORS) {
    menu.addItem((item) =>
      item
        .setTitle(swatchTitle(hex))
        .setChecked(isColor(color, hex))
        .onClick(() => onSelect(hex)),
    );
  }
}

function swatchTitle(hex: string): DocumentFragment {
  return createFragment((frag) => {
    const row = frag.createSpan({
      cls: "zt:inline-flex zt:items-center zt:gap-2",
    });
    row.createSpan({
      cls: "zt:size-3 zt:shrink-0 zt:rounded-full zt:ring-1 zt:ring-border",
      attr: { style: `background-color: ${hex}` },
    });
    row.createSpan({ text: annotationColorLabel(hex) });
  });
}
