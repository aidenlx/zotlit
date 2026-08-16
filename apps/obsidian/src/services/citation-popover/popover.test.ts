// @vitest-environment happy-dom
import type { HoverParent } from "obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CitationHoverPopover, PLACEMENT_CLASS } from "./popover";

const opened: CitationHoverPopover[] = [];

function popover() {
  const parent: HoverParent = { hoverPopover: null };
  const targetEl = document.body.appendChild(document.createElement("span"));
  const shown = new CitationHoverPopover(parent, targetEl);
  opened.push(shown);
  return shown;
}

const entry = () => createElement("p", null, "Doe (2024)");

afterEach(() => {
  // Every popover arms a wait timer that puts it in the document, and the
  // document is shared with the test after it, so the suite hides what it
  // opened. `hide()` is idempotent, so a test that hides its own popover may.
  for (const shown of opened.splice(0)) shown.hide();
  vi.useRealTimers();
});

describe("CitationHoverPopover", () => {
  it("takes its place in the document once Obsidian's wait time is up", () => {
    vi.useFakeTimers();
    const shown = popover();

    vi.runAllTimers();

    expect(shown.hoverEl.isConnected).toBe(true);
  });

  it("holds its content in one direct child of Obsidian's own popover", async () => {
    const shown = popover();

    await act(() => {
      shown.render(entry());
    });

    const mount = shown.hoverEl.children;
    expect(mount).toHaveLength(1);
    expect([...mount[0]!.classList]).toEqual([
      "zt-root",
      "zt-citation-popover-content",
    ]);
    expect(mount[0]!.textContent).toBe("Doe (2024)");
  });

  it("stamps the placement Obsidian's positioning engine chose", () => {
    const shown = popover();

    shown.hoverEl.style.bottom = "40px";
    shown.position();
    expect(shown.hoverEl.classList.contains(PLACEMENT_CLASS.above)).toBe(true);
    expect(shown.hoverEl.classList.contains(PLACEMENT_CLASS.below)).toBe(false);

    // A reposition is another `position()` call, and the stamp follows it.
    shown.hoverEl.style.bottom = "";
    shown.hoverEl.style.top = "40px";
    shown.position();
    expect(shown.hoverEl.classList.contains(PLACEMENT_CLASS.above)).toBe(false);
    expect(shown.hoverEl.classList.contains(PLACEMENT_CLASS.below)).toBe(true);
  });

  it("tears its content down with the popover", async () => {
    const shown = popover();
    await act(() => {
      shown.render(entry());
    });

    await act(() => {
      shown.hide();
    });

    expect(shown.hoverEl.textContent).toBe("");
    expect(shown.render(entry())).toBe(false);
  });
});
