// The inner edge of a pane beside the list, the Reading Card or the Library
// Tree, which sets its width as a sidebar's edge does: a drag, the arrow
// keys, Home and End, and a double click for the default. A drag well past
// the minimum closes the pane, as an Obsidian sidebar collapses. The width
// the researcher sets is the document's `cardWidth` or `treeWidth`; the width
// on screen is that one clamped to the room, so a pane that narrows for a
// while never loses the width kept.
//
// @see apps/obsidian/docs/adr/0071-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
import { setTooltip } from "obsidian";

import { pointerDrag } from "@/lib/pointer-drag";
import type { PointerDrag } from "@/lib/pointer-drag";

import { cardWidthBounds } from "./document";

/** How far one arrow key moves the edge, in pixels. */
const STEP = 16;

/**
 * The body class of a resize on: the resize cursor over the whole page,
 * whatever the pointer passes over. `style.css` sets it.
 */
const RESIZING = "zt-is-resizing-library-card";

/**
 * The pane's inner edge: a strip with the resize cursor, whose line shows on
 * hover and focus and holds the accent while it is dragged.
 */
const HANDLE =
  "zt:absolute zt:inset-y-0 zt:z-(--layer-cover) zt:w-2 zt:cursor-col-resize zt:touch-none zt:outline-none zt:after:absolute zt:after:inset-y-0 zt:after:start-[3px] zt:after:w-0.5 zt:hover:after:bg-(--interactive-accent) zt:focus-visible:after:bg-(--interactive-accent) zt:[&.is-active]:after:bg-(--interactive-accent)";

export interface PaneWidthHost {
  /** The width the document keeps, in pixels; `undefined` for the default. */
  stored(): number | undefined;
  /** Keep the width the researcher set; `undefined` returns to the default. */
  keep(width: number | undefined): void;
  /**
   * Hide the pane while a drag holds it past the minimum, or show it again
   * as it was.
   */
  collapse(collapsed: boolean): void;
  /** Close the pane, as a drag let go past the minimum asks. */
  close(): void;
  /** The app whose keymap a drag of the edge takes Escape on. */
  readonly app: PointerDrag["app"];
}

/** Which pane the edge sizes, and how. */
export interface PaneWidthOptions {
  /** The list the pane shows beside, which keeps 20rem. */
  list: HTMLElement;
  /** The box whose size sets the most the pane can take. */
  shell: HTMLElement;
  /**
   * The side of the pane the edge sits on, toward the list: `start` for the
   * card after the list, `end` for the tree before it.
   */
  side: "start" | "end";
  /** The custom property the pane's width utility reads. */
  property: string;
  /** The width until the researcher sets one, in pixels. */
  fallback: number;
  /** The narrowest the pane can be, in pixels. */
  min: number;
  /**
   * More classes for the edge: the container query that hides it where the
   * pane does not show beside the list.
   */
  cls: string;
  /** The edge's tooltip, and the attribute that names it. */
  hint: string;
  attr: string;
}

/**
 * Put the resize edge on `pane` and size it from `host`'s width, clamped so
 * the list keeps 20rem beside it. Call {@link PaneWidth.apply} when the pane
 * shows or the kept width changes; the shell's own resizes apply themselves.
 * Where the edge is hidden, the pane does not show beside the list, and its
 * width waits for a pane where it does.
 */
export class PaneWidth {
  readonly #pane: HTMLElement;
  readonly #options: PaneWidthOptions;
  readonly #host: PaneWidthHost;
  readonly #handle: HTMLElement;
  /** The width on screen, in pixels. */
  #width: number;
  #observer: ResizeObserver | null = null;
  #drag: AbortController | null = null;

  constructor(
    pane: HTMLElement,
    options: PaneWidthOptions,
    host: PaneWidthHost,
  ) {
    this.#pane = pane;
    this.#options = options;
    this.#host = host;
    this.#width = options.fallback;
    const handle = pane.createDiv({
      cls: `${HANDLE} ${options.side === "start" ? "zt:-start-1" : "zt:-end-1"} ${options.cls}`,
      attr: {
        role: "separator",
        tabindex: "0",
        "aria-orientation": "vertical",
        [options.attr]: "",
      },
    });
    setTooltip(handle, options.hint, {
      placement: options.side === "start" ? "left" : "right",
    });
    handle.addEventListener("pointerdown", (event) => this.#resize(event));
    handle.addEventListener("keydown", (event) => this.#key(event));
    handle.addEventListener("dblclick", (event) => {
      event.preventDefault();
      this.#host.keep(undefined);
      this.apply();
    });
    this.#handle = handle;
  }

  /** Follow the shell's size, which sets the most the pane can take. */
  load(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.#observer = new ResizeObserver(() => this.apply());
    this.#observer.observe(this.#options.shell);
  }

  unload(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#drag?.abort();
  }

  /** Show the kept width, clamped to the room as it is now. */
  apply(): void {
    if (this.#drag || !this.#beside()) return;
    this.#show(this.#host.stored() ?? this.#options.fallback);
  }

  /** Whether the pane shows beside the list, where its edge shows. */
  #beside(): boolean {
    const handle = this.#handle;
    return handle.win.getComputedStyle(handle).display !== "none";
  }

  /** The widths the pane can take in the room as it is now. */
  #bounds(): { min: number; max: number } {
    // The pane and the list share the room beside each other.
    const room =
      this.#options.list.getBoundingClientRect().width +
      this.#pane.getBoundingClientRect().width;
    return cardWidthBounds(
      room === 0 ? Number.POSITIVE_INFINITY : room,
      this.#options.min,
    );
  }

  /** Show `width`, within the room's bounds, and say it on the edge. */
  #show(width: number): number {
    const { min, max } = this.#bounds();
    const shown = Math.round(Math.min(max, Math.max(min, width)));
    this.#width = shown;
    this.#pane.style.setProperty(this.#options.property, `${shown}px`);
    const handle = this.#handle;
    handle.setAttribute("aria-valuemin", String(min));
    handle.setAttribute(
      "aria-valuemax",
      String(Number.isFinite(max) ? max : shown),
    );
    handle.setAttribute("aria-valuenow", String(shown));
    return shown;
  }

  /**
   * The sign of a move toward the list: the card's edge is on its start
   * side and the tree's on its end side, and a right-to-left pane mirrors
   * both.
   */
  #towardList(): 1 | -1 {
    const rtl = this.#pane.win.getComputedStyle(this.#pane).direction === "rtl";
    return (this.#options.side === "start") === rtl ? 1 : -1;
  }

  /**
   * The arrow keys move the edge 16px, so the key toward the list widens the
   * pane; Home and End take it to its narrowest and widest.
   */
  #key(event: KeyboardEvent): void {
    const toList = this.#towardList() === 1 ? "ArrowRight" : "ArrowLeft";
    const fromList = toList === "ArrowRight" ? "ArrowLeft" : "ArrowRight";
    const { min, max } = this.#bounds();
    let width: number;
    if (event.key === toList) width = this.#width + STEP;
    else if (event.key === fromList) width = this.#width - STEP;
    else if (event.key === "Home") width = min;
    else if (event.key === "End") width = max;
    else return;
    event.preventDefault();
    event.stopPropagation();
    this.#host.keep(this.#show(width));
  }

  /**
   * Follow a drag on the edge with the pointer, as a column's edge does: the
   * width keeps when the pointer lets go after it moved; Escape, a lost
   * pointer or the view that closes put it back. A pointer half the minimum
   * past the minimum collapses the pane while it stays there; let go there,
   * the pane closes and keeps the width it had before the drag.
   */
  #resize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.#drag?.abort();
    const controller = new AbortController();
    this.#drag = controller;
    const start = this.#width;
    const sign = this.#towardList();
    const widthAt = (delta: number) => start + sign * delta;
    const { min } = this.#options;
    const closes = (width: number) => width < min - min / 2;
    let kept = false;
    let collapsed = false;
    const collapse = (now: boolean) => {
      if (now === collapsed) return;
      collapsed = now;
      this.#host.collapse(now);
    };
    pointerDrag({
      app: this.#host.app,
      press: event,
      handle: this.#handle,
      cursor: RESIZING,
      controller,
      move: (delta) => {
        const width = widthAt(delta);
        collapse(closes(width));
        // A collapsed pane keeps the width it would come back at.
        if (!collapsed) this.#show(width);
      },
      drop: (delta) => {
        const width = widthAt(delta);
        if (closes(width)) {
          // The pane closes before it shows again, at the width it had.
          this.#host.close();
        } else {
          kept = true;
          this.#host.keep(this.#show(width));
        }
      },
      end: () => {
        if (this.#drag === controller) this.#drag = null;
        collapse(false);
        if (!kept) this.apply();
      },
    });
  }
}
