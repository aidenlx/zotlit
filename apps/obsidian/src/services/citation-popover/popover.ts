// Obsidian's own popover, hosting one live React root of ZotLit's own content.

import { HoverPopover } from "obsidian";
import type { HoverParent } from "obsidian";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import "./style.css";

/** Obsidian's own hover delay, which every popover of its own opens after. */
const WAIT_TIME = 300;

/** Stamped on the popover for the block layout to read; never both at once. */
export const PLACEMENT_CLASS = {
  above: "zt-citation-popover-above",
  below: "zt-citation-popover-below",
} as const;

/**
 * The Citation Popover's own chrome: Obsidian's popover, its timing, its
 * dismissal, and one direct child holding the content.
 *
 * That child is the only element ZotLit owns here. It carries the scoped
 * preflight every plugin root does, and its own scrolling: the popover itself
 * hides overflow and has its height clamped where the viewport is cramped, so a
 * tall stack of entries scrolls inside the content rather than being cut off by
 * it.
 */
export class CitationHoverPopover extends HoverPopover {
  #root: Root | null;

  constructor(parent: HoverParent, targetEl: HTMLElement) {
    super(parent, targetEl, WAIT_TIME);
    this.hoverEl.classList.add("zt-citation-popover");
    const mount = this.hoverEl.ownerDocument.createElement("div");
    mount.classList.add("zt-root", "zt-citation-popover-content");
    this.hoverEl.append(mount);
    this.#root = createRoot(mount);
    // The entries are read after the popover opens, so it takes its place
    // again as they land.
    this.watchResize(mount);
    this.register(() => {
      this.#root?.unmount();
      this.#root = null;
    });
  }

  /**
   * Draw `content` in the popover.
   *
   * Named apart from {@link HoverPopover.show}, which stays Obsidian's to open
   * the popover with.
   *
   * @returns whether the popover was still live to draw it — a hover the
   *   pointer left before the entries were read is already torn down.
   */
  render(content: ReactNode): boolean {
    if (!this.#root) return false;
    this.#root.render(content);
    return true;
  }

  /**
   * Obsidian's positioning engine records the placement it chose as an inline
   * style alone — `bottom` for a popover it put above the target, `top` for one
   * below — so the class the content reads is stamped from that style on every
   * placement, repositions included.
   */
  override position(): void {
    super.position();
    const { style } = this.hoverEl;
    this.hoverEl.classList.toggle(PLACEMENT_CLASS.above, style.bottom !== "");
    this.hoverEl.classList.toggle(PLACEMENT_CLASS.below, style.top !== "");
  }
}
