// @vitest-environment happy-dom
// Where a pinned popover stands. Beside its anchor by default; with `inset`,
// inside a box at its right edge, as tall as the box less Obsidian's gap.
import { render } from "preact";
import { act } from "preact/test-utils";
import { createElement as h, createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { AppContext } from "@/lib/app-context";
import { editorApp } from "@/views/annot-view/__fixtures__/editor-app";

import { PinnedPopover } from "./pinned-popover";
import type { PinnedPopoverHandle } from "./pinned-popover";

let host: HTMLElement | null = null;
afterEach(() => {
  const mounted = host;
  if (mounted) act(() => render(null, mounted));
  host?.remove();
  host = null;
  vi.restoreAllMocks();
});

/** A box at 100, 50 that measures 600 by 400, with an 8 px gap token. */
function box() {
  const element = document.body.appendChild(document.createElement("div"));
  element.style.setProperty("--size-4-2", "8px");
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(100, 50, 600, 400),
  );
  return element;
}

function mount(inset?: HTMLElement) {
  host = document.body.appendChild(document.createElement("div"));
  const anchor = createRef<HTMLButtonElement>();
  const handle = createRef<PinnedPopoverHandle>();
  render(
    h(AppContext, {
      value: editorApp(),
      children: [
        h("button", { key: "anchor", ref: anchor, type: "button" }, "Fields"),
        h(PinnedPopover, {
          key: "popover",
          anchor,
          handle,
          inset: inset ? { current: inset } : undefined,
          className: "surface",
          children: h("input", { "aria-label": "Search" }),
        }),
      ],
    }),
    host,
  );
  const shell = () => document.querySelector<HTMLElement>(".zt-pinned-popover");
  return { handle, shell };
}

it("stands inset in its box at the right edge, as tall as the box less the gap", async () => {
  // The surface is 320 px wide.
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
  const { handle, shell } = mount(box());
  await act(() => handle.current!.show());
  const { style } = shell()!;
  expect(shell()!.classList.contains("zt-pinned-popover-inset")).toBe(true);
  expect(style.top).toBe("58px");
  expect(style.height).toBe("384px");
  expect(style.maxWidth).toBe("584px");
  // 100 + 600 − 8 − 320
  expect(style.left).toBe("372px");
});

it("leaves its placement to Obsidian without an inset box", async () => {
  const { handle, shell } = mount();
  await act(() => handle.current!.show());
  expect(shell()!.classList.contains("zt-pinned-popover-inset")).toBe(false);
  expect(shell()!.style.height).toBe("");
  expect(shell()!.style.left).toBe("");
});
