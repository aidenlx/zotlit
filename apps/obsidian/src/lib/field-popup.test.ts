// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";

import { FIELD_POPUP_ATTRIBUTE } from "@zotlit/workbench/language";

import { fieldPopupStands } from "./field-popup";

afterEach(() => document.body.replaceChildren());

/** A focused field in a surface, with `attrs` on it. */
function field(attrs: Record<string, string>) {
  const surface = document.body.appendChild(document.createElement("div"));
  const input = surface.appendChild(document.createElement("div"));
  input.tabIndex = 0;
  for (const [name, value] of Object.entries(attrs))
    input.setAttribute(name, value);
  input.focus();
  return surface;
}

it("finds the focused field's typing list or Signature Hint standing", () => {
  expect(
    fieldPopupStands(
      field({ "aria-haspopup": "listbox", "aria-controls": "list" }),
    ),
  ).toBe(true);
  expect(fieldPopupStands(field({ [FIELD_POPUP_ATTRIBUTE]: "" }))).toBe(true);
});

it("finds none for a field without one, or a field outside the surface", () => {
  expect(fieldPopupStands(field({ "aria-haspopup": "listbox" }))).toBe(false);
  const other = document.body.appendChild(document.createElement("div"));
  field({ [FIELD_POPUP_ATTRIBUTE]: "" });
  expect(fieldPopupStands(other)).toBe(false);
});
