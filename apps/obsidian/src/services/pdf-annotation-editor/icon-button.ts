// The one icon button every reader surface is built from: the Creation
// Toolbar's tools, the Mark Popup's verbs, and the Editing Capability
// affordance.
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
  /** Classes beside Obsidian's own `clickable-icon` — a theme hook, layout. */
  cls?: readonly string[];
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
  {
    icon,
    tooltip,
    cls = [],
    color = null,
    pressed = null,
    disabled = false,
  }: IconButtonSpec,
  activate: (node: HTMLElement) => void,
): HTMLElement {
  const node = parent.createDiv({
    cls: ["clickable-icon", ...cls],
    attr: { role: "button", tabindex: "0" },
  });
  setTooltip(node, tooltip);
  setIcon(node, icon);
  if (color !== null) node.style.color = color;
  if (pressed !== null) {
    node.classList.toggle("is-active", pressed);
    node.setAttribute("aria-pressed", String(pressed));
  }
  if (disabled) {
    node.addClass("is-disabled");
    node.setAttribute("aria-disabled", "true");
    return node;
  }
  node.addEventListener("click", () => activate(node));
  node.addEventListener("keydown", (event) =>
    onActivateKey(event, () => activate(node)),
  );
  return node;
}
