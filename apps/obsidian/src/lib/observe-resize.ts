// A ResizeObserver from the window that shows the elements it observes.
//
// @see apps/obsidian/policies/popout-windows.md
import { disposable } from "./disposables";

/**
 * Observes the size of `targets` from the window that shows `owner`, and
 * observes again from the new window when Obsidian moves `owner`'s view into
 * or out of a pop-out. A `ResizeObserver` reports only elements in the window
 * whose constructor made it.
 *
 * @param owner the element whose window shows `targets`, such as the root of
 *   the view they stand in.
 */
export function observeResize(
  owner: HTMLElement,
  targets: readonly Element[],
  callback: ResizeObserverCallback,
): Disposable {
  let observer: ResizeObserver | null = null;
  const observe = (win: Window) => {
    observer?.disconnect();
    observer = null;
    const { ResizeObserver } = win as Partial<typeof window>;
    // A test window may have none.
    if (!ResizeObserver) return;
    observer = new ResizeObserver(callback);
    for (const target of targets) observer.observe(target);
  };
  observe(owner.win);
  const stopMigration = owner.onWindowMigrated(observe);
  return disposable(() => {
    stopMigration();
    observer?.disconnect();
    observer = null;
  });
}
