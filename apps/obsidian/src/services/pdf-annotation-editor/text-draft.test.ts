// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";

import { removeTextDraftArea } from "./text-draft";

afterEach(() => {
  document.body.empty();
});

/** A page as PDF.js builds it: a text layer it makes focusable, and a textarea over it. */
function draftPage() {
  const page = document.body.createDiv({ cls: "page" });
  const textLayer = page.createDiv({ cls: "textLayer" });
  textLayer.tabIndex = 0;
  const area = page.createEl("textarea");
  return { page, textLayer, area };
}

it("leaves the focus where the finish moved it", () => {
  const { area } = draftPage();
  const elsewhere = document.body.createEl("input");
  elsewhere.focus();

  removeTextDraftArea(area);

  expect(area.isConnected).toBe(false);
  expect(document.activeElement).toBe(elsewhere);
});

it("moves the focus it held to the page's text layer, so the next key reaches the reader", () => {
  const { textLayer, area } = draftPage();
  area.focus();

  removeTextDraftArea(area);

  expect(area.isConnected).toBe(false);
  expect(document.activeElement).toBe(textLayer);
});
