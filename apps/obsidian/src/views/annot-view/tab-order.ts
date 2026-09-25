// The card list's one tab stop: the controls of every card but the tab stop
// leave the Tab order, and come back when their card becomes the tab stop.

import { disposable } from "@/lib/disposables";

const CARD = ".zt-annot-card";
/** Every element that can hold a place in the Tab order. */
const FOCUSABLE =
  "a[href], button, input, select, textarea, [tabindex], [contenteditable]";
/** The `tabindex` a held control had, `""` for none. */
const HELD = "data-zt-held-tabindex";

/**
 * Keep the card list one tab stop. The card at `tabIndex` 0 is the tab stop,
 * and Tab walks its controls after it. Every other card's controls go to
 * `tabindex="-1"`, so a pointer still reaches them.
 *
 * This is the one seam for every control a card draws, from Preact and from
 * the vanilla panels alike. It watches the grid, so a control drawn later is
 * held too, and a `tabindex` a renderer writes onto a held control is the one
 * the control gets back.
 *
 * @returns the disposer that stops the watch and gives every control back.
 */
export function confineTabOrder(grid: HTMLElement): Disposable {
  const observer = new MutationObserver((records) => {
    const written = new Set<Node>();
    const cards = new Set<Element>();
    for (const { target, type } of records) {
      if (!target.instanceOf(Element)) continue;
      // A renderer wrote the tabindex of a held control, and that is the one
      // it gets back; this seam's own writes never reach here.
      if (type === "attributes" && target.hasAttribute(HELD)) {
        if (!written.has(target)) hold(target);
        written.add(target);
      }
      if (target === grid) for (const card of cardsOf(grid)) cards.add(card);
      const card = target.closest(CARD);
      if (card) cards.add(card);
    }
    for (const card of cards) sync(card);
    observer.takeRecords();
  });
  observer.observe(grid, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["tabindex"],
  });
  for (const card of cardsOf(grid)) sync(card);
  observer.takeRecords();
  return disposable(() => {
    observer.disconnect();
    for (const control of grid.querySelectorAll(`[${HELD}]`)) release(control);
  });
}

function cardsOf(grid: HTMLElement): NodeListOf<Element> {
  return grid.querySelectorAll(CARD);
}

/** Hold a card's controls out of the Tab order, or give them back to it. */
function sync(card: Element): void {
  const stop = card.instanceOf(HTMLElement) && card.tabIndex === 0;
  for (const control of card.querySelectorAll(FOCUSABLE)) {
    if (!control.instanceOf(HTMLElement)) continue;
    if (stop) {
      if (control.hasAttribute(HELD)) release(control);
    } else if (!control.hasAttribute(HELD) && control.tabIndex >= 0) {
      hold(control);
    }
  }
}

/** Keep the control's own `tabindex` aside, and take it out of the Tab order. */
function hold(control: Element): void {
  control.setAttribute(HELD, control.getAttribute("tabindex") ?? "");
  control.setAttribute("tabindex", "-1");
}

function release(control: Element): void {
  const held = control.getAttribute(HELD) ?? "";
  control.removeAttribute(HELD);
  if (held === "") control.removeAttribute("tabindex");
  else control.setAttribute("tabindex", held);
}
