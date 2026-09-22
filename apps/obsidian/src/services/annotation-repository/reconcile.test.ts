import { expect, it } from "vitest";

import { resolvesSilently } from "./reconcile";

it("resolves a colour silently only where the two name the same swatch", () => {
  expect(resolvesSilently("color", "#FF6666", "#ff6666")).toBe(true);
  expect(resolvesSilently("color", "#ff6666", "#5fb236")).toBe(false);
  expect(resolvesSilently("color", "#ff6666", null)).toBe(false);
});

it("resolves a cleared comment silently against the comment Zotero kept none of", () => {
  expect(resolvesSilently("comment", "", null)).toBe(true);
  expect(resolvesSilently("comment", "same words", "same words")).toBe(true);
  expect(resolvesSilently("comment", "my words", "their words")).toBe(false);
});

it("never resolves a delete silently, because it names no value to compare", () => {
  expect(resolvesSilently("delete", null, null)).toBe(false);
});
