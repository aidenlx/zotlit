// @vitest-environment happy-dom
// The Select is a Chooser that keeps one value. Its popup is a pinned popover
// on the document's body, so a test finds it there while it is open.
import { render } from "preact";
import { act } from "preact/test-utils";
import { createElement as h } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { pressTop } from "@/lib/__fixtures__/keymap";
import { AppContext } from "@/lib/app-context";
import { editorApp } from "@/views/annot-view/__fixtures__/editor-app";

import { Select } from "./select";
import type { SelectOption } from "./select";

vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<typeof import("obsidian")>()),
  // A substring match, enough for a query to narrow the rows.
  prepareFuzzySearch: (query: string) => (text: string) =>
    text.includes(query) ? { score: 0, matches: [] } : null,
}));

const OPTIONS: SelectOption[] = [
  { value: "title", label: "title", detail: "title" },
  { value: "dateAdded", label: "Date Added", detail: "dateAdded" },
  { value: "volume", label: "Volume", detail: "volume" },
];

let host: HTMLElement | null = null;
let slot: HTMLElement | null = null;
afterEach(() => {
  if (slot) render(null, slot);
  host?.remove();
  host = null;
  slot = null;
});

function mount(onChange: (next: string) => void = () => {}) {
  host = document.body.appendChild(document.createElement("div"));
  const outside = host.appendChild(document.createElement("button"));
  slot = host.appendChild(document.createElement("div"));
  const app = editorApp();
  render(
    h(AppContext, {
      value: app,
      children: h(Select, {
        "aria-label": "Sort by",
        value: "title",
        onChange,
        options: OPTIONS,
      }),
    }),
    slot,
  );
  const trigger = slot.querySelector<HTMLButtonElement>("button")!;
  const popup = () =>
    document.querySelector<HTMLElement>("[data-select-popup]");
  const key = (init: KeyboardEventInit) =>
    act(() => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    });
  const rows = () =>
    [...popup()!.querySelectorAll<HTMLElement>('[role="option"]')].map(
      (row) => row.textContent,
    );
  return { app, host, trigger, popup, outside, key, rows };
}

it("opens searching for a printable key, on its first match", async () => {
  const { trigger, popup, key, rows } = mount();
  await key({ key: "v" });
  expect(popup()!.querySelector("input")!.value).toBe("v");
  expect(rows()).toEqual(["Volumevolume"]);
  const list = popup()!.querySelector('[role="listbox"]')!;
  expect(list.getAttribute("aria-activedescendant")).toBe(
    popup()!.querySelector('[role="option"]')!.id,
  );
  expect(trigger.getAttribute("aria-controls")).toBe(list.id);
  // The list takes the field's name; an `aria-label` would be a hover tooltip.
  expect(
    document.getElementById(list.getAttribute("aria-labelledby")!)!.textContent,
  ).toBe("Sort by");
  expect(list.hasAttribute("aria-label")).toBe(false);
});

it("leaves a shortcut and Space to the trigger", async () => {
  const { trigger, popup, key } = mount();
  await key({ key: "v", ctrlKey: true });
  await key({ key: " " });
  expect(popup()).toBeNull();
  expect(trigger.hasAttribute("aria-controls")).toBe(false);
});

it("shuts when focus leaves for its trigger by keyboard, not by a press", async () => {
  const { trigger, popup, key } = mount();
  await key({ key: "ArrowDown" });
  const field = popup()!.querySelector("input")!;
  const leave = (to: Element) =>
    act(() => {
      field.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: to }),
      );
    });
  // A press on the trigger moves focus there and is the popover's to answer.
  await act(() => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await leave(trigger);
  expect(popup()).not.toBeNull();
  document.dispatchEvent(new PointerEvent("pointerup"));
  // Shift+Tab onto the trigger shuts it, as it shuts a native select's list.
  await leave(trigger);
  expect(popup()).toBeNull();
});

it("shuts when focus leaves for elsewhere", async () => {
  const { popup, outside, key } = mount();
  await key({ key: "ArrowDown" });
  await act(() => {
    popup()!
      .querySelector("input")!
      .dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }),
      );
  });
  expect(popup()).toBeNull();
});

it("keeps undo in its search field, out of a surface around it that steps a history of its own", async () => {
  const { app, host, trigger, popup, key } = mount();
  const surface = vi.fn();
  host!.addEventListener("keydown", (event) => {
    if (event.key === "z") surface();
  });
  await key({ key: "ArrowDown" });
  const field = popup()!.querySelector("input")!;

  // The Chooser's Scope stands on top and leaves undo alone, so the field's
  // own undo runs and the surface never hears the key.
  for (const init of [
    { key: "z", ctrlKey: true },
    { key: "z", ctrlKey: true, shiftKey: true },
    { key: "y", metaKey: true },
  ]) {
    const event = pressTop(app, init, field);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(surface).not.toHaveBeenCalled();

  // Off the popup, the key is the surface's.
  await act(() => {
    pressTop(app, { key: "z", ctrlKey: true }, trigger);
  });
  expect(surface).toHaveBeenCalledOnce();
});

it("hides a raw id that repeats the name", async () => {
  const { key, rows } = mount();
  await key({ key: "ArrowDown" });
  expect(rows()).toEqual(["title", "Date AddeddateAdded", "Volumevolume"]);
});

it("reports a picked row and hands focus back to the trigger", async () => {
  const onChange = vi.fn();
  const { trigger, popup, key } = mount(onChange);
  await key({ key: "ArrowDown" });
  await act(() => {
    popup()!.querySelector<HTMLElement>('[data-value="volume"]')!.click();
  });
  expect(onChange).toHaveBeenCalledWith("volume");
  expect(popup()).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("hands focus back to the trigger when it shuts from its search field", async () => {
  const { trigger, popup, key } = mount();
  await key({ key: "ArrowDown" });
  expect(document.activeElement).toBe(popup()!.querySelector("input"));
  // Escape, or a press outside, shuts the popover without a pick.
  await act(() => {
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
  });
  expect(document.activeElement).toBe(trigger);
});
