// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

import { registerMigratingWindowEvent } from "./disposables";

it("moves a window listener with its element and disposes the current binding", () => {
  const first = new EventTarget();
  const second = new EventTarget();
  const element = document.createElement("div");
  let migrate: ((win: Window) => void) | null = null;
  const stopMigration = vi.fn();
  Object.defineProperties(element, {
    win: { value: first },
    onWindowMigrated: {
      value: (listener: (win: Window) => void) => {
        migrate = listener;
        return stopMigration;
      },
    },
  });
  const onFocus = vi.fn();

  const registered = registerMigratingWindowEvent(element, "focus", onFocus);
  first.dispatchEvent(new Event("focus"));
  expect(onFocus).toHaveBeenCalledTimes(1);

  migrate!(second as Window);
  first.dispatchEvent(new Event("focus"));
  second.dispatchEvent(new Event("focus"));
  expect(onFocus).toHaveBeenCalledTimes(2);

  registered[Symbol.dispose]();
  second.dispatchEvent(new Event("focus"));
  expect(onFocus).toHaveBeenCalledTimes(2);
  expect(stopMigration).toHaveBeenCalledOnce();
});
