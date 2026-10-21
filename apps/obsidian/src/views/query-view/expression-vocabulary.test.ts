import { expect, it } from "vitest";

import { expressionVocabulary } from "./expression-vocabulary";
import { formulaProperty, vaultProperty } from "./query-file";
import type { ViewProperties } from "./view-properties";

// What a vocabulary offers over a Query Dataset is proved through
// datasetVocabulary in @zotlit/workbench; these prove what a view gives it.

/** The type the vocabulary gives the receiver `text`, standing alone. */
const typeOf = (
  vocabulary: ReturnType<typeof expressionVocabulary>,
  text: string,
) => vocabulary.receiver?.(text, { from: 0, to: text.length })?.type;

it("reads the Query Dataset of the view, and Annotations in a view without one", () => {
  expect(typeOf(expressionVocabulary({ dataset: "items" }), "dateAdded")).toBe(
    "date",
  );
  expect(typeOf(expressionVocabulary({ dataset: "annotations" }), "text")).toBe(
    "string",
  );
  expect(typeOf(expressionVocabulary({ dataset: undefined }), "text")).toBe(
    "string",
  );
});

it("labels each entry as the view's Properties label its Property", () => {
  const labels: Record<string, string> = {
    title: "Heading",
    "item.title": "Paper heading",
    [formulaProperty("short")]: "Short title",
    [vaultProperty("status")]: "Reading status",
  };
  const vocabulary = expressionVocabulary({
    dataset: "annotations",
    context: ["item"],
    formulas: { short: "item.title.slice(0, 10)" },
    vaultNames: ["status"],
    properties: {
      entry: (path: string) => ({ label: labels[path] }),
    } as unknown as ViewProperties,
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
});

it("reads no vault property unless the view gives them", () => {
  expect(expressionVocabulary({ dataset: "items" }).vault).toBeUndefined();
});
