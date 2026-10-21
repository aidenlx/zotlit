import { describe, expect, it } from "vitest";

import { renderFunctionsReference } from "./reference";
import type { LanguageVocabulary } from "./reference";

const VOCABULARY: LanguageVocabulary = {
  types: ["null", "string", "list", "duration"],
  functions: [
    {
      name: "if",
      description: "The `then` value when `condition` is truthy.",
      parameters: [
        { name: "condition", type: "any" },
        { name: "then", type: "any" },
      ],
      optional: [{ name: "else", type: "any" }],
      rest: null,
      returns: null,
    },
    {
      name: "min",
      description: "The smallest number among the arguments.",
      parameters: [],
      optional: [],
      rest: { name: "values", type: "number", nullable: true },
      returns: "number",
    },
  ],
  methods: [
    {
      name: "isType",
      on: "any",
      description: "Whether the value has the named value type.",
      parameters: [{ name: "type", type: "string", values: ["any", "null"] }],
      optional: [],
      rest: null,
      returns: "boolean",
    },
    {
      name: "split",
      on: "string",
      description: "The parts of the text between occurrences of `separator`.",
      parameters: [{ name: "separator", type: ["string", "regexp"] }],
      optional: [{ name: "n", type: "number" }],
      rest: null,
      returns: "list",
    },
    {
      name: "filter",
      on: "list",
      description: "The elements for which the expression is truthy.",
      parameters: [{ name: "expression", type: "any" }],
      optional: [],
      rest: null,
      returns: "list",
      scope: ["value", "index"],
    },
  ],
  properties: [
    {
      name: "length",
      on: "list",
      description: "The number of elements.",
      returns: "number",
    },
  ],
};

const rowOf = (page: string, start: string): string =>
  page.split("\n").find((line) => line.startsWith(`| \`${start}`))!;

describe("renderFunctionsReference", () => {
  it("renders a method's signature with its receiver, optional parameter and return type", () => {
    const page = renderFunctionsReference(VOCABULARY);

    expect(rowOf(page, "string.split")).toBe(
      "| `string.split(separator: string \\| regexp, n?: number) → list` | The parts of the text between occurrences of `separator`. |",
    );
  });

  it("names what an element expression can use", () => {
    const page = renderFunctionsReference(VOCABULARY);

    expect(rowOf(page, "list.filter")).toBe(
      "| `list.filter(expression: any) → list` | The elements for which the expression is truthy. The expression can use `value` and `index`. |",
    );
  });

  it("renders a property as a member read without a call", () => {
    const page = renderFunctionsReference(VOCABULARY);

    expect(rowOf(page, "list.length")).toBe(
      "| `list.length → number` | The number of elements. |",
    );
  });

  it("groups methods and properties under one anchored heading per receiver type, skipping types without members", () => {
    const page = renderFunctionsReference(VOCABULARY);
    const headings = page.split("\n").filter((line) => line.startsWith("#"));

    expect(headings).toEqual([
      "## Global functions [#functions]",
      "## Methods [#methods]",
      "### Methods of every value [#any-methods]",
      "### String methods [#string-methods]",
      "### List methods [#list-methods]",
      "## Properties [#properties]",
      "### List properties [#list-properties]",
    ]);
  });

  it("fails on an entry without a description, naming the entry", () => {
    const vocabulary = {
      ...VOCABULARY,
      methods: VOCABULARY.methods.map((entry) =>
        entry.name === "split" ? { ...entry, description: " " } : entry,
      ),
    };

    expect(() => renderFunctionsReference(vocabulary)).toThrow(
      /string\.split has no description/,
    );
  });

  it("fails on a description that MDX would read as markup", () => {
    const vocabulary = {
      ...VOCABULARY,
      properties: [
        { ...VOCABULARY.properties[0]!, description: "The count {of} items." },
      ],
    };

    expect(() => renderFunctionsReference(vocabulary)).toThrow(
      /list\.length.*\{/,
    );
  });
});
