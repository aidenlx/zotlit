// @vitest-environment happy-dom
import type { HoverParent } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PopoutAwareHoverPopover } from "./popout-aware-hover-popover";

const mainWindow = activeWindow;

/**
 * A popout window's timers: ids the main window's `clearTimeout` cannot reach,
 * the way Chromium keeps one timer table per window.
 */
function popoutWindow(): Window {
  const handles = new Map<number, ReturnType<typeof setTimeout>>();
  let next = 1;
  return {
    setTimeout(fn: () => void, ms: number) {
      const id = next++;
      handles.set(
        id,
        setTimeout(() => {
          handles.delete(id);
          fn();
        }, ms),
      );
      return id;
    },
    clearTimeout(id: number) {
      clearTimeout(handles.get(id));
      handles.delete(id);
    },
  } as unknown as Window;
}

function setup() {
  vi.useFakeTimers();
  activeWindow = popoutWindow();
  const parent: HoverParent = { hoverPopover: null };
  const target = document.body.appendChild(document.createElement("span"));
  const popover = new PopoutAwareHoverPopover(parent, target, 300);
  return {
    parent,
    target,
    popover,
    [Symbol.dispose]() {
      popover.hide();
      target.remove();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  activeWindow = mainWindow;
});

describe("PopoutAwareHoverPopover", () => {
  it("stays hidden after hide() cancels a show timer armed on a popout window", () => {
    using h = setup();
    vi.advanceTimersByTime(100);
    h.popover.hide();
    vi.advanceTimersByTime(300);
    expect(h.parent.hoverPopover).toBeNull();
    expect(h.popover.hoverEl.isConnected).toBe(false);
  });

  it("keeps the off-target grace when the hide timer was armed on a popout window", () => {
    using h = setup();
    vi.advanceTimersByTime(300);
    h.target.dispatchEvent(new MouseEvent("mouseout"));
    vi.advanceTimersByTime(200);
    h.target.dispatchEvent(new MouseEvent("mouseover"));
    vi.advanceTimersByTime(50);
    h.target.dispatchEvent(new MouseEvent("mouseout"));
    vi.advanceTimersByTime(200);
    expect(h.popover.hoverEl.isConnected).toBe(true);
    vi.advanceTimersByTime(100);
    expect(h.popover.hoverEl.isConnected).toBe(false);
  });
});
