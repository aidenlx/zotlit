import { describe, expect, it } from "vitest";

import { ANNOTATIONS, ITEMS } from "@zotlit/item-query";

import { datasetVocabulary } from "./expression-vocabulary";

const noLabel = () => undefined;

/** The type the vocabulary gives the receiver `text`, standing alone. */
const typeOf = (
  vocabulary: ReturnType<typeof datasetVocabulary>,
  text: string,
) => vocabulary.receiver?.(text, { from: 0, to: text.length })?.type;

describe("the fields of a Query Dataset", () => {
  it("lists each name a filter reads, with the type its planner gives and the host's label", () => {
    const { fields } = datasetVocabulary(ITEMS, {
      label: (path) => (path === "title" ? "Title" : undefined),
    });
    expect(fields).toContainEqual({
      path: "title",
      label: "Title",
      type: "string",
    });
    expect(fields).toContainEqual({ path: "dateAdded", type: "date" });
    expect(fields).toContainEqual({ path: "creators", type: "list" });
    // `custom` is read only by bracket access to a custom field.
    expect(fields.map((field) => field.path)).not.toContain("custom");
  });

  it("offers only what the planner accepts", () => {
    for (const dataset of [ITEMS, ANNOTATIONS]) {
      const vocabulary = datasetVocabulary(dataset, { label: noLabel });
      for (const { path } of vocabulary.fields)
        expect(dataset.planFilter(path), path).toHaveProperty("root");
      for (const { path } of vocabulary.receiver?.("item", {
        from: 0,
        to: 4,
      })?.members ?? [])
        expect(dataset.planFilter(`item.${path}`), path).toHaveProperty("root");
    }
  });
});

it("types a receiver as the planner of its Query Dataset types it", () => {
  const items = datasetVocabulary(ITEMS, { label: noLabel });
  expect(typeOf(items, "title")).toBe("string");
  expect(
    items.receiver?.("formula.missing", { from: 0, to: 15 }),
  ).toBeUndefined();
  expect(
    typeOf(datasetVocabulary(ANNOTATIONS, { label: noLabel }), "text"),
  ).toBe("string");
});

it("types another Formula by its planned result, and this by the Query Context", () => {
  const vocabulary = datasetVocabulary(ITEMS, {
    label: noLabel,
    formulas: { added: "dateAdded" },
    context: ["item", "attachment"],
  });
  expect(vocabulary.formulas).toEqual([{ name: "added" }]);
  expect(typeOf(vocabulary, "formula.added")).toBe("date");
  expect(typeOf(vocabulary, "this.item")).toBe("record");
  expect(
    typeOf(datasetVocabulary(ITEMS, { label: noLabel }), "this.item"),
  ).toBeUndefined();
});

it("types only the records the host binds, as a note binds only its Item", () => {
  const note = datasetVocabulary(ITEMS, { label: noLabel, context: ["item"] });
  expect(note.context).toEqual(["item"]);
  expect(typeOf(note, "this.item")).toBe("record");
  expect(typeOf(note, "this.attachment")).toBeUndefined();
});

it("offers the custom fields it is given at the path its dataset reads them by", () => {
  expect(
    datasetVocabulary(ITEMS, { label: noLabel, custom: ["Shelf"] }).custom,
  ).toEqual({ path: "custom", names: ["Shelf"] });
  expect(
    datasetVocabulary(ANNOTATIONS, { label: noLabel, custom: ["Shelf"] })
      .custom,
  ).toEqual({ path: "item.custom", names: ["Shelf"] });
});

it("offers no Formula, Query Context, vault property or custom field unless given", () => {
  const vocabulary = datasetVocabulary(ITEMS, { label: noLabel });
  expect(vocabulary).toMatchObject({ context: [], formulas: [] });
  expect(vocabulary.vault).toBeUndefined();
  expect(vocabulary.custom).toBeUndefined();
});

it("labels every entry by its id, as the expression names it", () => {
  const labels: Record<string, string> = {
    title: "Heading",
    "item.title": "Paper heading",
    "formula.short": "Short title",
    "vault.status": "Reading status",
  };
  const vocabulary = datasetVocabulary(ANNOTATIONS, {
    label: (path) => labels[path],
    context: ["item"],
    formulas: { short: "item.title.slice(0, 10)" },
    vault: ["status"],
  });
  expect(vocabulary.formulas).toEqual([
    { name: "short", label: "Short title" },
  ]);
  expect(vocabulary.vault).toEqual([
    { name: "status", label: "Reading status" },
  ]);
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
