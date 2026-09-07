// @vitest-environment happy-dom
import { act } from "react";
import { expect, it, vi } from "vitest";

import { m } from "@zotlit/workbench/ui";

import { open, openMenu } from "./page-test-host";
import { WEB_THEME } from "./theme";

it("mounts the shared editor with the web theme and its searchable Base UI chooser", async () => {
  using page = open();
  await page.settle();
  expect(page.host.querySelector('[data-part="tab-bar"]')?.className).toBe(
    WEB_THEME.classes?.tabBar?.["tab-bar"],
  );
  expect(page.host.querySelector('[data-part="note-pane"]')?.className).toBe(
    WEB_THEME.classes?.notePane?.["note-pane"],
  );
  await page.waitFor(() =>
    expect(page.host.querySelector('[role="document"]')?.textContent).toContain(
      "Why Most Published Research Findings Are False",
    ),
  );
  page.press(m.workbench_choose_paper());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  expect(dialog.querySelector('[role="combobox"]')).not.toBeNull();
  expect(dialog.textContent).toContain("Thinking, fast and slow");
  await act(async () => {
    dialog
      .querySelector('[role="combobox"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await page.waitFor(() =>
    expect(document.activeElement).toBe(
      page.host.querySelector("#workbench-sample"),
    ),
  );
});

it("hands a Default copy from the Profile menu to the native import flow", async () => {
  using page = open();
  await page.settle();
  const copies: string[] = [];
  using _copy = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockImplementation(async (source) => {
      copies.push(source);
    });
  const urls: string[] = [];
  using _click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      urls.push(this.href);
    });
  openMenu(page.host);
  await page.waitFor(() =>
    expect(document.querySelector('[role="menu"]')).not.toBeNull(),
  );
  const handoff = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent?.includes(m.workbench_open_obsidian()))!;
  await act(async () => handoff.click());
  expect(copies).toHaveLength(1);
  expect(copies[0]).not.toContain("id: default");
  expect(urls).toEqual(["obsidian://zotlit/import-profile?clipboard=true"]);
  expect(page.host.textContent).toContain(m.workbench_open_obsidian_copied());
});
