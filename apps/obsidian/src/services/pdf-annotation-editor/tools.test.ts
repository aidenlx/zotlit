import { expect, expectTypeOf, it } from "vitest";

import { resolveToolColors, textToolOf } from "./tools";
import type { TextTool } from "./tools";

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
  expectTypeOf<"ink">().not.toExtend<TextTool>();
  expect(textToolOf("ink")).toBe("highlight");
});
