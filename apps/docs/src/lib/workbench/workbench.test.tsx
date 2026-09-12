import { act } from "react";
import { expect, it, vi } from "vitest";

import { createWorkbenchEditor } from "@zotlit/workbench/ui";

// @vitest-environment happy-dom
import { m } from "@/paraglide/messages.js";

import { open, openMenu, importFile, KEPT } from "./page-test-host";
import { WEB_THEME } from "./theme";

vi.mock("@zotlit/workbench/ui", async (original) => {
  const actual = await original<typeof import("@zotlit/workbench/ui")>();
  return {
    ...actual,
    createWorkbenchEditor: vi.fn(
      (...args: Parameters<typeof actual.createWorkbenchEditor>) => {
        const editor = actual.createWorkbenchEditor(...args);
        editor[Symbol.dispose] = vi.fn(editor[Symbol.dispose]);
        return editor;
      },
    ),
  };
});

it("renders editor examples and independent Preview after StrictMode replays effects", async () => {
  vi.mocked(createWorkbenchEditor).mockClear();
  await using page = await open({ strict: true });
  const owners = vi
    .mocked(createWorkbenchEditor)
    .mock.results.map((result) => result.value);
  expect(owners).toHaveLength(2);
  expect(owners[0]![Symbol.dispose]).toHaveBeenCalledOnce();
  expect(owners[1]![Symbol.dispose]).not.toHaveBeenCalled();
  await page.settle();
  page.press(m.workbench_tab_name_and_folder());
  await page.waitFor(() =>
    expect(
      page.host.querySelector('[data-part="filename-output"]')?.textContent,
    ).toBe("ioannidisWhyMost2005"),
  );
  await page.waitFor(() =>
    expect(page.host.querySelector('[role="document"]')?.textContent).toContain(
      "Why Most Published Research Findings Are False",
    ),
  );
  await page.show("NW2CPDTC");
  await page.settle();
  await page.waitFor(() =>
    expect(
      page.host.querySelector('[data-part="filename-output"]')?.textContent,
    ).toBe("Kahneman2011"),
  );
  await page.waitFor(() =>
    expect(page.host.querySelector('[role="document"]')?.textContent).toContain(
      "Thinking, fast and slow",
    ),
  );
});

it("releases the StrictMode editor owner when the page closes", async () => {
  vi.mocked(createWorkbenchEditor).mockClear();
  const page = await open({ strict: true });
  const owners = vi
    .mocked(createWorkbenchEditor)
    .mock.results.map((result) => result.value);
  await page[Symbol.asyncDispose]();
  expect(owners).toHaveLength(2);
  for (const owner of owners)
    expect(owner[Symbol.dispose]).toHaveBeenCalledOnce();
});

it("keeps independent Preview and Explorer choices when a new document opens", async () => {
  await using page = await open({ strict: true });
  await page.settle();
  const refresh = () =>
    [...page.host.querySelectorAll("label")]
      .find((label) =>
        label.textContent?.includes(m.workbench_preview_refresh()),
      )!
      .querySelector("select")!;
  act(() => {
    refresh().value = "demand";
    refresh().dispatchEvent(new Event("input", { bubbles: true }));
  });
  const section = () =>
    page.host.querySelector<HTMLButtonElement>('[data-part="section-header"]')!;
  expect(section().getAttribute("aria-expanded")).toBe("true");
  page.press(section().textContent!);
  importFile(page.host, KEPT);
  await page.waitFor(() =>
    expect(page.host.querySelector("h1")?.textContent).toBe("Kept work"),
  );
  expect(refresh().value).toBe("demand");
  expect(section().getAttribute("aria-expanded")).toBe("false");
});

it("shows filename and property examples for the current Sample Item", async () => {
  await using page = await open();
  await page.settle();
  for (const [key, filename, title] of [
    [
      null,
      "ioannidisWhyMost2005",
      "Why Most Published Research Findings Are False",
    ],
    ["NW2CPDTC", "Kahneman2011", "Thinking, fast and slow"],
  ] as const) {
    if (key) {
      await page.show(key);
      await page.settle();
    }
    page.press(m.workbench_tab_name_and_folder());
    await page.waitFor(() =>
      expect(
        page.host.querySelector('[data-part="filename-output"]')?.textContent,
      ).toBe(filename),
    );
    page.press(m.workbench_tab_properties());
    await page.waitFor(() =>
      expect(
        page.host.querySelector('[data-part="summary"]')?.textContent,
      ).toContain(title),
    );
    expect(page.host.textContent).not.toContain(
      m.workbench_properties_choose_item(),
    );
  }
});

it("mounts the shared editor with the web theme and its searchable Base UI chooser", async () => {
  await using page = await open();
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
  page.press(m.workbench_choose_item());
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
  await using page = await open();
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
