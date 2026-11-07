// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { expect, it } from "vitest";

import { DEFAULT_PROFILE_SOURCE, SAMPLE_ITEMS } from "@zotlit/workbench/render";

import { m } from "@/paraglide/messages.js";

import { chosenTab, keep, open } from "./page-test-host";

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
it("starts with the Preview shown and the Fields popover closed, and shows and hides the Preview from its header action", async () => {
  await using page = await open({ frame: { width: 1200, height: 700 } });
  await page.settle();
  const fields = action(page.host, m.workbench_view_fields());
  const preview = action(page.host, m.workbench_show_preview());
  expect(fields.getAttribute("aria-expanded")).toBe("false");
  expect(preview.getAttribute("aria-pressed")).toBe("true");
  expect(popover()).toBeNull();
  expect(region(page.host, m.workbench_view_preview())).not.toBeNull();
  page.press(m.workbench_show_preview());
  expect(preview.getAttribute("aria-pressed")).toBe("false");
  expect(region(page.host, m.workbench_view_preview())).toBeNull();
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
  // Resizing moved the Preview, which still shows, and opened no popover.
  expect(
    action(page.host, m.workbench_show_preview()).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(popover()).toBeNull();
});

// The Preview moves between the side and the place under the editor as one
// region, so what the reader was doing in it stays.
it("keeps focus and scroll in the Preview as it moves under the editor and back", async () => {
  await using page = await open({ frame: { width: 1200, height: 700 } });
  await page.settle();
  const shown = region(page.host, m.workbench_view_preview())!;
  const control = shown.querySelector<HTMLElement>("button")!;
  act(() => control.focus());
  page.resizeFrame({ width: 560, height: 700 });
  await page.settle();
  expect(
    handle(page.host, m.workbench_preview_resize())!.getAttribute(
      "aria-orientation",
    ),
  ).toBe("horizontal");
  expect(region(page.host, m.workbench_view_preview())).toBe(shown);
  expect(document.activeElement).toBe(control);
  page.resizeFrame({ width: 1200, height: 700 });
  await page.settle();
  expect(region(page.host, m.workbench_view_preview())).toBe(shown);
  expect(document.activeElement).toBe(control);
});

// A short view draws the Preview at less than its saved share; the split's
// keys step from the share the reader sees, as the View menu's entries do.
it("steps the split from the share a short view draws", async () => {
  await using page = await open({ frame: { width: 560, height: 500 } });
  await page.settle();
  const split = handle(page.host, m.workbench_preview_resize())!;
  // The editor keeps 320 of the 500 px, so the Preview draws 36%, not 40%.
  expect(split.getAttribute("aria-valuenow")).toBe("36");
  expect(split.getAttribute("aria-valuetext")).toBe("36%");
  expect(split.getAttribute("aria-valuemax")).toBe("36");
  press(split, "ArrowDown");
  expect(split.getAttribute("aria-valuenow")).toBe("31");
});

it("sizes the Preview with its handle", async () => {
  await using page = await open({ frame: { width: 1200, height: 700 } });
  await page.settle();
  const edge = handle(page.host, m.workbench_preview_resize())!;
  expect(edge.getAttribute("aria-valuenow")).toBe("400");
  press(edge, "ArrowLeft");
  expect(edge.getAttribute("aria-valuenow")).toBe("416");
  page.resizeFrame({ width: 560, height: 700 });
  const split = handle(page.host, m.workbench_preview_resize())!;
  expect(split.getAttribute("aria-valuenow")).toBe("40");
  press(split, "ArrowUp");
  expect(split.getAttribute("aria-valuenow")).toBe("45");
});

/** The Fields popover, while it stands open on the document's body. */
const popover = () =>
  document.querySelector<HTMLElement>(
    '[data-slot="popover-content"][role="dialog"]',
  );
/** The Fields popover's field search. */
const popoverSearch = () =>
  popover()?.querySelector<HTMLInputElement>('input[type="search"]') ?? null;
/** The Insert button of the top-level field `key` in the open popover. */
const insertButton = (key: string) =>
  popover()!.querySelector<HTMLElement>(
    `[data-workbench-field="${key}"] [role="button"][aria-label="${m.workbench_fields_put_in_note()}"]`,
  )!;

/** The text of every editor on the page. */
const editorText = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>('[role="textbox"]')]
    .map((box) => EditorView.findFromDOM(box)?.state.doc.toString() ?? "")
    .join("\n");

/** The note editor, with the caret the reader put at the end of its first line. */
const placeCaret = (host: HTMLElement) => {
  const note = [...host.querySelectorAll<HTMLElement>('[role="textbox"]')]
    .map((box) => EditorView.findFromDOM(box)!)
    .find((editor) => editor.state.doc.toString().includes("zt.title"))!;
  act(() => {
    note.focus();
    note.dispatch({ selection: { anchor: note.state.doc.line(1).to } });
  });
  return note;
};

// #1964: Fields opens the Fields popover at every width.
it.each([320, 560, 760, 960, 1200])(
  "opens the Fields popover from its header action in a %i px frame, and a second press closes it",
  async (width) => {
    await using page = await open({ frame: { width, height: 700 } });
    await page.settle();
    const fields = action(page.host, m.workbench_view_fields());
    page.press(m.workbench_view_fields());
    await page.settle();
    expect(popover()).not.toBeNull();
    expect(fields.getAttribute("aria-expanded")).toBe("true");
    expect(fields.getAttribute("aria-controls")).toBe(popover()!.id);
    expect(document.activeElement).toBe(popoverSearch());
    // A popover, not a modal: the editor and the Preview stay in reach.
    expect(popover()!.getAttribute("aria-modal")).not.toBe("true");
    expect(page.host.querySelector("[inert]")).toBeNull();
    page.press(m.workbench_view_fields());
    await page.settle();
    expect(popover()).toBeNull();
    expect(fields.getAttribute("aria-expanded")).toBe("false");
  },
);

it("inserts a field from the popover at the caret, closes the popover and leaves focus in the editor", async () => {
  await using page = await open({ frame: { width: 560, height: 700 } });
  await page.settle();
  const note = placeCaret(page.host);
  expect(editorText(page.host)).not.toContain("zt.authors");
  page.press(m.workbench_view_fields());
  await page.settle();
  act(() => insertButton("authors").click());
  await page.settle();
  expect(popover()).toBeNull();
  // The field goes where the reader left the caret.
  expect(note.state.doc.line(1).text).toContain("zt.authors");
  expect(note.hasFocus).toBe(true);
});

it("keeps the popover open for the next field on a Shift-click of Insert", async () => {
  await using page = await open({ frame: { width: 560, height: 700 } });
  await page.settle();
  const note = placeCaret(page.host);
  page.press(m.workbench_view_fields());
  await page.settle();
  act(() => {
    insertButton("authors").dispatchEvent(
      new MouseEvent("click", { bubbles: true, shiftKey: true }),
    );
  });
  await page.settle();
  expect(popover()).not.toBeNull();
  expect(note.state.doc.line(1).text).toContain("zt.authors");
  // The popover keeps the focus for the next field.
  expect(note.hasFocus).toBe(false);
  expect(popover()!.contains(document.activeElement)).toBe(true);
});

it("closes the Fields popover on Escape and on a press outside it, and returns focus to the Fields action", async () => {
  await using page = await open({ frame: { width: 560, height: 700 } });
  await page.settle();
  const fields = action(page.host, m.workbench_view_fields());
  page.press(m.workbench_view_fields());
  await page.settle();
  press(popoverSearch()!, "Escape");
  await page.settle();
  expect(popover()).toBeNull();
  expect(document.activeElement).toBe(fields);
  page.press(m.workbench_view_fields());
  await page.settle();
  // The Preview stands outside the popover.
  const outside = region(page.host, m.workbench_view_preview())!;
  act(() => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
      outside.dispatchEvent(
        new (type.startsWith("pointer") ? PointerEvent : MouseEvent)(type, {
          bubbles: true,
          button: 0,
        }),
      );
    outside.click();
  });
  await page.settle();
  expect(popover()).toBeNull();
  expect(document.activeElement).toBe(fields);
});

it("never opens the Fields popover as the frame narrows", async () => {
  await using page = await open({ frame: { width: 1200, height: 700 } });
  await page.settle();
  page.resizeFrame({ width: 320, height: 500 });
  await page.settle();
  expect(popover()).toBeNull();
});

// #1966: pinned, the Fields Panel docks at the leading edge of a wide frame,
// and the page keeps the pin and the width for its life.
it("docks the pinned Fields Panel in a wide frame, hides and shows it from its action, and opens the popover in a narrow one", async () => {
  await using page = await open({ frame: { width: 1400, height: 700 } });
  await page.settle();
  const fields = action(page.host, m.workbench_view_fields());
  const pin = (within: HTMLElement) =>
    within.querySelector<HTMLElement>(`[data-part="pin"]`)!;
  page.press(m.workbench_view_fields());
  await page.settle();
  expect(pin(popover()!).getAttribute("aria-label")).toBe(
    m.workbench_fields_pin(),
  );
  act(() => pin(popover()!).click());
  await page.settle();
  expect(popover()).toBeNull();
  const docked = () => region(page.host, m.workbench_view_fields());
  expect(docked()).not.toBeNull();
  expect(fields.getAttribute("aria-expanded")).toBe("true");
  // The docked panel stands before the editor, at the leading edge.
  expect(
    docked()!.compareDocumentPosition(
      page.host.querySelector("#workbench-edit-pane")!,
    ),
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  const edge = handle(page.host, m.workbench_fields_resize())!;
  press(edge, "ArrowRight");
  expect(edge.getAttribute("aria-valuenow")).toBe("336");
  page.press(m.workbench_view_fields());
  await page.settle();
  expect(docked()).toBeNull();
  expect(fields.getAttribute("aria-expanded")).toBe("false");
  page.press(m.workbench_view_fields());
  await page.settle();
  expect(docked()).not.toBeNull();
  // Too narrow to dock, the action opens the popover with the pin disabled.
  page.resizeFrame({ width: 560, height: 700 });
  await page.settle();
  expect(docked()).toBeNull();
  expect(popover()).toBeNull();
  page.press(m.workbench_view_fields());
  await page.settle();
  expect(pin(popover()!).getAttribute("aria-disabled")).toBe("true");
  expect(popover()!.textContent).toContain(m.workbench_fields_pinned_narrow());
  page.resizeFrame({ width: 1400, height: 700 });
  await page.settle();
  expect(popover()).toBeNull();
  expect(
    handle(page.host, m.workbench_fields_resize())!.getAttribute(
      "aria-valuenow",
    ),
  ).toBe("336");
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
    "false",
  );
  const preview = (label: string) =>
    sizeItem(m.workbench_preview_resize(), label);
  // A new page draws the Preview at its default 400 px.
  expect(preview(m.workbench_panel_reset_width()).dataset.disabled).toBe("");
  act(() => preview(m.workbench_panel_wider()).click());
  const edge = handle(page.host, m.workbench_preview_resize())!;
  expect(edge.getAttribute("aria-valuenow")).toBe("464");
  expect(edge.getAttribute("aria-valuetext")).toBe("464 pixels");
  // A menu entry moves no focus to the handle, so a status line says the
  // size it gave.
  const status = () =>
    page.host.querySelector('[data-part="panels"] > [role="status"]:last-child')
      ?.textContent;
  expect(status()).toBe("Preview: 464 pixels");
  // The menu stays open, so the reader can pick the next step.
  act(() => preview(m.workbench_panel_reset_width()).click());
  expect(edge.getAttribute("aria-valuenow")).toBe("400");
  // The resize moves the Preview under the editor, which changes the size
  // groups, so the menu closes; it opens again on the new groups.
  page.resizeFrame({ width: 560, height: 700 });
  await page.waitFor(() =>
    expect(document.querySelector('[role="menu"]')).toBeNull(),
  );
  await openView();
  expect(
    sizeItem(m.workbench_preview_resize(), m.workbench_panel_shorter()),
  ).toBeTruthy();
  act(() =>
    sizeItem(m.workbench_preview_resize(), m.workbench_panel_shorter()).click(),
  );
  expect(
    handle(page.host, m.workbench_preview_resize())!.getAttribute(
      "aria-valuenow",
    ),
  ).toBe("30");
  expect(status()).toBe("Preview: 30%");
  // The handle's own use leaves its value to the handle.
  press(handle(page.host, m.workbench_preview_resize())!, "ArrowUp");
  expect(status()).toBe("");
  act(() => menuItem(m.workbench_show_preview()).click());
  expect(region(page.host, m.workbench_view_preview())).toBeNull();
});

// The View menu presses the same Fields action as the header.
it("opens the Fields popover from the View menu's Show fields", async () => {
  await using page = await open({ frame: { width: 560, height: 700 } });
  await page.settle();
  page.press(m.workbench_view_menu());
  await page.waitFor(() =>
    expect(document.querySelector('[role="menu"]')).not.toBeNull(),
  );
  const show = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'),
  ].find((element) => element.textContent === m.workbench_show_fields())!;
  // The popover is closed, so the entry reads unchecked.
  expect(show.getAttribute("aria-checked")).toBe("false");
  act(() => show.click());
  await page.waitFor(() => expect(popoverSearch()).not.toBeNull());
  await page.settle();
  expect(document.activeElement).toBe(popoverSearch());
  expect(
    action(page.host, m.workbench_view_fields()).getAttribute("aria-expanded"),
  ).toBe("true");
});

/** A call, in the note, to a partial no vault holds. */
const MISSING_CALL = "{% render 'missing-details' %}";

/** The note editor's text under its selection. */
const selectedInNote = (host: HTMLElement) => {
  const note = [...host.querySelectorAll<HTMLElement>('[role="textbox"]')]
    .map((box) => EditorView.findFromDOM(box))
    .find((editor) => editor?.state.doc.toString().includes(MISSING_CALL))!;
  const { from, to } = note.state.selection.main;
  return note.state.sliceDoc(from, to);
};

// #1957: the preview's Show problem is the shared repair command, so the
// round trip is the same in a narrow and a wide frame.
it.each([
  { frame: { width: 560, height: 700 }, split: "horizontal" },
  { frame: { width: 1200, height: 700 }, split: "vertical" },
])(
  "reveals the call from the Preview's Show problem in a $frame.width px frame and keeps the Preview in place",
  async ({ frame, split }) => {
    keep(
      DEFAULT_PROFILE_SOURCE.replace(
        "# {{ zt.title }}",
        `# {{ zt.title }}\n${MISSING_CALL}`,
      ),
      SAMPLE_ITEMS[1]!,
    );
    await using page = await open({ frame });
    page.press(m.workbench_restore_accept());
    const shown = region(page.host, m.workbench_view_preview())!;
    await page.waitFor(() =>
      expect(shown.querySelector('[data-part="problem-open"]')).not.toBeNull(),
    );
    await page.settle();
    act(() =>
      shown
        .querySelector<HTMLButtonElement>('[data-part="problem-open"]')!
        .click(),
    );
    await page.settle();
    expect(page.host.textContent).toContain(m.workbench_problems_heading());
    expect(chosenTab(page.host)).toBe(m.workbench_tab_note());
    expect(selectedInNote(page.host)).toBe(MISSING_CALL);
    // Focus is on the call, so the Problems area's status says why it fails.
    expect(
      page.host.querySelector('[data-part="problems-announcement"]')
        ?.textContent,
    ).toContain("missing-details");
    expect(region(page.host, m.workbench_view_preview())).toBe(shown);
    expect(
      handle(page.host, m.workbench_preview_resize())!.getAttribute(
        "aria-orientation",
      ),
    ).toBe(split);
  },
);
