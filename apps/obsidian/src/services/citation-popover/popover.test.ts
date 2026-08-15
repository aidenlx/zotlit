// @vitest-environment happy-dom
import type { HoverParent } from "obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { CitationHoverPopover, PLACEMENT_CLASS } from "./popover";

function popover() {
  const parent: HoverParent = { hoverPopover: null };
  const targetEl = document.body.appendChild(document.createElement("span"));
  return new CitationHoverPopover(parent, targetEl);
}

const entry = () => createElement("p", null, "Doe (2024)");

describe("CitationHoverPopover", () => {
  it("holds its content in one direct child of Obsidian's own popover", async () => {
    const shown = popover();

    await act(() => {
      shown.show(entry());
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
      shown.show(entry());
    });

    await act(() => {
      shown.hide();
    });

    expect(shown.hoverEl.textContent).toBe("");
    expect(shown.show(entry())).toBe(false);
  });
});
