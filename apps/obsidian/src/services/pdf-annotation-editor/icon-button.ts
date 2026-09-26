// The one icon button the reader's vanilla surfaces are built from: the
// Creation Toolbar's tools and the Editing Capability affordance. The Mark
// Popup draws the same button in Preact.
//
// Obsidian's `clickable-icon` is a div, so the button's role, its keyboard
// activation, and the blocked state that keeps its seat are ZotLit's to state —
// stated here once, rather than by each surface in its own words.
//
// @see apps/obsidian/policies/tooltips.md
// @see apps/obsidian/docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md
import { setIcon, setTooltip } from "obsidian";
import type { IconName } from "obsidian";

import { onActivateKey } from "@/lib/utils";

/** What one icon button shows, and what it lets a press do. */
export interface IconButtonSpec {
  icon: IconName;
  /** Obsidian renders this as the tooltip and as the accessible name. */
  tooltip: string;
  /**
   * The button's colour, through the element's own style rather than an
   * attribute on the icon's SVG, where a stylesheet's rules would be out of
   * reach and `var()` would not substitute at all.
   */
  color?: string | null;
  /** A toggle's state; `null` for a button that is not a toggle. */
  pressed?: boolean | null;
  /**
   * A control that cannot run right now keeps its seat and carries its reason
   * in {@link IconButtonSpec.tooltip}, and takes no press.
   */
  disabled?: boolean;
}

/**
 * Builds one icon button into a parent.
 *
 * @param activate what a press runs, against the node pressed — which is what a
 *   menu opens beneath, from the pointer and from the keyboard alike.
 * @returns the node, so a caller can name it with its own data attribute and
 *   add what only that surface shows.
 */
export function renderIconButton(
  parent: HTMLElement,
  spec: IconButtonSpec,
  activate: (node: HTMLElement) => void,
): HTMLElement {
  const node = parent.createDiv({
    cls: "clickable-icon",
    attr: { role: "button", tabindex: "0" },
  });
  updateIconButton(node, spec);
  if (spec.disabled) return node;
  node.addEventListener("click", () => activate(node));
  node.addEventListener("keydown", (event) =>
    onActivateKey(event, () => activate(node)),
  );
  return node;
}

/** The icon each button was last drawn with, so a redraw keeps its glyph node. */
const drawnIcons = new WeakMap<HTMLElement, IconName>();

/**
 * Rewrites what a built icon button shows, in place: its icon, tooltip,
 * colour, toggle state, and blocked state. Its classes and its listeners stay
 * as they were built.
 *
 * The icon is redrawn only when it changed, because the glyph can be the very
 * node under a pointer that is still down, and a click needs it to stay.
 *
 * A button built blocked took no listeners, so only one built live can be
 * stood down and brought back here; a surface that redraws builds live and
 * gates the press itself.
 */
export function updateIconButton(
  node: HTMLElement,
  {
    icon,
    tooltip,
    color = null,
    pressed = null,
    disabled = false,
  }: IconButtonSpec,
): void {
  setTooltip(node, tooltip);
  if (drawnIcons.get(node) !== icon) {
    setIcon(node, icon);
    drawnIcons.set(node, icon);
  }
  node.style.color = color ?? "";
  if (pressed === null) {
    node.removeClass("is-active");
    node.removeAttribute("aria-pressed");
  } else {
    node.classList.toggle("is-active", pressed);
    node.setAttribute("aria-pressed", String(pressed));
  }
  node.classList.toggle("is-disabled", disabled);
  if (disabled) node.setAttribute("aria-disabled", "true");
  else node.removeAttribute("aria-disabled");
}
