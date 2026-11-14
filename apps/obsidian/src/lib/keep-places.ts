// The place of every scroll box in a view, kept while the view's host takes
// the view off the page.
//
// A note takes a view's element off the page as it scrolls far from it, and
// puts the same element back on the way back. Off the page a scroll box has
// no place: the browser shows it at its top and start again, with no scroll
// event. A view that is only hidden, as a tab behind another or a folded
// callout, keeps its places by itself.
import { disposable } from "./disposables";
import { observeResize } from "./observe-resize";

/**
 * Keep the place of every scroll box inside `root`: once `root` shows again
 * after it stood at no size, each box scrolls back to where its last scroll
 * left it, before the page draws.
 */
export function keepPlaces(root: HTMLElement): Disposable {
  const places = new Map<HTMLElement, { top: number; left: number }>();
  const onScroll = (event: Event) => {
    const box = event.target as Node;
    if (!box.instanceOf(HTMLElement)) return;
    if (box.scrollTop === 0 && box.scrollLeft === 0) places.delete(box);
    else places.set(box, { top: box.scrollTop, left: box.scrollLeft });
  };
  // A scroll event reaches the root only on its way down to the box.
  root.addEventListener("scroll", onScroll, { capture: true, passive: true });
  const restore = () => {
    for (const [box, { top, left }] of places) {
      if (!root.contains(box)) places.delete(box);
      else box.scrollTo({ top, left, behavior: "instant" });
    }
  };
  let shown = root.clientHeight > 0;
  const observing = observeResize(root, [root], () => {
    const shows = root.clientHeight > 0;
    if (shows && !shown) restore();
    shown = shows;
  });
  return disposable(() => {
    root.removeEventListener("scroll", onScroll, { capture: true });
    observing[Symbol.dispose]();
    places.clear();
  });
}
