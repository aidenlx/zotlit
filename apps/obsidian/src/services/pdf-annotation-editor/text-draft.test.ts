// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import { editorApp } from "@/views/annot-view/__fixtures__/editor-app";

import { dispatchKey } from "./__fixtures__";
import { createTextDraftArea, removeTextDraftArea } from "./text-draft";

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

it("finishes on Escape through a Scope of its own while it holds focus, and gives the Scope back", () => {
  const app = editorApp();
  const finish = vi.fn();
  const area = document.body.appendChild(
    createTextDraftArea(document, { input: vi.fn(), finish }, app),
  );
  expect(app.scopes).toEqual([]);

  area.focus();
  expect(app.scopes).toHaveLength(1);
  // The PDF view's own Scope, beneath, never hears the key.
  const escape = dispatchKey(app.scopes[0]!, { key: "Escape" }, area);
  expect(escape.defaultPrevented).toBe(true);
  expect(finish).toHaveBeenCalledOnce();

  // A key typed into a composition stays the input method's.
  dispatchKey(app.scopes[0]!, { key: "Escape", isComposing: true }, area);
  expect(finish).toHaveBeenCalledOnce();

  area.blur();
  expect(app.scopes).toEqual([]);
});

it("gives the Scope back when the draft goes while it holds focus", () => {
  const app = editorApp();
  const page = document.body.createDiv({ cls: "page" });
  const area = page.appendChild(
    createTextDraftArea(document, { input: vi.fn(), finish: vi.fn() }, app),
  );
  area.focus();
  expect(app.scopes).toHaveLength(1);

  removeTextDraftArea(area);

  expect(app.scopes).toEqual([]);
});
