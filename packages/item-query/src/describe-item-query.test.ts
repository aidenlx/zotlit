import { Cause, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { ItemQueryLayoutError } from "@zotlit/db/item-query";
import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import {
  describeQueryCustomFields,
  collectQuery,
  ITEMS,
  ItemQueryScheduler,
} from ".";
import type {
  ItemQueryRequest,
  ItemQuerySchema,
  SchemaFunction,
  SchemaParameter,
} from ".";
import { describeItemQuery, describeItemQueryVocabulary } from "./schema";
import { runEffect } from "./test-helpers";

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
        sort: false,
      },
      {
        name: "mood",
        path: 'custom["mood"]',
        bareName: true,
        type: "string",
        filter: "string",
        projection: true,
        sort: false,
      },
      {
        name: "title",
        path: 'custom["title"]',
        bareName: false,
        type: "string",
        filter: "string",
        projection: true,
        sort: false,
      },
      {
        name: "publicationTitle",
        path: 'custom["publicationTitle"]',
        bareName: false,
        type: "string",
        filter: "string",
        projection: true,
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
  it("matches the source-independent part of the complete schema", async () => {
    using scenario = openScenarioDatabase();
    const { fields, functions, methods, properties, types } =
      await schema(scenario);

    expect(describeItemQueryVocabulary()).toEqual({
      fields,
      functions,
      methods,
      properties,
      types,
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

    expect(entry("title")).toEqual({
      path: "title",
      type: "string",
      filter: "string",
      projection: true,
      sort: true,
    });
    expect(entry("date")).toEqual({
      path: "date",
      type: "object",
      filter: "date",
      projection: true,
      sort: true,
    });
    expect(entry("date.year")).toEqual({
      path: "date.year",
      type: "number",
      filter: "number",
      projection: true,
      sort: false,
    });
    expect(entry("dateModified")).toEqual({
      path: "dateModified",
      type: "string",
      filter: "date",
      projection: true,
      sort: true,
    });
    // A timestamp or a calendar day, as ISO text in a Query Row.
    expect(entry("accessDate")).toEqual({
      path: "accessDate",
      type: "string",
      filter: "date",
      projection: true,
      sort: true,
    });
    expect(entry("creators")).toEqual({
      path: "creators",
      type: "array",
      filter: "list",
      projection: true,
      sort: false,
    });
    expect(entry("creators[0].fullName")).toEqual({
      path: "creators[0].fullName",
      type: "string",
      filter: null,
      projection: true,
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
      type: "boolean",
      filter: "boolean",
      projection: true,
      sort: false,
    });
    // The Zotero Key inside the Target Library: a filter reads it, a row
    // carries the Indexed Key instead.
    expect(entry("key")).toEqual({
      path: "key",
      type: "string",
      filter: "string",
      projection: false,
      sort: false,
    });
    expect(entry("custom")).toEqual({
      path: "custom",
      type: "object",
      filter: null,
      projection: true,
      sort: false,
    });
  });

  it("reports the defaults of an omitted argument", async () => {
    using scenario = openScenarioDatabase();
    const { defaults } = await schema(scenario);

    expect(defaults).toEqual({
      fields: ["itemType", "title", "creators", "date", "dateModified"],
      sort: [{ field: "dateModified", direction: "desc" }],
      limit: null,
    });
  });
});

describe("describeItemQuery functions", () => {
  it("reports each function, method, and property with its signature", async () => {
    using scenario = openScenarioDatabase();
    const { functions, methods, properties, types } = await schema(scenario);

    expect(functions.find((entry) => entry.name === "if")).toEqual({
      name: "if",
      parameters: [
        { name: "condition", type: "any" },
        { name: "then", type: "any" },
      ],
      optional: [{ name: "else", type: "any" }],
      rest: null,
      returns: null,
    });
    expect(functions.find((entry) => entry.name === "date")).toEqual({
      name: "date",
      parameters: [{ name: "text", type: ["string", "date"] }],
      optional: [],
      rest: null,
      returns: "date",
    });
    expect(
      methods.find((entry) => entry.on === "number" && entry.name === "round"),
    ).toEqual({
      name: "round",
      on: "number",
      parameters: [],
      optional: [{ name: "digits", type: "number" }],
      rest: null,
      returns: "number",
    });
    expect(
      methods.find(
        (entry) => entry.on === "string" && entry.name === "containsAny",
      ),
    ).toMatchObject({
      parameters: [],
      rest: { name: "texts", type: "string" },
    });
    expect(methods.find((entry) => entry.name === "toString")).toMatchObject({
      on: "any",
      returns: "string",
    });
    expect(methods.find((entry) => entry.name === "isType")).toMatchObject({
      on: "any",
      parameters: [{ name: "type", type: "string", values: ["any", ...types] }],
    });
    // The list helpers of Bases that take no element expression.
    const listMethod = (name: string) =>
      methods.find((entry) => entry.on === "list" && entry.name === name);
    expect(listMethod("slice")).toEqual({
      name: "slice",
      on: "list",
      parameters: [{ name: "start", type: "number" }],
      optional: [{ name: "end", type: "number" }],
      rest: null,
      returns: "list",
    });
    expect(listMethod("join")).toEqual({
      name: "join",
      on: "list",
      parameters: [{ name: "separator", type: "string" }],
      optional: [],
      rest: null,
      returns: "string",
    });
    for (const name of ["flat", "reverse", "sort", "unique"]) {
      expect(listMethod(name)).toEqual({
        name,
        on: "list",
        parameters: [],
        optional: [],
        rest: null,
        returns: "list",
      });
    }
    // An element-expression method names the scope its expression can use.
    for (const name of ["filter", "map"]) {
      expect(listMethod(name)).toEqual({
        name,
        on: "list",
        parameters: [{ name: "expression", type: "any" }],
        optional: [],
        rest: null,
        returns: "list",
        scope: ["value", "index"],
      });
    }
    expect(listMethod("reduce")).toEqual({
      name: "reduce",
      on: "list",
      parameters: [
        { name: "expression", type: "any" },
        { name: "initial", type: "any" },
      ],
      optional: [],
      rest: null,
      returns: null,
      scope: ["value", "index", "acc"],
    });
    expect(listMethod("slice")).not.toHaveProperty("scope");
    expect(methods.find((entry) => entry.name === "isTruthy")).toEqual({
      name: "isTruthy",
      on: "any",
      parameters: [],
      optional: [],
      rest: null,
      returns: "boolean",
    });
    expect(functions.find((entry) => entry.name === "list")).toEqual({
      name: "list",
      parameters: [{ name: "value", type: "any" }],
      optional: [],
      rest: null,
      returns: "list",
    });
    expect(
      methods.find((entry) => entry.on === "string" && entry.name === "split"),
    ).toEqual({
      name: "split",
      on: "string",
      parameters: [{ name: "separator", type: ["string", "regexp"] }],
      optional: [{ name: "n", type: "number" }],
      rest: null,
      returns: "list",
    });
    expect(
      methods.find(
        (entry) => entry.on === "string" && entry.name === "replace",
      ),
    ).toMatchObject({
      parameters: [
        { name: "pattern", type: ["string", "regexp"] },
        { name: "replacement", type: "string" },
      ],
    });
    // A regular expression literal is a value of type regexp.
    expect(methods.filter((entry) => entry.on === "regexp")).toEqual([
      {
        name: "matches",
        on: "regexp",
        parameters: [{ name: "text", type: "string" }],
        optional: [],
        rest: null,
        returns: "boolean",
      },
    ]);
    expect(properties.filter((entry) => entry.on === "regexp")).toEqual([]);
    expect(
      methods.find(
        (entry) => entry.on === "number" && entry.name === "toFixed",
      ),
    ).toMatchObject({ parameters: [{ name: "precision", type: "number" }] });
    expect(
      properties.filter((entry) => entry.name === "length").map((e) => e.on),
    ).toEqual(["string", "list"]);
    expect(types).toEqual([
      "null",
      "boolean",
      "number",
      "string",
      "list",
      "date",
      "duration",
      "regexp",
    ]);
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

function call(name: string, entry: Omit<SchemaFunction, "name">): string {
  const args = [
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
  return `${name}(${args.join(", ")})`;
}

describe("the Item Query Schema and collectQuery", () => {
  const { personal } = SCENARIO_LIBRARIES;

  async function codeOf(
    scenario: ScenarioDatabase,
    request: Omit<ItemQueryRequest, "libraries">,
  ): Promise<string | null> {
    const { exit } = await runEffect(
      collectQuery(ITEMS, { libraries: [personal], limit: 1, ...request }),
      // The production scheduler: these tests run several hundred queries,
      // and a pause after every operation makes each one a long chain of
      // tasks that a busy machine runs slowly.
      { client: scenario.db, scheduler: new ItemQueryScheduler() },
    );
    if (Exit.isSuccess(exit)) {
      expect(exit.value.warnings).toEqual([]);
      return null;
    }
    const error = Cause.findErrorOption(exit.cause);
    if (error._tag === "None") throw new Error(String(exit.cause));
    return (error.value as { code?: string }).code ?? error.value._tag;
  }

  it("accepts every field and Projection Path in the use its capabilities list, and rejects every other use", async () => {
    using scenario = openScenarioDatabase();
    const { fields, customFields } = await schema(scenario);
    const failures: string[] = [];
    const expect_ = async (
      label: string,
      request: Omit<ItemQueryRequest, "libraries">,
      accepted: boolean,
    ) => {
      const code = await codeOf(scenario, request);
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
      await expect_(`filter ${path}`, { filter: path }, field.filter !== null);
    }
    for (const field of customFields.filter((entry) => entry.bareName)) {
      await expect_(`filter ${field.name}`, { filter: field.name }, true);
    }

    expect(failures).toEqual([]);
  });

  it("accepts a call of every function, method, and property it lists", async () => {
    using scenario = openScenarioDatabase();
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
      const code = await codeOf(scenario, { filter });
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
  ] satisfies [Omit<ItemQueryRequest, "libraries">, string][])(
    "rejects a name outside it: %j",
    async (request, code) => {
      using scenario = openScenarioDatabase();
      expect(await codeOf(scenario, request)).toBe(code);
    },
  );
});
