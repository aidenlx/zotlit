// What the reader's two gesture modules both read off the surface: where a menu
// opens under a control, whether a point is on screen, whether the window holds
// a text selection, and Zotero's palette as a menu.
//
// Creation and selection ask the same questions of the same view, so the answer
// is written once here and neither can drift from the other.
import { Menu } from "obsidian";

import { buildColorMenu } from "@/lib/annotation-colors";

import type { Point } from "./hit-test";

/** Under the control, which is where Obsidian opens a menu from a button. */
export function belowOf(node: HTMLElement): Point {
  const rect = node.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}

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
 * Whether the view's own window holds no text selection. The reader opens in
 * pop-out windows, so the selection is read from the container's window rather
 * than the global one.
 *
 * @see apps/obsidian/policies/popout-windows.md
 */
export function selectionCollapsed(containerEl: HTMLElement): boolean {
  return containerEl.win.getSelection()?.isCollapsed !== false;
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
  buildColorMenu(menu, { color: current, onSelect: onPick });
  return menu;
}
