import { expect, it } from "vitest";

import { expressionVocabulary } from "./expression-vocabulary";

/** The type the vocabulary gives the receiver `text`, standing alone. */
const typeOf = (
  vocabulary: ReturnType<typeof expressionVocabulary>,
  text: string,
) => vocabulary.receiver?.(text, { from: 0, to: text.length })?.type;

it("types a receiver as the planner of the field's Query Dataset types it", () => {
  const items = expressionVocabulary({ dataset: "items" });
  expect(typeOf(items, "title")).toBe("string");
  expect(
    items.receiver?.("formula.missing", { from: 0, to: 15 }),
  ).toBeUndefined();
  const annotations = expressionVocabulary({ dataset: "annotations" });
  expect(typeOf(annotations, "text")).toBe("string");
});

it("types another Formula by its planned result, and this by the Query Context", () => {
  const vocabulary = expressionVocabulary({
    dataset: "items",
    formulas: { added: "dateAdded" },
    context: true,
  });
  expect(vocabulary.formulas.map(({ name }) => name)).toEqual(["added"]);
  expect(typeOf(vocabulary, "formula.added")).toBe("date");
  expect(typeOf(vocabulary, "this.item")).toBe("record");
  expect(
    typeOf(expressionVocabulary({ dataset: "items" }), "this.item"),
  ).toBeUndefined();
});

it("offers the custom fields it is given at the path its dataset reads them by", () => {
  expect(
    expressionVocabulary({ dataset: "items", custom: ["Shelf"] }).custom,
  ).toEqual({ path: "custom", names: ["Shelf"] });
  expect(
    expressionVocabulary({ dataset: "annotations", custom: ["Shelf"] }).custom,
  ).toEqual({ path: "item.custom", names: ["Shelf"] });
});

it("offers a field of the dataset, and no Formula, Query Context or vault property unless given", () => {
  const vocabulary = expressionVocabulary({ dataset: "items" });
  expect(vocabulary.fields.map((field) => field.path)).toContain("title");
  expect(vocabulary).toMatchObject({ context: false, formulas: [] });
  expect(vocabulary.vault).toBeUndefined();
});
