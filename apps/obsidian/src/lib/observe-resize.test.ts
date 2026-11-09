// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { windowMigration } from "@/views/template-workbench/test-window-migration";

import { observeResize } from "./observe-resize";

/** A window whose `ResizeObserver` records what each observer watches. */
function windowWithObservers() {
  const observed: Element[][] = [];
  const disconnected = vi.fn();
  class ResizeObserver {
    readonly #targets: Element[] = [];
    constructor(_callback: ResizeObserverCallback) {
      observed.push(this.#targets);
    }
    observe(target: Element) {
      this.#targets.push(target);
    }
    disconnect() {
      disconnected(this.#targets);
    }
  }
  return {
    win: { ResizeObserver } as unknown as Window,
    observed,
    disconnected,
  };
}

describe("observeResize", () => {
  it("observes from the owner's window, and from the window it moves to", () => {
    using migration = windowMigration();
    const owner = document.body.createDiv();
    const target = owner.createDiv();
    const main = windowWithObservers();
    vi.spyOn(owner, "win", "get").mockReturnValue(main.win);
    using _observing = observeResize(owner, [owner, target], () => {});
    expect(main.observed).toEqual([[owner, target]]);
    const popout = windowWithObservers();
    migration.move(popout.win);
    expect(main.disconnected).toHaveBeenCalledWith([owner, target]);
    expect(popout.observed).toEqual([[owner, target]]);
    owner.remove();
  });

  it("stops observing and stops following the owner once disposed", () => {
    using migration = windowMigration();
    const owner = document.body.createDiv();
    const main = windowWithObservers();
    vi.spyOn(owner, "win", "get").mockReturnValue(main.win);
    observeResize(owner, [owner], () => {})[Symbol.dispose]();
    expect(main.disconnected).toHaveBeenCalledTimes(1);
    expect(migration.release).toHaveBeenCalledTimes(1);
    owner.remove();
  });
});
