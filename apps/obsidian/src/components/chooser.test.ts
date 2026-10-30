// @vitest-environment happy-dom
// The Chooser mounts the state of one open with its popup. happy-dom has no
// popover, so these tests send the toggle events the browser sends.
import type { App } from "obsidian";
import { render } from "preact";
import { act } from "preact/test-utils";
import { createElement as h } from "react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { AppContext } from "@/lib/app-context";
import { editorApp } from "@/views/annot-view/__fixtures__/editor-app";

import { shimPopover } from "./__fixtures__/popover";
import { Chooser } from "./chooser";
import type { ChooserRow } from "./chooser-logic";

vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<typeof import("obsidian")>()),
  // A substring match, enough for a query to narrow the rows.
  prepareFuzzySearch: (query: string) => (text: string) =>
    text.includes(query) ? { score: 0, matches: [] } : null,
}));

const ROWS: ChooserRow[] = [
  { value: "method", label: "method" },
  { value: "theory", label: "theory" },
  { value: "review", label: "review" },
];

let host: HTMLElement | null = null;
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = null;
});

function mount(app: App, trigger: { blocked?: boolean } = {}) {
  host = document.body.appendChild(document.createElement("div"));
  const list = h(Chooser.List<ChooserRow>, {
    groups: [{ items: ROWS }],
    label: "Tags",
    children: (row: ChooserRow) =>
      h(Chooser.Item, { key: row.value, value: row.value }, row.label),
  });
  const ui: ReactNode = h(AppContext, {
    value: app,
    children: h(Chooser, {
      value: [],
      onValueChange: () => {},
      children: [
        h(Chooser.Trigger, { key: "trigger", ...trigger }, "Tags"),
        h(Chooser.Popup, {
          key: "popup",
          children: [
            h(Chooser.Input, {
              key: "input",
              placeholder: "Search",
              clearLabel: "Clear",
            }),
            list,
          ],
        }),
      ],
    }),
  });
  render(ui, host);
  const popup = host.querySelector<HTMLElement>("[popover]")!;
  const shim = shimPopover(popup);
  const toggle = (newState: "open" | "closed") =>
    newState === "open" ? shim.open() : shim.close();
  const field = () => popup.querySelector("input");
  const options = () =>
    [...popup.querySelectorAll<HTMLElement>('[role="option"]')].map(
      (option) => option.textContent,
    );
  const highlighted = () =>
    popup.querySelector<HTMLElement>("[data-highlighted]")?.textContent ?? null;
  const button = host.querySelector<HTMLButtonElement>("button")!;
  return { popup, button, toggle, field, options, highlighted };
}

it("keeps a blocked trigger in the tab order and cancels its press", () => {
  const { button } = mount(editorApp(), { blocked: true });
  expect(button.getAttribute("aria-disabled")).toBe("true");
  // Native `disabled` would drop it from the tab order and its tooltip.
  expect(button.disabled).toBe(false);
  // A cancelled click is what keeps the popover invoker from opening.
  const press = new MouseEvent("click", { bubbles: true, cancelable: true });
  button.dispatchEvent(press);
  expect(press.defaultPrevented).toBe(true);
});

it("leaves the press of a trigger that is not blocked to the popover", () => {
  const { button } = mount(editorApp());
  expect(button.hasAttribute("aria-disabled")).toBe(false);
  const press = new MouseEvent("click", { bubbles: true, cancelable: true });
  button.dispatchEvent(press);
  expect(press.defaultPrevented).toBe(false);
});

it("names its list box with no tooltip over the rows", async () => {
  const { popup, toggle } = mount(editorApp());
  await toggle("open");
  const list = popup.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(list.hasAttribute("aria-label")).toBe(false);
  const name = list.getAttribute("aria-labelledby")!;
  expect(popup.ownerDocument.getElementById(name)?.textContent).toBe("Tags");
});

it("draws its rows only while the popup is open", async () => {
  const app = editorApp();
  const { toggle, field, options } = mount(app);
  expect(field()).toBeNull();
  expect(app.scopes).toHaveLength(0);
  await toggle("open");
  expect(options()).toEqual(["method", "theory", "review"]);
  expect(app.scopes).toHaveLength(1);
  await toggle("closed");
  expect(options()).toEqual([]);
  expect(app.scopes).toHaveLength(0);
});

it("opens again with an empty search, every row and no highlight", async () => {
  const app = editorApp();
  const { toggle, field, options, highlighted } = mount(app);
  await toggle("open");
  await act(() => {
    const input = field()!;
    input.value = "theory";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(options()).toEqual(["theory"]);
  expect(highlighted()).toBe("theory");
  await toggle("closed");

  await toggle("open");
  expect(field()!.value).toBe("");
  expect(field()!.getAttribute("aria-activedescendant")).toBeNull();
  expect(options()).toEqual(["method", "theory", "review"]);
  expect(highlighted()).toBeNull();
  expect(app.scopes).toHaveLength(1);
  // The next key starts from the first row, not from the last open's row.
  await act(() => {
    pressKey(app.scopes[0]!, "ArrowDown");
  });
  expect(highlighted()).toBe("method");
});

/**
 * A key through the Chooser's pushed scope, as the mock records it.
 * @returns `false` when the Chooser took the key, which then reaches nothing
 *   else.
 */
function pressKey(scope: unknown, key: string): unknown {
  const { handlers } = scope as {
    handlers: {
      modifiers: string[] | null;
      key: string | null;
      func: (event: KeyboardEvent) => unknown;
    }[];
  };
  return handlers
    .find((handler) => handler.key === key && !handler.modifiers?.length)
    ?.func(new KeyboardEvent("keydown", { key }));
}
