// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { expect, it } from "vitest";

import { m } from "@/paraglide/messages.js";

import { open } from "./page-test-host";

/** The side panel the page shows under `label`, or null. */
const region = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll<HTMLElement>("[role=region]")].find(
    (element) => element.getAttribute("aria-label") === label,
  ) ?? null;

const handle = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll<HTMLElement>("[role=separator]")].find(
    (element) => element.getAttribute("aria-label") === label,
  ) ?? null;

const action = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("header button")].find(
    (button) => button.textContent === label,
  )!;

const press = (element: HTMLElement, key: string) =>
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

// #1954: the web Workbench lays out the shared panels as Obsidian does.
it("starts with both panels shown, and shows and hides each from its header action", async () => {
  await using page = await open({ frame: { width: 1200, height: 700 } });
  await page.settle();
  const fields = action(page.host, m.workbench_show_fields());
  const preview = action(page.host, m.workbench_show_preview());
  expect(fields.getAttribute("aria-pressed")).toBe("true");
  expect(preview.getAttribute("aria-pressed")).toBe("true");
  expect(region(page.host, m.workbench_view_fields())).not.toBeNull();
  expect(region(page.host, m.workbench_view_preview())).not.toBeNull();
  page.press(m.workbench_show_preview());
  expect(preview.getAttribute("aria-pressed")).toBe("false");
  expect(region(page.host, m.workbench_view_preview())).toBeNull();
  page.press(m.workbench_show_fields());
  expect(fields.getAttribute("aria-pressed")).toBe("false");
  expect(region(page.host, m.workbench_view_fields())).toBeNull();
  page.press(m.workbench_show_preview());
  expect(region(page.host, m.workbench_view_preview())).not.toBeNull();
});

it("puts the Preview under the editor in a narrow frame and beside it in a wide one", async () => {
  await using page = await open({ frame: { width: 560, height: 700 } });
  await page.settle();
  const split = () => handle(page.host, m.workbench_preview_resize())!;
  expect(split().getAttribute("aria-orientation")).toBe("horizontal");
  // The template stays in view above the Preview.
  expect(
    page.host
      .querySelector("#workbench-edit-pane")
      ?.compareDocumentPosition(region(page.host, m.workbench_view_preview())!),
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  page.resizeFrame({ width: 1200, height: 700 });
  expect(split().getAttribute("aria-orientation")).toBe("vertical");
  // Resizing moved the Preview; both panels still show.
  expect(
    action(page.host, m.workbench_show_preview()).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    action(page.host, m.workbench_show_fields()).getAttribute("aria-pressed"),
  ).toBe("true");
});

it("sizes each panel with its handle", async () => {
  await using page = await open({ frame: { width: 1200, height: 700 } });
  await page.settle();
  const edge = handle(page.host, m.workbench_fields_resize())!;
  expect(edge.getAttribute("aria-valuenow")).toBe("288");
  press(edge, "ArrowRight");
  expect(edge.getAttribute("aria-valuenow")).toBe("304");
  page.resizeFrame({ width: 560, height: 700 });
  const split = handle(page.host, m.workbench_preview_resize())!;
  expect(split.getAttribute("aria-valuenow")).toBe("40");
  press(split, "ArrowUp");
  expect(split.getAttribute("aria-valuenow")).toBe("45");
});

/** The Fields picker's search field, on the popover over the page. */
const pickerSearch = () =>
  document.querySelector<HTMLInputElement>('[role="dialog"] [role="combobox"]');

/** The text of every editor on the page. */
const editorText = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>('[role="textbox"]')]
    .map((box) => EditorView.findFromDOM(box)?.state.doc.toString() ?? "")
    .join("\n");

// #1955: where the Fields column does not fit, Fields opens its picker.
it("opens the Fields picker from its header action in a narrow frame and inserts a field from the keyboard", async () => {
  await using page = await open({ frame: { width: 560, height: 700 } });
  await page.settle();
  const fields = action(page.host, m.workbench_show_fields());
  expect(region(page.host, m.workbench_view_fields())).toBeNull();
  expect(fields.getAttribute("aria-expanded")).toBe("false");
  expect(editorText(page.host)).not.toContain("zt.authors");
  page.press(m.workbench_show_fields());
  await page.settle();
  const search = pickerSearch()!;
  expect(search).not.toBeNull();
  expect(document.activeElement).toBe(search);
  expect(fields.getAttribute("aria-expanded")).toBe("true");
  press(search, "ArrowDown");
  const active = document.getElementById(
    search.getAttribute("aria-activedescendant")!,
  );
  expect(active?.textContent).toContain(m.workbench_field_authors());
  press(search, "Enter");
  await page.settle();
  expect(pickerSearch()).toBeNull();
  expect(editorText(page.host)).toContain("zt.authors");
  expect(page.host.textContent).toContain(
    m.workbench_fields_inserted({ field: m.workbench_field_authors() }),
  );
});

it("closes the Fields picker on Escape and returns focus to the Fields action", async () => {
  await using page = await open({ frame: { width: 560, height: 700 } });
  await page.settle();
  page.press(m.workbench_show_fields());
  await page.settle();
  press(pickerSearch()!, "Escape");
  await page.settle();
  expect(pickerSearch()).toBeNull();
  expect(document.activeElement).toBe(
    action(page.host, m.workbench_show_fields()),
  );
});

it("opens the Fields picker from an arrow or a printable key on the Fields action", async () => {
  await using page = await open({ frame: { width: 560, height: 700 } });
  await page.settle();
  const fields = action(page.host, m.workbench_show_fields());
  act(() => fields.focus());
  press(fields, "ArrowDown");
  await page.settle();
  expect(document.activeElement).toBe(pickerSearch());
  expect(pickerSearch()!.value).toBe("");
  // The action names the popover it controls while it stands.
  const popup = document.getElementById(fields.getAttribute("aria-controls")!);
  expect(popup?.contains(pickerSearch())).toBe(true);
  press(pickerSearch()!, "Escape");
  await page.settle();
  expect(fields.hasAttribute("aria-controls")).toBe(false);
  press(fields, "d");
  await page.settle();
  expect(pickerSearch()!.value).toBe("d");
  // End and Home reach the last and the first row.
  const active = () =>
    document.getElementById(
      pickerSearch()!.getAttribute("aria-activedescendant")!,
    );
  const rows = document.querySelectorAll('[role="dialog"] [role="option"]');
  press(pickerSearch()!, "End");
  expect(active()).toBe(rows[rows.length - 1]);
  press(pickerSearch()!, "Home");
  expect(active()).toBe(rows[0]);
});

it("closes the Fields picker when focus leaves it by keyboard", async () => {
  await using page = await open({ frame: { width: 560, height: 700 } });
  await page.settle();
  page.press(m.workbench_show_fields());
  await page.settle();
  const elsewhere = page.host.querySelector<HTMLElement>('[role="tab"]')!;
  act(() => elsewhere.focus());
  await page.settle();
  expect(pickerSearch()).toBeNull();
  expect(document.activeElement).toBe(elsewhere);
});

it("leaves the Fields picker closed as the frame narrows, and shows the column again as it widens", async () => {
  await using page = await open({ frame: { width: 1200, height: 700 } });
  await page.settle();
  page.resizeFrame({ width: 560, height: 700 });
  expect(region(page.host, m.workbench_view_fields())).toBeNull();
  expect(pickerSearch()).toBeNull();
  page.resizeFrame({ width: 1200, height: 700 });
  expect(region(page.host, m.workbench_view_fields())).not.toBeNull();
});

// #1956: the View menu sizes every handle without a drag, as the Obsidian
// view's pane menu does.
it("shows, sizes and resets each panel from the View menu", async () => {
  await using page = await open({ frame: { width: 1200, height: 700 } });
  await page.settle();
  const menuItem = (label: string) => {
    const item = [
      ...document.querySelectorAll<HTMLElement>(
        '[role="menu"] [role^="menuitem"]',
      ),
    ].find((element) => element.textContent === label);
    if (!item) throw new Error(`No menu entry reads '${label}'.`);
    return item;
  };
  /** The entry `label` in the group of the View menu named `group`. */
  const sizeItem = (group: string, label: string) => {
    const named = [
      ...document.querySelectorAll<HTMLElement>('[role="menu"] [role="group"]'),
    ].find(
      (element) =>
        document.getElementById(element.getAttribute("aria-labelledby")!)
          ?.textContent === group,
    );
    const item = [
      ...(named?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    ].find((element) => element.textContent === label);
    if (!item) throw new Error(`No entry '${label}' under '${group}'.`);
    return item;
  };
  const openView = async () => {
    page.press(m.workbench_view_menu());
    await page.waitFor(() =>
      expect(document.querySelector('[role="menu"]')).not.toBeNull(),
    );
  };
  await openView();
  expect(menuItem(m.workbench_show_fields()).getAttribute("aria-checked")).toBe(
    "true",
  );
  const fields = (label: string) =>
    sizeItem(m.workbench_fields_resize(), label);
  // A new page draws the Fields Panel at its default 288 px.
  expect(fields(m.workbench_panel_reset_width()).dataset.disabled).toBe("");
  act(() => fields(m.workbench_panel_wider()).click());
  const edge = handle(page.host, m.workbench_fields_resize())!;
  expect(edge.getAttribute("aria-valuenow")).toBe("352");
  // The menu stays open, so the reader can pick the next step.
  act(() => fields(m.workbench_panel_reset_width()).click());
  expect(edge.getAttribute("aria-valuenow")).toBe("288");
  page.resizeFrame({ width: 560, height: 700 });
  await page.waitFor(() =>
    expect(
      sizeItem(m.workbench_preview_resize(), m.workbench_panel_shorter()),
    ).toBeTruthy(),
  );
  act(() =>
    sizeItem(m.workbench_preview_resize(), m.workbench_panel_shorter()).click(),
  );
  expect(
    handle(page.host, m.workbench_preview_resize())!.getAttribute(
      "aria-valuenow",
    ),
  ).toBe("30");
  act(() => menuItem(m.workbench_show_preview()).click());
  expect(region(page.host, m.workbench_view_preview())).toBeNull();
});
