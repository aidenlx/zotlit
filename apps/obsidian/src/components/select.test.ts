// @vitest-environment happy-dom
// The Select is a Chooser that keeps one value. happy-dom has no popover, so
// these tests stand in for the browser's toggle events.
import { render } from "preact";
import { act } from "preact/test-utils";
import { createElement as h } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { AppContext } from "@/lib/app-context";
import { editorApp } from "@/views/annot-view/__fixtures__/editor-app";

import { shimPopover } from "./__fixtures__/popover";
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
  render(
    h(AppContext, {
      value: editorApp(),
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
  const popup = slot.querySelector<HTMLElement>("[popover]")!;
  shimPopover(popup);
  const hide = vi.spyOn(popup, "hidePopover");
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
    [...popup.querySelectorAll<HTMLElement>('[role="option"]')].map(
      (row) => row.textContent,
    );
  return { trigger, popup, outside, hide, key, rows };
}

it("opens searching for a printable key, on its first match", async () => {
  const { trigger, popup, key, rows } = mount();
  await key({ key: "v" });
  expect(popup.querySelector("input")!.value).toBe("v");
  expect(rows()).toEqual(["Volumevolume"]);
  const list = popup.querySelector('[role="listbox"]')!;
  expect(list.getAttribute("aria-activedescendant")).toBe(
    popup.querySelector('[role="option"]')!.id,
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
  expect(popup.querySelector("input")).toBeNull();
  expect(trigger.hasAttribute("aria-controls")).toBe(false);
});

it("shuts when focus leaves for its trigger by keyboard, not by a press", async () => {
  const { trigger, popup, hide, key } = mount();
  await key({ key: "ArrowDown" });
  const field = popup.querySelector("input")!;
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
  expect(hide).not.toHaveBeenCalled();
  document.dispatchEvent(new PointerEvent("pointerup"));
  // Shift+Tab onto the trigger shuts it, as it shuts a native select's list.
  await leave(trigger);
  expect(hide).toHaveBeenCalledOnce();
});

it("shuts when focus leaves for elsewhere", async () => {
  const { popup, outside, hide, key } = mount();
  await key({ key: "ArrowDown" });
  await act(() => {
    popup
      .querySelector("input")!
      .dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }),
      );
  });
  expect(hide).toHaveBeenCalledOnce();
});

it("hides a raw id that repeats the name", async () => {
  const { key, rows } = mount();
  await key({ key: "ArrowDown" });
  expect(rows()).toEqual(["title", "Date AddeddateAdded", "Volumevolume"]);
});

it("reports a picked row and hands focus back to the trigger", async () => {
  const onChange = vi.fn();
  const { trigger, popup, hide, key } = mount(onChange);
  await key({ key: "ArrowDown" });
  await act(() => {
    popup.querySelector<HTMLElement>('[data-value="volume"]')!.click();
  });
  expect(onChange).toHaveBeenCalledWith("volume");
  expect(hide).toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
});

it("hands focus back to the trigger when it shuts from its search field", async () => {
  const { trigger, popup, key } = mount();
  await key({ key: "ArrowDown" });
  expect(document.activeElement).toBe(popup.querySelector("input"));
  // Escape, or a press outside, shuts the popover without a pick.
  await act(() => popup.hidePopover());
  expect(document.activeElement).toBe(trigger);
});
