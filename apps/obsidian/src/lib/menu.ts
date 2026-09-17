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
 * stands, and drops the menu if the trigger goes away.
 *
 * @see apps/obsidian/policies/popout-windows.md
 * @see apps/obsidian/docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md
 */
export function showMenuAtButton(
  menu: Menu,
  trigger: HTMLElement,
  align: MenuAlign = "start",
): void {
  const rect = trigger.getBoundingClientRect();
  menu.setParentElement(trigger).showAtPosition(
    {
      x: rect.x,
      y: rect.bottom,
      width: rect.width,
      overlap: true,
      left: align === "end",
    },
    trigger.doc,
  );
}
