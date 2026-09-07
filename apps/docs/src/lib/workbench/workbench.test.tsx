// @vitest-environment happy-dom
import { act } from "react";
import { expect, it } from "vitest";

import { m } from "@zotlit/workbench/ui";

import { open } from "./page-test-host";
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
