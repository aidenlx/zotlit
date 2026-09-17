// Showing a native `Menu` under the control that opened it.
//
// Obsidian anchors its own button menus — the view header's "More options", the
// ribbon's overflow, the PDF toolbar — with `setParentElement` plus a
// `showAtPosition` built from the button's rect, never with `showAtMouseEvent`.
// Verified against Obsidian 1.14.2's `ViewHeader.onMoreOptions`; every member
// used here is public API.
import type { Menu } from "obsidian";

/**
 * Which of the trigger's edges the menu lines up with. A control on the right
 * of its row takes `end`, so the menu grows inward; one on the left takes
 * `start`, which is what Obsidian's own left-hand PDF toolbar uses.
 */
export type MenuAlign = "start" | "end";

/**
 * What `setParentElement` puts on the trigger while its menu stands. Obsidian's
 * own themes style it, and its own view-header trigger reads it to tell a
 * reopen from a toggle.
 */
const ACTIVE_MENU_CLASS = "has-active-menu";

/**
 * A box to hang a menu under, plus the window to open it in — for a trigger
 * that is gone by the time the menu shows.
 */
export interface MenuAnchor {
  /** The trigger's box, read while it was still laid out. */
  rect: DOMRectReadOnly;
  /**
   * The trigger's own window. `showAtPosition` falls back to the focused window
   * without it, which is not necessarily the one the menu belongs in.
   */
  doc?: Document;
}

/**
 * Open `menu` under the box in `anchor`, 2px below it, aligned to the named
 * edge — the same geometry {@link showMenuAtButton} uses.
 *
 * For a trigger that cannot be measured at show time. Obsidian's own file-menu
 * item nulls `currentTarget` at the first `await`, so an async handler reads
 * the box while dispatch is still live and passes it here. Nothing marks the
 * trigger or folds a second press into a toggle, because there is no trigger
 * left to press.
 */
export function showMenuAtBox(
  menu: Menu,
  anchor: MenuAnchor,
  align: MenuAlign = "start",
): void {
  placeMenu(menu, anchor, align);
}

/**
 * Open `menu` under `trigger`, 2px below it, aligned to the named edge.
 *
 * Anchoring to the element rather than to a pointer is what makes the menu land
 * correctly when the trigger is activated from the keyboard: a click synthesised
 * that way carries `clientX`/`clientY` of `0`, which `showAtMouseEvent` would
 * read as the window's top-left corner.
 *
 * The trigger's own document is passed, so the menu opens in the window the
 * trigger lives in and a pop-out host needs no wiring of its own. Obsidian falls
 * back to `activeDocument` without it, which is the focused window rather than
 * necessarily this one.
 *
 * `setParentElement` also marks the trigger `has-active-menu` while the menu
 * stands, and drops the menu if the trigger goes away. That mark is what makes
 * a second press on the trigger a toggle rather than a reopen.
 *
 * @see apps/obsidian/policies/popout-windows.md
 * @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
 */
export function showMenuAtButton(
  menu: Menu,
  trigger: HTMLElement,
  align: MenuAlign = "start",
): void {
  // A second press on the trigger closes the menu rather than reopening it.
  // The press itself is what closes the open menu, so the handler that follows
  // would otherwise open it straight back up and the menu would never appear to
  // shut. Obsidian guards its own view-header trigger on this same class.
  if (trigger.hasClass(ACTIVE_MENU_CLASS)) return;
  menu.setParentElement(trigger);
  placeMenu(
    menu,
    { rect: trigger.getBoundingClientRect(), doc: trigger.doc },
    align,
  );
}

/** The one placement both anchoring paths read: the trigger's box, edge, and window. */
function placeMenu(menu: Menu, anchor: MenuAnchor, align: MenuAlign): void {
  const { rect } = anchor;
  menu.showAtPosition(
    {
      x: rect.x,
      y: rect.bottom,
      width: rect.width,
      overlap: true,
      left: align === "end",
    },
    anchor.doc,
  );
}
