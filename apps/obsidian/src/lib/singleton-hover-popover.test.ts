// @vitest-environment happy-dom
import type { HoverParent } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SingletonHoverPopover } from "./singleton-hover-popover";

function setup() {
  vi.useFakeTimers();
  const parent: HoverParent = { hoverPopover: null };
  const first = document.body.appendChild(document.createElement("span"));
  const next = document.body.appendChild(document.createElement("span"));
  const popover = new SingletonHoverPopover(parent, first, 300);
  return {
    parent,
    first,
    next,
    popover,
    [Symbol.dispose]() {
      popover.hide();
      first.remove();
      next.remove();
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("SingletonHoverPopover", () => {
  it("keeps a shown card mounted without starting another show sequence", () => {
    using h = setup();
    vi.advanceTimersByTime(300);
    const content = h.popover.hoverEl.appendChild(document.createElement("p"));
    content.textContent = "Example to copy";
    h.popover.register(() => content.remove());
    h.popover.retarget(h.next);
    expect(h.parent.hoverPopover).toBe(h.popover);
    expect(content.isConnected).toBe(true);
    vi.advanceTimersByTime(300);
    expect(h.parent.hoverPopover).toBe(h.popover);
    expect(content.isConnected).toBe(true);
  });

  it("keeps the original enter timer when re-targeted before opening", () => {
    using h = setup();
    vi.advanceTimersByTime(200);
    h.popover.retarget(h.next);
    vi.advanceTimersByTime(99);
    expect(h.parent.hoverPopover).toBeNull();
    expect(h.popover.hoverEl.isConnected).toBe(false);
    vi.advanceTimersByTime(1);
    expect(h.parent.hoverPopover).toBe(h.popover);
    expect(h.popover.hoverEl.isConnected).toBe(true);
  });

  it("cancels a pending close when another target is reached", () => {
    using h = setup();
    vi.advanceTimersByTime(300);
    h.first.dispatchEvent(new MouseEvent("mouseout"));
    vi.advanceTimersByTime(200);
    h.popover.retarget(h.next);
    vi.advanceTimersByTime(300);
    expect(h.parent.hoverPopover).toBe(h.popover);
    expect(h.popover.hoverEl.isConnected).toBe(true);
  });

  it("follows entry and exit on the new target and releases the old target", () => {
    using h = setup();
    vi.advanceTimersByTime(300);
    h.popover.retarget(h.next);
    h.first.dispatchEvent(new MouseEvent("mouseout"));
    vi.advanceTimersByTime(300);
    expect(h.parent.hoverPopover).toBe(h.popover);
    h.next.dispatchEvent(new MouseEvent("mouseout"));
    vi.advanceTimersByTime(299);
    expect(h.popover.hoverEl.isConnected).toBe(true);
    vi.advanceTimersByTime(1);
    expect(h.parent.hoverPopover).toBeNull();
    expect(h.popover.hoverEl.isConnected).toBe(false);
  });
});
