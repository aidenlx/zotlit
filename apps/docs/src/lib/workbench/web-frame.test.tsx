// @vitest-environment happy-dom
// Browser viewport folds and the web field sheet, including focus return.
import { act } from "react";
import { describe, expect, it } from "vitest";

import { m } from "@zotlit/workbench/ui";

import {
  KEY,
  open,
  press,
  fieldRow,
  resize,
  openSheet,
  chosenView,
} from "./page-test-host";

describe("the narrow layout", () => {
  it("carries the result on a tab of its own", () => {
    using page = open();

    // The pane opens the page; the result is the one tap beside it.
    expect(chosenView(page.host)).toBe(m.workbench_view_editor());
    page.press(m.workbench_view_result());
    expect(chosenView(page.host)).toBe(m.workbench_view_result());
    // The tabs the wide layout offers stay where they were.
    expect(page.host.textContent).toContain(m.workbench_tab_properties());
  });

  it("inserts from the field sheet where the column would, then closes", async () => {
    using page = open();
    // The list waits for the same Temporal the render does.
    await page.settle();

    page.press(m.workbench_add_field());
    const sheet = openSheet(page.host);
    expect(sheet.textContent).toContain(m.workbench_fields_heading());

    const snippet = "{{ zt.title }}";
    press(
      fieldRow(sheet, m.workbench_field_title()),
      m.workbench_fields_put_in_note(),
    );

    // The sheet leaves with the snippet it put in the note.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await page.settle();
    expect(JSON.parse(localStorage.getItem(KEY)!).source).toContain(snippet);
  });

  it("carries the reader back to the pane when Advanced opens", () => {
    using page = open();

    page.press(m.workbench_view_result());
    page.press(m.workbench_advanced());

    // Advanced stands inside the pane, so a press made from the result tab
    // shows what it opened.
    expect(chosenView(page.host)).toBe(m.workbench_view_editor());
    expect(page.host.textContent).toContain(m.workbench_advanced_heading());
  });

  it("returns to the editor when Basic is selected", () => {
    using page = open();

    page.press(m.workbench_advanced());
    page.press(m.workbench_view_result());
    page.press(m.workbench_basic());

    // Basic reveals the section the reader was editing.
    expect(chosenView(page.host)).toBe(m.workbench_view_editor());
  });

  it("returns the keyboard to the button the field sheet was opened from", async () => {
    using page = open();

    page.press(m.workbench_add_field());
    press(openSheet(page.host), m.workbench_fields_close());

    const button = [...page.host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === m.workbench_add_field(),
    );
    await page.waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("leaves the field sheet on Escape", () => {
    using page = open();

    page.press(m.workbench_add_field());
    expect(openSheet(page.host)).not.toBeNull();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("returns a widened window to the pane", () => {
    resize(375);
    using page = open();

    page.press(m.workbench_view_result());
    expect(chosenView(page.host)).toBe(m.workbench_view_result());

    // Past the threshold the two tabs are gone, so the result reads as chosen
    // on a screen carrying no tab that says so.
    resize(900);

    expect(chosenView(page.host)).toBe(m.workbench_view_editor());
  });
});
