import { expect, it } from "vitest";

import { expressionVocabulary } from "./expression-vocabulary";

it("types a receiver as the planner of the field's Query Dataset types it", () => {
  const items = expressionVocabulary({ dataset: "items" });
  expect(items.receiverType?.("title")).toBe("string");
  expect(items.receiverType?.("formula.missing")).toBeUndefined();
  const annotations = expressionVocabulary({ dataset: "annotations" });
  expect(annotations.receiverType?.("text")).toBe("string");
});

it("offers a field of the dataset, and no Formula, Query Context or vault property unless given", () => {
  const vocabulary = expressionVocabulary({ dataset: "items" });
  expect(vocabulary.fields.map((field) => field.path)).toContain("title");
  expect(vocabulary).toMatchObject({ context: false, formulas: [] });
  expect(vocabulary.vault).toBeUndefined();
});
