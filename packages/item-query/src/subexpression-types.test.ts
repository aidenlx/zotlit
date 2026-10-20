import { describe, expect, it } from "vitest";

import { ANNOTATIONS } from "./query-annotations";
import { ITEMS } from "./query-items";
import { subexpressionTypes } from "./subexpression-types";

/** The type of the subexpression `part` of `text`, at its first occurrence. */
function typeOf(
  types: ReturnType<typeof subexpressionTypes>,
  text: string,
  part = text,
) {
  const from = text.indexOf(part);
  return types(text, { from, to: from + part.length });
}

const names = (type: ReturnType<typeof typeOf>) =>
  type?.members?.map(({ name }) => name);

describe("subexpression types", () => {
  it("types a field and leaves a text that does not plan untyped", () => {
    const types = subexpressionTypes(ITEMS);
    expect(typeOf(types, "title")).toEqual({ valueType: "string" });
    expect(typeOf(types, "(title +")).toBeUndefined();
  });

  it("types formula.<name> by the other Formula's planned result", () => {
    const types = subexpressionTypes(ITEMS, {
      formulas: { short: "title.slice(0, 10)", broken: "title +" },
    });
    expect(typeOf(types, "formula.short")).toEqual({ valueType: "string" });
    expect(typeOf(types, "formula.broken")).toBeUndefined();
    expect(typeOf(subexpressionTypes(ITEMS), "formula.short")).toBeUndefined();
  });

  it("types this.item as a record with its keys where the view binds a Query Context", () => {
    const type = typeOf(
      subexpressionTypes(ITEMS, { context: true }),
      "this.item",
    );
    expect(type?.valueType).toBe("record");
    expect(names(type)?.toSorted()).toEqual(["indexedKey", "key"]);
    expect(typeOf(subexpressionTypes(ITEMS), "this.item")).toBeUndefined();
  });

  it("types a bound name where its list method binds it", () => {
    const types = subexpressionTypes(ITEMS);
    // Alone, `value` is a custom field of text.
    expect(typeOf(types, "value")).toEqual({ valueType: "string" });
    expect(typeOf(types, "tags.filter(value)", "value")).toEqual({
      valueType: "unknown",
    });
    expect(
      names(typeOf(types, "attachments.filter(value)", "value")),
    ).toContain("fileType");
  });

  it("lists the members a filter reads on a record, without custom fields", () => {
    const item = typeOf(subexpressionTypes(ANNOTATIONS), "item");
    expect(item?.members).toContainEqual({
      name: "title",
      valueType: "string",
    });
    // An Annotation's own field names no member of its Item.
    expect(names(item)).not.toContain("comment");
    for (const name of names(item)!)
      expect(ANNOTATIONS.planFilter(`item.${name}`), name).toHaveProperty(
        "root",
      );
  });

  it("does not read into another Formula's text", () => {
    const types = subexpressionTypes(ITEMS, { formulas: { t: "title" } });
    // `formula.t` spans 0–9; the Formula's own `title` spans 0–5 of its text.
    expect(typeOf(types, "formula.t", "formul")).toBeUndefined();
  });
});
