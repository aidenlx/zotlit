import { describe, expect, it } from "vitest";

import { type ItemTag, toTemplateTag } from "./zt-tag";

const itemTag = (name: string, type: ItemTag["type"]): ItemTag => ({
  itemID: 1,
  tag: { tagID: 10, name },
  type,
});

describe("toTemplateTag", () => {
  it("projects to a flat { name, type } shape without the Zotero-internal ids", () => {
    expect(toTemplateTag(itemTag("attribute processing", 0))).toEqual({
      name: "attribute processing",
      type: "manual",
    });
  });

  it("resolves the raw type int to its readable name", () => {
    expect(toTemplateTag(itemTag("nlp", 1)).type).toBe("auto");
  });

  it("coerces to the tag name in string contexts", () => {
    expect(String(toTemplateTag(itemTag("nlp", 1)))).toBe("nlp");
  });
});
