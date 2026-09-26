// What the reader's two gesture modules both read off the surface: whether a
// point is on screen, where a client point falls on a page, whether the window
// holds a text selection, Zotero's palette, the ink widths and the text font
// sizes as a menu, and how a captured pointer is let go.
//
// Creation and selection ask the same questions of the same view, so the answer
// is written once here and neither can drift from the other.
import { Menu } from "obsidian";

import { buildColorMenu } from "@/lib/annotation-colors";
import * as m from "@/lib/i18n/generated/messages";
import { themeHook } from "@/lib/theme-hooks";

import type { PdfPoint } from "./geometry-edit";
import type { PageBox, Point } from "./hit-test";
import { pageUnitSize } from "./render";
import type { OverlayPageView } from "./render";
import { applyTransform, inverseTransform } from "./selection-capture";
import { INK_WIDTHS, TEXT_FONT_SIZES } from "./tools";
import type { InkWidth, TextFontSize } from "./tools";

/**
 * Whether a client point falls inside the view's own box. A view with no box at
 * all — a hidden leaf, a detached container — shows nothing, so nothing is on
 * its screen.
 */
export function onScreen(containerEl: HTMLElement, { x, y }: Point): boolean {
  const rect = containerEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * The page's padding box in client coordinates: the box its canvas, its text
 * layer and the mark overlay fill. The desktop reader draws a border round
 * every page (`--page-border`), and the border box would shift every point
 * read against it by that border's width.
 *
 * The border is one width on every side, so the top and left widths stand for
 * all four.
 */
export function pageContentBox(div: HTMLElement): {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
} {
  const rect = div.getBoundingClientRect();
  const { clientLeft: x, clientTop: y } = div;
  return {
    left: rect.left + x,
    top: rect.top + y,
    right: rect.right - x,
    bottom: rect.bottom - y,
    width: rect.width - 2 * x,
    height: rect.height - 2 * y,
  };
}

/**
 * Whether the reader holds no text selection of its own. A selection that
 * starts elsewhere — in the Mark Popup's comment editor, which hangs outside
 * the view, or in another pane — is not the page's. The reader opens in
 * pop-out windows, so the selection is read from the container's window rather
 * than the global one.
 *
 * @see apps/obsidian/policies/popout-windows.md
 */
export function selectionCollapsed(containerEl: HTMLElement): boolean {
  const selection = containerEl.win.getSelection();
  if (!selection || selection.isCollapsed) return true;
  return !containerEl.contains(selection.anchorNode);
}

/**
 * Zotero's eight colours as a menu, with the colour in hand checked.
 *
 * @param current the colour the menu opens over — an armed tool's, or the one a
 *   mark carries — which is the item that shows as checked.
 * @param onPick what a chosen swatch does: set the tool's colour, or write the
 *   mark's.
 */
export function colorMenu(
  current: string | null,
  onPick: (hex: string) => void,
): Menu {
  const menu = new Menu();
  buildColorMenu(menu, { colors: [current], onSelect: onPick });
  return menu;
}

/**
 * The ink tool's pen widths, added under the colours of its menu, with the
 * width in hand checked.
 */
export function addInkWidths(
  menu: Menu,
  current: InkWidth,
  onPick: (width: InkWidth) => void,
): void {
  menu.addSeparator();
  menu.addItem((item) =>
    item.setTitle(m.pdf_toolbar_ink_width()).setIsLabel(true),
  );
  for (const width of INK_WIDTHS) {
    menu.addItem((item) =>
      item
        .setTitle(m.pdf_toolbar_ink_width_step({ width: String(width) }))
        .setChecked(width === current)
        .onClick(() => onPick(width)),
    );
  }
}

/**
 * The text tool's font sizes, added under the colours of its menu, with the
 * size in hand checked.
 */
export function addTextFontSizes(
  menu: Menu,
  current: TextFontSize,
  onPick: (size: TextFontSize) => void,
): void {
  menu.addSeparator();
  menu.addItem((item) =>
    item.setTitle(m.pdf_toolbar_text_font_size()).setIsLabel(true),
  );
  for (const size of TEXT_FONT_SIZES) {
    menu.addItem((item) =>
      item
        .setTitle(m.pdf_toolbar_text_font_size_step({ size: String(size) }))
        .setChecked(size === current)
        .onClick(() => onPick(size)),
    );
  }
}

/** The page's padding box, beside the same page measured in its own units. */
export function pageBoxOf(page: OverlayPageView): PageBox {
  const rect = pageContentBox(page.div);
  const unit = pageUnitSize(page);
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    unitWidth: unit.width,
    unitHeight: unit.height,
  };
}

/**
 * The page as the overlay is laid out on it, which is what a drag has to track
 * to the pixel. The page's border widths are rounded to whole pixels, so the
 * box inside them can be a pixel off the overlay's; the page box stands in
 * while no overlay is drawn.
 */
export function drawnBoxOf(page: OverlayPageView): PageBox {
  const box = pageBoxOf(page);
  const overlay = page.div.querySelector(`.${themeHook.pdfAnnotationOverlay}`);
  if (!overlay) return box;
  const { left, top, width, height } = overlay.getBoundingClientRect();
  return { ...box, left, top, width, height };
}

/**
 * Where a client point falls on a page, in the page's own units, however far
 * outside the page a drag has carried it.
 */
export function unitsOf(box: PageBox, client: Point): Point {
  return {
    x: ((client.x - box.left) * box.unitWidth) / box.width,
    y: ((client.y - box.top) * box.unitHeight) / box.height,
  };
}

/**
 * A point in the page's own units as a PDF point: the viewport's transform,
 * read at scale 1 and inverted.
 */
export function pdfPointOf(page: OverlayPageView, { x, y }: Point): PdfPoint {
  const { transform, scale } = page.viewport;
  return applyTransform(inverseTransform(transform)!, x * scale, y * scale);
}

/**
 * Where a client point falls on a page, in PDF points, however far outside the
 * page a drag has carried it.
 */
export function pdfPointAt(page: OverlayPageView, client: Point): PdfPoint {
  return pdfPointOf(page, unitsOf(drawnBoxOf(page), client));
}

/**
 * Lets go of the pointer a gesture captured on the container.
 *
 * @returns `null`, the hold the gesture keeps once it has let go.
 */
export function releaseCapture(
  containerEl: HTMLElement,
  held: { pointerId: number } | null,
): null {
  // A pointer the browser already took back — a cancel, a lost capture —
  // holds no capture to let go of.
  if (held && containerEl.hasPointerCapture(held.pointerId))
    containerEl.releasePointerCapture(held.pointerId);
  return null;
}
