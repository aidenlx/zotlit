import type { DisplayNode } from "#/explorer/index";
import { describe, expect, it } from "vitest";

import { fieldValueText } from "./explorer-fields";

import { buildDisplayTree } from "#/explorer/index";
import { withText } from "#/explorer/test-records";

function shapeNodes(): { authors: DisplayNode; family: DisplayNode } {
  const [authors] = buildDisplayTree(
    {
      authors: [
        withText({ family: "Rivera", given: "Mara" }, "Mara Rivera"),
        withText({ family: "Chen", given: "Li" }, "Li Chen"),
      ],
    },
    { expanded: new Set(["authors"]), lists: "shape" },
  );
  if (authors?.kind !== "value" || !authors.children) throw new Error("shape");
  return { authors, family: authors.children[0]! };
}

describe("fieldValueText", () => {
  it("shows a list and a list property with every item in one line", () => {
    const { authors, family } = shapeNodes();
    expect(fieldValueText(authors)).toBe("Mara Rivera, Li Chen");
    expect(fieldValueText(family)).toBe("Rivera, Chen");
  });
});
