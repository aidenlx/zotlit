// A stand-in for Obsidian's `onWindowMigrated`, which happy-dom lacks: tests
// move an element to a popout window by hand. Disposing it restores the
// element prototype.
import { vi } from "vitest";

export function windowMigration() {
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "onWindowMigrated",
  );
  let migrate: ((win: Window) => void) | null = null;
  /** Called when the element releases its listener. */
  const release = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "onWindowMigrated", {
    configurable: true,
    value: (listener: (win: Window) => void) => {
      migrate = listener;
      return release;
    },
  });
  return {
    release,
    /** Moves the element that listened last to `win`. */
    move: (win: Window) => migrate?.(win),
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
