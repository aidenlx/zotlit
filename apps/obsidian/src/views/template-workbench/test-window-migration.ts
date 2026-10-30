// A stand-in for Obsidian's `onWindowMigrated`, which happy-dom lacks: tests
// move an element to a popout window by hand. Disposing it restores the
// element prototype. Like Obsidian, which hears a move through the animation
// a class it adds starts, it tells only an element that still has that class.
import { vi } from "vitest";

/** The class whose animation tells Obsidian an element shows. */
const NODE_INSERT_CLASS = "node-insert-event";

export function windowMigration() {
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "onWindowMigrated",
  );
  const listeners: [HTMLElement, (win: Window) => void][] = [];
  /** Called when the element releases its listener. */
  const release = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "onWindowMigrated", {
    configurable: true,
    value(this: HTMLElement, listener: (win: Window) => void) {
      this.classList.add(NODE_INSERT_CLASS);
      listeners.push([this, listener]);
      return release;
    },
  });
  return {
    release,
    /** Moves the elements that listen to `win`. */
    move: (win: Window) => {
      for (const [element, listener] of listeners)
        if (element.classList.contains(NODE_INSERT_CLASS)) listener(win);
    },
    [Symbol.dispose]() {
      if (original) {
        Object.defineProperty(
          HTMLElement.prototype,
          "onWindowMigrated",
          original,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "onWindowMigrated");
      }
    },
  };
}
