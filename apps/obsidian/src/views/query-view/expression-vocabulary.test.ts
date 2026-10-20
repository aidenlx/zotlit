import { expect, it } from "vitest";

import { expressionVocabulary } from "./expression-vocabulary";
import type { ViewProperties } from "./view-properties";

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
    context: ["item", "attachment"],
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
  expect(vocabulary).toMatchObject({ context: [], formulas: [] });
  expect(vocabulary.vault).toBeUndefined();
});

it("types only the records the host binds, as a note binds only its Item", () => {
  const note = expressionVocabulary({ dataset: "items", context: ["item"] });
  expect(note.context).toEqual(["item"]);
  expect(typeOf(note, "this.item")).toBe("record");
  expect(typeOf(note, "this.attachment")).toBeUndefined();
});

it("labels a record's members by their full paths, as the Properties popover does", () => {
  const vocabulary = expressionVocabulary({
    dataset: "annotations",
    context: ["item"],
    properties: {
      entry: (path: string) => ({
        label: path === "item.title" ? "Paper heading" : undefined,
      }),
    } as unknown as ViewProperties,
  });
  const members = vocabulary.receiver?.("item", { from: 0, to: 4 })?.members;
  expect(members).toContainEqual({
    path: "title",
    type: "string",
    label: "Paper heading",
  });
  // A path with no label of its own shows none.
  const keys = vocabulary.receiver?.("this.item", { from: 0, to: 9 })?.members;
  expect(keys?.map((member) => member.label)).toEqual([undefined, undefined]);
});
