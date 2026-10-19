// The Reading Card's inner edge, which sets its width as a sidebar's edge
// does: a drag, the arrow keys, Home and End, and a double click for the
// default. A drag well past the minimum closes the card, as an Obsidian
// sidebar collapses. The width the researcher sets is the document's
// `cardWidth`; the width on screen is that one clamped to the pane, so a pane
// that narrows for a while never loses the width kept.
//
// @see apps/obsidian/docs/adr/0071-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
import { setTooltip } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { pointerDrag } from "@/lib/pointer-drag";

import {
  CARD_WIDTH_DEFAULT,
  CARD_WIDTH_MIN,
  cardWidthBounds,
} from "./document";

/** The custom property the card's width utility reads. */
const CARD_WIDTH = "--zt-library-card-width";

/** How far one arrow key moves the edge, in pixels. */
const STEP = 16;

/**
 * How far past the minimum width a drag goes before the card collapses, in
 * pixels: half the minimum, so a drag that only overshoots it keeps the card.
 */
const CARD_CLOSE_PAST_MIN = CARD_WIDTH_MIN / 2;

/**
 * The body class of a card resize on: the resize cursor over the whole page,
 * whatever the pointer passes over. `style.css` sets it.
 */
const RESIZING = "zt-is-resizing-library-card";

/**
 * The card's inner edge: a strip on its start side with the resize cursor,
 * whose line shows on hover and focus and holds the accent while it is
 * dragged. Over a narrow pane the card is absolute already.
 */
const HANDLE =
  "zt:absolute zt:-start-1 zt:inset-y-0 zt:z-(--layer-cover) zt:w-2 zt:cursor-col-resize zt:touch-none zt:outline-none zt:after:absolute zt:after:inset-y-0 zt:after:start-[3px] zt:after:w-0.5 zt:hover:after:bg-(--interactive-accent) zt:focus-visible:after:bg-(--interactive-accent) zt:[&.is-active]:after:bg-(--interactive-accent)";

export interface CardWidthHost {
  /** The width the document keeps, in pixels; `undefined` for the default. */
  stored(): number | undefined;
  /** Keep the width the researcher set; `undefined` returns to the default. */
  keep(width: number | undefined): void;
  /**
   * Hide the card while a drag holds it past the minimum, or show it again
   * as it was.
   */
  collapse(collapsed: boolean): void;
  /** Close the card, as a drag let go past the minimum asks. */
  close(): void;
}

/** Where the Reading Card shows. */
export interface CardWidthPanes {
  /** The list the card shows beside on a wide pane. */
  list: HTMLElement;
  /** The pane that holds the list and the card, which a narrow card overlays. */
  pane: HTMLElement;
}

/**
 * Put the resize edge on `card` and size it from `host`'s width, clamped so
 * the list keeps 20rem beside it, or, over a narrow pane, so the card takes
 * at most 85% of it. Call {@link CardWidth.apply} when the card shows or the
 * kept width changes; the pane's own resizes apply themselves.
 */
export class CardWidth {
  readonly #card: HTMLElement;
  readonly #list: HTMLElement;
  readonly #pane: HTMLElement;
  readonly #host: CardWidthHost;
  readonly #handle: HTMLElement;
  /** The width on screen, in pixels. */
  #width = CARD_WIDTH_DEFAULT;
  #observer: ResizeObserver | null = null;
  #drag: AbortController | null = null;

  constructor(
    card: HTMLElement,
    { list, pane }: CardWidthPanes,
    host: CardWidthHost,
  ) {
    this.#card = card;
    this.#list = list;
    this.#pane = pane;
    this.#host = host;
    const handle = card.createDiv({
      cls: HANDLE,
      attr: {
        role: "separator",
        tabindex: "0",
        "aria-orientation": "vertical",
        "data-library-card-resizer": "",
      },
    });
    setTooltip(handle, m.library_view_card_resize_hint(), {
      placement: "left",
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

  /** Follow the pane's size, which sets the most the card can take. */
  load(): void {
    if (typeof ResizeObserver === "undefined") return;
    this.#observer = new ResizeObserver(() => this.apply());
    this.#observer.observe(this.#pane);
  }

  unload(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#drag?.abort();
  }

  /** Show the kept width, clamped to the pane as it is now. */
  apply(): void {
    if (this.#drag) return;
    this.#show(this.#host.stored() ?? CARD_WIDTH_DEFAULT);
  }

  /** The widths the card can take in the pane as it is now. */
  #bounds(): { min: number; max: number } {
    const card = this.#card;
    const overlay = card.win.getComputedStyle(card).position === "absolute";
    // Beside the list the card and the list share the room; over a narrow
    // pane, the card takes from the whole pane it overlays.
    const pane = overlay
      ? this.#pane.getBoundingClientRect().width
      : this.#list.getBoundingClientRect().width +
        (card.hidden ? 0 : card.getBoundingClientRect().width);
    return cardWidthBounds(pane === 0 ? Number.POSITIVE_INFINITY : pane, {
      overlay,
    });
  }

  /** Show `width`, within the pane's bounds, and say it on the edge. */
  #show(width: number): number {
    const { min, max } = this.#bounds();
    const shown = Math.round(Math.min(max, Math.max(min, width)));
    this.#width = shown;
    this.#card.style.setProperty(CARD_WIDTH, `${shown}px`);
    const handle = this.#handle;
    handle.setAttribute("aria-valuemin", String(min));
    handle.setAttribute(
      "aria-valuemax",
      String(Number.isFinite(max) ? max : shown),
    );
    handle.setAttribute("aria-valuenow", String(shown));
    return shown;
  }

  /** Whether the card's start edge is on the right, as in a right-to-left pane. */
  #rtl(): boolean {
    return this.#card.win.getComputedStyle(this.#card).direction === "rtl";
  }

  /**
   * The arrow keys move the edge 16px, so the key toward the list widens the
   * card; Home and End take it to its narrowest and widest.
   */
  #key(event: KeyboardEvent): void {
    const toList = this.#rtl() ? "ArrowRight" : "ArrowLeft";
    const fromList = this.#rtl() ? "ArrowLeft" : "ArrowRight";
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
   * pointer or the view that closes put it back. A pointer
   * {@link CARD_CLOSE_PAST_MIN} past the minimum collapses the card while it
   * stays there; let go there, the card closes and keeps the width it had
   * before the drag.
   */
  #resize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.#drag?.abort();
    const controller = new AbortController();
    this.#drag = controller;
    const start = this.#width;
    // The edge is on the card's start side: toward the list widens it.
    const sign = this.#rtl() ? 1 : -1;
    const widthAt = (delta: number) => start + sign * delta;
    const closes = (width: number) =>
      width < CARD_WIDTH_MIN - CARD_CLOSE_PAST_MIN;
    let kept = false;
    let collapsed = false;
    const collapse = (now: boolean) => {
      if (now === collapsed) return;
      collapsed = now;
      this.#host.collapse(now);
    };
    pointerDrag({
      press: event,
      handle: this.#handle,
      cursor: RESIZING,
      controller,
      move: (delta) => {
        const width = widthAt(delta);
        collapse(closes(width));
        // A collapsed card keeps the width it would come back at.
        if (!collapsed) this.#show(width);
      },
      drop: (delta) => {
        const width = widthAt(delta);
        if (closes(width)) {
          // The card closes before it shows again, at the width it had.
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
