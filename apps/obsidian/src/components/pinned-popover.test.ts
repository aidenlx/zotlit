// @vitest-environment happy-dom
// Where a pinned popover stands. Beside its anchor by default; with `inset`,
// inside a box at its right edge, as tall as the box less Obsidian's gap.
import { render } from "preact";
import { act } from "preact/test-utils";
import { createElement as h, createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { pressTop } from "@/lib/__fixtures__/keymap";
import { AppContext } from "@/lib/app-context";
import { editorApp } from "@/views/annot-view/__fixtures__/editor-app";

import { PinnedPopover } from "./pinned-popover";
import type { PageKey, PinnedPopoverHandle } from "./pinned-popover";

let host: HTMLElement | null = null;
afterEach(() => {
  const mounted = host;
  // Unmounting hides the popover on the body.
  if (mounted) void act(() => render(null, mounted));
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

function mount(
  inset?: HTMLElement,
  options: {
    beside?: HTMLElement;
    onEscape?: () => boolean;
    initialFocus?: boolean;
    pageKeys?: PageKey[];
  } = {},
) {
  host = document.body.appendChild(document.createElement("div"));
  const anchor = createRef<HTMLButtonElement>();
  const handle = createRef<PinnedPopoverHandle>();
  const app = editorApp();
  render(
    h(AppContext, {
      value: app,
      children: [
        h("button", { key: "anchor", ref: anchor, type: "button" }, "Fields"),
        h(PinnedPopover, {
          key: "popover",
          anchor,
          handle,
          inset: inset ? { current: inset } : undefined,
          beside: options.beside ? { current: options.beside } : undefined,
          onEscape: options.onEscape,
          initialFocus: options.initialFocus,
          pageKeys: options.pageKeys,
          className: "surface",
          children: h("input", { "aria-label": "Search" }),
        }),
      ],
    }),
    host,
  );
  const shell = () => document.querySelector<HTMLElement>(".zt-pinned-popover");
  return { app, anchor, handle, shell };
}

/** A box at `left`, 50 that measures 320 by 400: the panel a popover stands beside. */
function panel(left: number) {
  const element = document.body.appendChild(document.createElement("div"));
  element.style.setProperty("--size-4-2", "8px");
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(left, 50, 320, 400),
  );
  return element;
}

it("stands inset in its box at the right edge, as tall as the box less the gap", async () => {
  // The surface is 320 px wide.
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
  const { handle, shell } = mount(box());
  await act(() => handle.current!.show());
  const { style } = shell()!;
  expect(style.top).toBe("58px");
  expect(style.height).toBe("384px");
  expect(style.maxWidth).toBe("584px");
  // 100 + 600 − 8 − 320
  expect(style.left).toBe("372px");
});

it("leaves its placement to Obsidian without an inset box", async () => {
  const { handle, shell } = mount();
  await act(() => handle.current!.show());
  expect(shell()!.style.height).toBe("");
  expect(shell()!.style.left).toBe("");
});

it("stands beside a box, level with its anchor, on the side with more room", async () => {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(288);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
  const { anchor, handle, shell } = mount(undefined, { beside: panel(672) });
  vi.spyOn(anchor.current!, "getBoundingClientRect").mockReturnValue(
    new DOMRect(680, 120, 300, 28),
  );
  await act(() => handle.current!.show());
  // Left of the panel at the window's right edge: 672 − 8 − 288.
  expect(shell()!.style.left).toBe("376px");
  expect(shell()!.style.top).toBe("120px");
  expect(shell()!.style.getPropertyValue("--zt-pinned-max-height")).toBe(
    "400px",
  );
});

it("stays inside the box's height, and stands right of a box at the left edge", async () => {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(288);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
  const { anchor, handle, shell } = mount(undefined, { beside: panel(0) });
  vi.spyOn(anchor.current!, "getBoundingClientRect").mockReturnValue(
    new DOMRect(8, 420, 300, 28),
  );
  await act(() => handle.current!.show());
  // 0 + 320 + 8
  expect(shell()!.style.left).toBe("328px");
  // The box ends at 450: 450 − 200.
  expect(shell()!.style.top).toBe("250px");
});

it("asks onEscape first, and closes on an Escape it leaves", async () => {
  let take = true;
  const { app, handle, shell } = mount(undefined, { onEscape: () => take });
  await act(() => handle.current!.show());
  const pressed = pressTop(app, { key: "Escape" }, shell()!);
  expect(pressed.defaultPrevented).toBe(true);
  expect(shell()!.isConnected).toBe(true);
  take = false;
  await act(() => {
    pressTop(app, { key: "Escape" }, shell()!);
  });
  expect(shell()).toBeNull();
});

it("leaves Escape to an input method composing", async () => {
  const { app, handle, shell } = mount();
  await act(() => handle.current!.show());
  const pressed = pressTop(app, { key: "Escape", isComposing: true }, shell()!);
  expect(pressed.defaultPrevented).toBe(false);
  expect(shell()).not.toBeNull();
});

it("leaves focus where it is as it opens, with initialFocus off", async () => {
  const { anchor, handle } = mount(undefined, { initialFocus: false });
  anchor.current!.focus();
  await act(() => handle.current!.show());
  expect(document.activeElement).toBe(anchor.current);
});

it("lets the page hear its page keys, which no hotkey behind it takes", async () => {
  const hotkey = vi.fn(() => false);
  const { app, handle, shell } = mount(undefined, {
    pageKeys: [{ modifiers: ["Ctrl"], key: "Enter" }],
  });
  app.scope.register(["Ctrl"], "Enter", hotkey);
  await act(() => handle.current!.show());
  const heard = vi.fn();
  shell()!.addEventListener("keydown", heard);
  const pressed = pressTop(app, { key: "Enter", ctrlKey: true }, shell()!);
  expect(hotkey).not.toHaveBeenCalled();
  expect(pressed.defaultPrevented).toBe(false);
  expect(heard).toHaveBeenCalledTimes(1);
});

/**
 * A pointer press outside the popover on `target`, as the browser runs it:
 * the press, then the focus change its mousedown makes, which leaves no
 * element focused on a place that takes no focus.
 */
async function pressOutside(target: HTMLElement) {
  await act(() => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    if (target.tabIndex >= 0) target.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  });
  await new Promise((resolve) => target.win.setTimeout(resolve, 0));
}

// #1964: a press outside returns focus to the action, unless it gave focus
// to the place it pressed.
it("closes on a press outside, and hands focus to its anchor when the press focused nothing", async () => {
  const { anchor, handle, shell } = mount();
  await act(() => handle.current!.show());
  shell()!.querySelector("input")!.focus();
  const heading = document.body.appendChild(document.createElement("h2"));
  await pressOutside(heading);
  expect(shell()).toBeNull();
  expect(document.activeElement).toBe(anchor.current);
  heading.remove();
});

it("closes on a press outside, and leaves focus on the focusable place pressed", async () => {
  const { handle, shell } = mount();
  await act(() => handle.current!.show());
  shell()!.querySelector("input")!.focus();
  const other = document.body.appendChild(document.createElement("button"));
  await pressOutside(other);
  expect(shell()).toBeNull();
  expect(document.activeElement).toBe(other);
  other.remove();
});
