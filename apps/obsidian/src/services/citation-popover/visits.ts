// The lifecycle every hover popover of the Citation Popover's chrome shares:
// one popover per hover parent, moved between the targets that parent hovers.

import type { HoverParent } from "obsidian";

import { CitationHoverPopover } from "./popover";

/** One hover parent's popover, and what its current target holds. */
export interface HoverVisit<T> {
  readonly popover: CitationHoverPopover;
  /**
   * What the current target holds: its reads and its subscriptions. Disposed
   * when the visit moves to another target or the popover hides.
   */
  readonly subscriptions: DisposableStack;
  /** The current target's own state, made fresh for every target. */
  readonly state: T;
}

interface Visit<T> {
  popover: CitationHoverPopover;
  window: Window;
  subscriptions: DisposableStack;
  state: T;
}

/**
 * Owns one {@link CitationHoverPopover} per hover parent. A parent hovering
 * another target moves its popover there, clearing what the previous target
 * drew and held; a target in another window opens a popover of its own there.
 * A hidden popover lets go of everything its last target held.
 */
export class HoverVisits<T> {
  readonly #visits = new Map<HoverParent, Visit<T>>();
  readonly #fresh;

  /** @param fresh makes the state one target starts with. */
  constructor(fresh: () => T) {
    this.#fresh = fresh;
  }

  /** The popover `hoverParent` shows over `targetEl`, opened or moved there. */
  open(hoverParent: HoverParent, targetEl: HTMLElement): HoverVisit<T> {
    let visit = this.#visits.get(hoverParent);
    if (visit && visit.window !== targetEl.win) {
      visit.popover.hide();
      visit = undefined;
    }
    if (!visit) {
      const popover = new CitationHoverPopover(hoverParent, targetEl);
      const opened: Visit<T> = {
        popover,
        window: targetEl.win,
        subscriptions: new DisposableStack(),
        state: this.#fresh(),
      };
      this.#visits.set(hoverParent, opened);
      popover.register(() => {
        opened.subscriptions.dispose();
        if (this.#visits.get(hoverParent) === opened) {
          this.#visits.delete(hoverParent);
        }
      });
      return opened;
    }
    visit.subscriptions.dispose();
    visit.subscriptions = new DisposableStack();
    visit.state = this.#fresh();
    // Clear the previous target's content before moving the card.
    visit.popover.render(null);
    visit.popover.retarget(targetEl);
    return { ...visit };
  }

  /** Closes the parent's popover, or only while it shows over `targetEl`. */
  hide(hoverParent: HoverParent, targetEl?: HTMLElement): void {
    const popover = this.#visits.get(hoverParent)?.popover;
    if (popover && (!targetEl || popover.targetEl === targetEl)) popover.hide();
  }

  hideAll(): void {
    for (const { popover } of this.#visits.values()) popover.hide();
  }
}
