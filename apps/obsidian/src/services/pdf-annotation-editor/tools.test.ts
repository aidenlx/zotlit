import * as v from "valibot";
import { expect, expectTypeOf, it } from "vitest";

import {
  inkWidthSchema,
  isClickTool,
  resolveToolColors,
  selectionToolOf,
  textFontSizeSchema,
} from "./tools";
import type { ClickTool, SelectionTool } from "./tools";

it("starts ink on Zotero's fourth swatch and every other tool on its first", () => {
  // Zotero's reader: `ink: { color: ANNOTATION_COLORS[3][1] }`, the rest `[0]`.
  const colors = resolveToolColors();

  expect(colors.ink).toBe("#2ea8e5");
  expect(colors.highlight).toBe("#ffd400");
  expect(colors.image).toBe("#ffd400");
});

it("keeps a chosen ink colour over its default", () => {
  expect(resolveToolColors({ ink: "#e56eee" }).ink).toBe("#e56eee");
});

it("commits a text selection under the armed ink tool as a highlight", () => {
  expectTypeOf<"ink">().not.toExtend<SelectionTool>();
  expect(selectionToolOf("ink")).toBe("highlight");
});

it("refuses a stored ink width outside the offered steps", () => {
  expect(v.safeParse(inkWidthSchema, 4).success).toBe(false);
  expect(v.safeParse(inkWidthSchema, "2").success).toBe(false);
  expect(v.safeParse(inkWidthSchema, 0.5).success).toBe(false);
  expect(v.safeParse(inkWidthSchema, 0.4).success).toBe(true);
});

it("refuses a stored text font size outside the offered steps", () => {
  expect(v.safeParse(textFontSizeSchema, 16).success).toBe(false);
  expect(v.safeParse(textFontSizeSchema, "14").success).toBe(false);
  expect(v.safeParse(textFontSizeSchema, 24).success).toBe(true);
});

it.each(["note", "text"] as const)(
  "starts %s on Zotero's first swatch, and commits a text selection under it as a highlight",
  (tool) => {
    expectTypeOf<ClickTool>().not.toExtend<SelectionTool>();
    expect(resolveToolColors()[tool]).toBe("#ffd400");
    expect(isClickTool(tool)).toBe(true);
    expect(selectionToolOf(tool)).toBe("highlight");
  },
);
