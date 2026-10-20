// A stand-in for Obsidian's `onWindowMigrated`, which happy-dom lacks: tests
// move an element to a popout window by hand. Disposing it restores the
// element prototype.
import { vi } from "vitest";

export function windowMigration() {
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "onWindowMigrated",
  );
  const listeners: ((win: Window) => void)[] = [];
  /** Called when an element releases its listener. */
  const release = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "onWindowMigrated", {
    configurable: true,
    value: (listener: (win: Window) => void) => {
      listeners.push(listener);
      return release;
    },
  });
  return {
    release,
    /** Tells every listener that its element moved to `win`. */
    move: (win: Window) => {
      for (const listener of listeners) listener(win);
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
