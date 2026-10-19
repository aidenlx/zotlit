import { Cause, Exit } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ItemQueryLayoutError } from "@zotlit/db/item-query";
import { openScenarioDatabase } from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { ANNOTATIONS, ATTACHMENTS, describeQueryCustomFields, ITEMS } from ".";
import type {
  ItemQueryRequest,
  ItemQuerySchema,
  SchemaFunction,
  SchemaParameter,
} from ".";
import {
  describeAnnotationQuery,
  describeAttachmentQuery,
  describeItemQuery,
  describeItemQueryVocabulary,
  describeQuery,
  describeQueryVocabulary,
} from "./schema";
import { faultCode, runEffect } from "./test-helpers";

it("generates field capabilities from the supplied Query Dataset descriptor", async () => {
  using scenario = openScenarioDatabase();
  const { exit } = await runEffect(
    describeQuery(
      {
        ...ITEMS,
        names: ["title", "library"],
        sortable: () => undefined,
      },
      {},
    ),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw Cause.squash(exit.cause);
  expect(exit.value).toMatchObject({
    fields: [
      {
        path: "title",
        type: "string",
        filter: "string",
        projection: true,
        sort: false,
        group: true,
      },
      {
        path: "library",
        type: "string",
        filter: "string",
        projection: true,
        sort: false,
        group: true,
        valueForms: ["personal", "group:<groupID>"],
      },
    ],
  });
});

async function schema(scenario: ScenarioDatabase): Promise<ItemQuerySchema> {
  const { exit } = await runEffect(describeItemQuery(), {
    client: scenario.db,
  });
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  return exit.value;
}

describe("describeItemQuery custom fields", () => {
  it("lists the custom fields of the source with their path and bare-name eligibility", async () => {
    using scenario = openScenarioDatabase();
    const { customFields } = await schema(scenario);

    expect(customFields).toEqual([
      {
        name: "review.status",
        path: 'custom["review.status"]',
        bareName: false,
        type: "string",
        filter: "string",
        projection: true,
        group: true,
        sort: false,
      },
      {
        name: "mood",
        path: 'custom["mood"]',
        bareName: true,
        type: "string",
        filter: "string",
        projection: true,
        group: true,
        sort: false,
      },
      {
        name: "title",
        path: 'custom["title"]',
        bareName: false,
        type: "string",
        filter: "string",
        projection: true,
        group: true,
        sort: false,
      },
      {
        name: "publicationTitle",
        path: 'custom["publicationTitle"]',
        bareName: false,
        type: "string",
        filter: "string",
        projection: true,
        group: true,
        sort: false,
      },
    ]);
    const { exit } = await runEffect(describeQueryCustomFields(ITEMS), {
      client: scenario.db,
    });
    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value).toEqual(customFields);
  });
});

describe("the static Item Query vocabulary", () => {
  it("describes the Query Context that a filter reads as this", () => {
    expect(describeItemQueryVocabulary().context).toEqual([
      expect.objectContaining({
        name: "this.item",
        dataset: "items",
        members: ["indexedKey", "key"],
      }),
      expect.objectContaining({
        name: "this.attachment",
        dataset: "attachments",
        members: ["indexedKey", "key"],
      }),
    ]);
  });
  it("describes explicit list element projection in the Query Schema", () => {
    const vocabulary = describeItemQueryVocabulary();
    expect(vocabulary).toHaveProperty("projectionPathGrammar.each", {
      syntax: "[]",
      description:
        "Map the remaining path over each list element, preserving order and null positions. Repeat [] for nested lists.",
    });
    expect(vocabulary.fields).toContainEqual({
      path: "creators[].fullName",
      type: "array",
      filter: null,
      projection: true,
      group: true,
      sort: false,
    });
    // A Tag element has fields, so only a field of each element can group.
    expect(vocabulary.fields).toContainEqual(
      expect.objectContaining({ path: "tags[]", group: false }),
    );
    expect(vocabulary.fields).toContainEqual(
      expect.objectContaining({ path: "tags[].name", group: true }),
    );
  });
  it("matches the source-independent part of the complete schema", async () => {
    using scenario = openScenarioDatabase();
    const {
      fields,
      functions,
      methods,
      properties,
      types,
      projectionPathGrammar,
      context,
    } = await schema(scenario);

    expect(describeItemQueryVocabulary()).toEqual({
      context,
      fields,
      functions,
      methods,
      properties,
      types,
      projectionPathGrammar,
    });
    expect(describeItemQueryVocabulary()).not.toHaveProperty("customFields");
    expect(describeItemQueryVocabulary()).not.toHaveProperty("defaults");
  });
});

describe("describeItemQuery fields", () => {
  it("reports the JSON type and the capabilities of each field and Projection Path", async () => {
    using scenario = openScenarioDatabase();
    const { fields } = await schema(scenario);
    const entry = (path: string) => fields.find((field) => field.path === path);
    expect(entry("lastActivity")).toMatchObject({
      type: "string",
      filter: "date",
      projection: true,
      sort: true,
      description: expect.stringContaining("this device's Uses"),
    });
    expect(entry("lastActivitySource")).toMatchObject({
      type: "string",
      filter: "string",
      projection: true,
      sort: false,
      valueForms: ["read", "note", "annotation", "added", "use"],
    });
    expect(entry("lastRead")).toMatchObject({
      type: "string",
      filter: "date",
      projection: true,
      sort: true,
    });

    expect(entry("date")).toEqual({
      path: "date",
      type: "object",
      filter: "date",
      projection: true,
      group: false,
      sort: true,
    });
    expect(entry("date.year")).toEqual({
      path: "date.year",
      type: "number",
      filter: "number",
      projection: true,
      group: true,
      sort: false,
    });
    expect(entry("dateModified")).toEqual({
      path: "dateModified",
      type: "string",
      filter: "date",
      projection: true,
      group: true,
      sort: true,
    });
    expect(entry("creators")).toEqual({
      path: "creators",
      type: "array",
      filter: "list",
      projection: true,
      group: false,
      sort: false,
    });
    // A filter has no property `kind` on a date and reads a list element by
    // its index; the type of the element depends on the Item.
    expect(entry("date.kind")?.filter).toBeNull();
    expect(entry("creators[0]")?.filter).toBe("any");
    expect(entry("tags[0].name")).toMatchObject({
      type: "string",
      filter: null,
    });
    expect(entry("collections[0]")).toMatchObject({
      type: "string",
      filter: "any",
    });
    expect(entry("attachments")).toEqual({
      path: "attachments",
      relation: "attachments",
      type: "array",
      filter: "list",
      projection: true,
      group: false,
      sort: false,
    });
  });

  it("reports the defaults of an omitted argument", async () => {
    using scenario = openScenarioDatabase();
    const { defaults } = await schema(scenario);

    expect(defaults).toEqual({
      fields: ITEMS.defaultFields,
      sort: ITEMS.defaultSort.map(({ field, direction }) => ({
        field,
        direction,
      })),
      limit: null,
    });
  });
});

describe("describeItemQuery on the layout of the Zotero database", () => {
  it("fails with ItemQueryLayoutError when the copy lacks a manifest column", async () => {
    using scenario = openScenarioDatabase();
    scenario.sqlite.exec('alter table "fieldsCombined" drop column "custom"');

    const { exit } = await runEffect(describeItemQuery(), {
      client: scenario.db,
    });

    if (!Exit.isFailure(exit)) throw new Error("describeItemQuery succeeded.");
    const error = Cause.findErrorOption(exit.cause);
    expect(error._tag === "Some" && error.value).toBeInstanceOf(
      ItemQueryLayoutError,
    );
  });
});

/** A literal of each parameter type, for a call that validation accepts. */
const ARGUMENT: Record<Extract<SchemaParameter["type"], string>, string> = {
  string: '"2024-01-02"',
  number: "1",
  list: '["a"]',
  date: "now()",
  regexp: "/a/",
  any: '"a"',
};

/** A filter value of each type that a method or a property is called on. */
const SUBJECT: Record<string, string> = {
  any: "title",
  null: "null",
  boolean: "attachments",
  number: 'number("1")',
  string: "title",
  list: "tags",
  date: "dateAdded",
  duration: 'duration("1d")',
  regexp: "/a/i",
};

function argumentsOf(entry: Omit<SchemaFunction, "name">): string[] {
  return [
    ...entry.parameters,
    ...entry.optional,
    ...(entry.rest ? [entry.rest] : []),
  ].map((parameter) =>
    // A parameter with a closed set of values takes one of them.
    parameter.values
      ? JSON.stringify(parameter.values[0])
      : ARGUMENT[
          typeof parameter.type === "string"
            ? parameter.type
            : parameter.type[0]!
        ],
  );
}

function call(name: string, entry: Omit<SchemaFunction, "name">): string {
  return `${name}(${argumentsOf(entry).join(", ")})`;
}

describe("the Item Query Schema and collectQuery", () => {
  // Every test here only reads the scenario.
  let scenario: ScenarioDatabase;

  beforeAll(() => {
    scenario = openScenarioDatabase();
  });

  afterAll(() => {
    scenario.close();
  });

  it("accepts every field and Projection Path in the use its capabilities list, and rejects every other use", async () => {
    const { fields, customFields } = await schema(scenario);
    const failures: string[] = [];
    const expect_ = async (
      label: string,
      request: Omit<ItemQueryRequest, "libraries">,
      accepted: boolean,
    ) => {
      const code = await faultCode(ITEMS, scenario.db, request);
      if ((code === null) !== accepted) {
        failures.push(`${label}: ${code ?? "accepted"}`);
      }
    };

    for (const field of [...fields, ...customFields]) {
      const { path } = field;
      await expect_(`fields ${path}`, { fields: [path] }, field.projection);
      await expect_(
        `sort ${path}`,
        { sort: [{ field: path, direction: "asc" }] },
        field.sort,
      );
      await expect_(`group ${path}`, { group: path }, field.group);
      await expect_(`filter ${path}`, { filter: path }, field.filter !== null);
    }
    for (const field of customFields.filter((entry) => entry.bareName)) {
      await expect_(`filter ${field.name}`, { filter: field.name }, true);
    }

    expect(failures).toEqual([]);
  });

  it("accepts a call of every function, method, and property it lists", async () => {
    const { functions, methods, properties } = await schema(scenario);
    const failures: string[] = [];
    const filters = [
      ...functions.map((entry) => call(entry.name, entry)),
      ...methods.map((entry) =>
        call(`${SUBJECT[entry.on]!}.${entry.name}`, entry),
      ),
      ...properties.map((entry) => `${SUBJECT[entry.on]!}.${entry.name}`),
    ];

    for (const filter of filters) {
      const code = await faultCode(ITEMS, scenario.db, { filter });
      if (code !== null) failures.push(`${filter}: ${code}`);
    }

    expect(failures).toEqual([]);
  });

  it("accepts each name an element expression lists in its scope, and no other", async () => {
    const { methods } = await schema(scenario);
    const scoped = methods.filter((entry) => entry.scope);
    const names = new Set(scoped.flatMap((entry) => entry.scope!));
    const failures: string[] = [];

    for (const entry of scoped) {
      const [, ...rest] = argumentsOf(entry);
      for (const name of names) {
        const filter = `${SUBJECT[entry.on]!}.${entry.name}(${[name, ...rest].join(", ")})`;
        const code = await faultCode(ITEMS, scenario.db, { filter });
        if ((code === null) !== entry.scope!.includes(name))
          failures.push(`${filter}: ${code ?? "accepted"}`);
      }
    }

    expect(scoped.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it("accepts each value type that isType lists", async () => {
    const { methods, types } = await schema(scenario);
    const values =
      methods.find((entry) => entry.name === "isType")?.parameters[0]?.values ??
      [];
    const failures: string[] = [];

    expect(values).toEqual(["any", ...types]);
    for (const value of values) {
      const filter = `title.isType(${JSON.stringify(value)})`;
      const code = await faultCode(ITEMS, scenario.db, { filter });
      if (code !== null) failures.push(`${filter}: ${code}`);
    }

    expect(failures).toEqual([]);
  });

  it.each([
    [{ fields: ["notAField"] }, "unknown-field"],
    [{ fields: ["title.notAKey"] }, "unknown-path"],
    [{ fields: ["date.notAKey"] }, "unknown-path"],
    [{ fields: ['custom["not a custom field"]'] }, "unknown-field"],
    [{ sort: [{ field: "notAField", direction: "asc" }] }, "unknown-field"],
    [{ filter: "notAField" }, "unknown-field"],
    [{ filter: 'custom["not a custom field"] == "x"' }, "unknown-field"],
    [{ filter: "notAFunction()" }, "unknown-function"],
    [{ filter: "title.notAMethod()" }, "unknown-function"],
    [{ filter: "title.notAProperty" }, "unknown-property"],
    [{ filter: 'title.isType("notAType")' }, "wrong-argument-type"],
    [{ formulas: { "2nd": "title" } }, "invalid-formula-name"],
    [
      { formulas: { wait: 'duration("1 day")' }, fields: ["formula.wait"] },
      "invalid-formula-result",
    ],
    [{ fields: ["formula.notAFormula"] }, "unknown-formula"],
    [{ filter: "formula.notAFormula > 0" }, "unknown-formula"],
  ] satisfies [Omit<ItemQueryRequest, "libraries">, string][])(
    "rejects a name outside it: %j",
    async (request, code) => {
      expect(await faultCode(ITEMS, scenario.db, request)).toBe(code);
    },
  );
});

it("publishes one catalog of the executed dataset schemas and the shared language vocabulary", async () => {
  using scenario = openScenarioDatabase();
  const catalog = describeQueryVocabulary();
  const described = {
    items: describeItemQuery(),
    attachments: describeAttachmentQuery(),
    annotations: describeAnnotationQuery(),
  };
  const items = await schema(scenario);

  expect(Object.keys(catalog.datasets)).toEqual(
    [ITEMS, ATTACHMENTS, ANNOTATIONS].map((dataset) => dataset.id),
  );
  // The functions, methods, and properties that the call test runs.
  expect(catalog).toMatchObject({
    functions: items.functions,
    methods: items.methods,
    properties: items.properties,
    types: items.types,
  });
  const paths: Record<string, ReadonlySet<string>> = {};
  for (const [id, dataset] of Object.entries(catalog.datasets)) {
    const { exit } = await runEffect(described[id as keyof typeof described], {
      client: scenario.db,
    });
    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    const byPath = new Map(dataset.fields.map((field) => [field.path, field]));
    paths[id] = new Set(byPath.keys());

    // The fields that the capability tests of each dataset run.
    expect(dataset.fields, id).toEqual(exit.value.fields);
    for (const path of dataset.summary)
      expect(byPath.get(path), `${id} summary ${path}`).toMatchObject({
        projection: true,
      });
    for (const key of ["functions", "methods", "properties", "types"])
      expect(dataset, id).not.toHaveProperty(key);
  }
  expect(paths.items).toContain("title");
  expect(paths.attachments).toContain("item.title");
  expect(paths.annotations).toContain("item.title");
});

it("publishes the Formula path, name form, result types, Fault codes, and Error Value", async () => {
  const { describeQueryVocabulary } = await import("./schema");
  expect(describeQueryVocabulary().formulas).toEqual({
    path: "formula.<name>",
    name: "^[A-Za-z_][A-Za-z0-9_]*$",
    results: ["boolean", "number", "string", "list", "date"],
    codes: [
      "invalid-formula-name",
      "invalid-formula-result",
      "unknown-formula",
      "formula-cycle",
    ],
    warnings: ["unused-formula"],
    error: {
      type: "error",
      row: { kind: "error", code: "<code>", message: "<message>" },
      codes: [
        "wrong-operand-type",
        "wrong-argument-type",
        "wrong-subject-type",
        "not-finite",
        "unparseable-text",
        "argument-out-of-range",
        "invalid-index",
        "date-out-of-range",
      ],
    },
  });
});
