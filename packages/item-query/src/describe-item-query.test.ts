import { Cause, Exit } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { ItemQueryLayoutError } from "@zotlit/db/item-query";
import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { describeItemQuery, queryItems } from ".";
import type {
  ItemQueryRequest,
  ItemQuerySchema,
  SchemaFunction,
  SchemaParameter,
} from ".";
import { runEffect } from "./test-helpers";

let scenario: ScenarioDatabase | undefined;

afterEach(() => {
  scenario?.close();
  scenario = undefined;
});

async function schema(): Promise<ItemQuerySchema> {
  scenario ??= openScenarioDatabase();
  const { exit } = await runEffect(describeItemQuery(), {
    client: scenario.db,
  });
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  return exit.value;
}

describe("describeItemQuery custom fields", () => {
  it("lists the custom fields of the source with their path and bare-name eligibility", async () => {
    const { customFields } = await schema();

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
  });
});

describe("describeItemQuery fields", () => {
  it("reports the JSON type and the capabilities of each field and Projection Path", async () => {
    const { fields } = await schema();
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
      filter: null,
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
    expect(entry("tags[0].name")?.type).toBe("string");
    expect(entry("collections[0]")?.type).toBe("string");
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
    const { defaults } = await schema();

    expect(defaults).toEqual({
      fields: ["itemType", "title", "creators", "date", "dateModified"],
      sort: [{ field: "dateModified", direction: "desc" }],
      limit: null,
    });
  });
});

describe("describeItemQuery functions", () => {
  it("reports each function, method, and property with its signature", async () => {
    const { functions, methods, properties, types } = await schema();

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
      parameters: [{ name: "text", type: "string" }],
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
    ]);
  });
});

describe("describeItemQuery on the layout of the Zotero database", () => {
  it("fails with ItemQueryLayoutError when the copy lacks a manifest column", async () => {
    scenario = openScenarioDatabase();
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
const ARGUMENT: Record<SchemaParameter["type"], string> = {
  string: '"2024-01-02"',
  number: "1",
  list: '["a"]',
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
};

function call(name: string, entry: Omit<SchemaFunction, "name">): string {
  const args = [
    ...entry.parameters,
    ...entry.optional,
    ...(entry.rest ? [entry.rest] : []),
  ].map((parameter) => ARGUMENT[parameter.type]);
  return `${name}(${args.join(", ")})`;
}

describe("the Item Query Schema and queryItems", () => {
  const { personal } = SCENARIO_LIBRARIES;

  async function codeOf(
    request: Omit<ItemQueryRequest, "library">,
  ): Promise<string | null> {
    scenario ??= openScenarioDatabase();
    const { exit } = await runEffect(
      queryItems({ library: personal, limit: 1, ...request }),
      { client: scenario.db },
    );
    if (Exit.isSuccess(exit)) return null;
    const error = Cause.findErrorOption(exit.cause);
    if (error._tag === "None") throw new Error(String(exit.cause));
    return (error.value as { code?: string }).code ?? error.value._tag;
  }

  it("accepts every field and Projection Path in the use its capabilities list, and rejects every other use", async () => {
    const { fields, customFields } = await schema();
    const failures: string[] = [];
    const expect_ = async (
      label: string,
      request: Omit<ItemQueryRequest, "library">,
      accepted: boolean,
    ) => {
      const code = await codeOf(request);
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
      // A filter reads a field by name or a custom field by its path; a
      // filter reaches a part of a value through properties and methods.
      if (!/[.[]/.test(path) || "name" in field) {
        await expect_(
          `filter ${path}`,
          { filter: path },
          field.filter !== null,
        );
      }
    }
    for (const field of customFields.filter((entry) => entry.bareName)) {
      await expect_(`filter ${field.name}`, { filter: field.name }, true);
    }

    expect(failures).toEqual([]);
  });

  it("accepts a call of every function, method, and property it lists", async () => {
    const { functions, methods, properties } = await schema();
    const failures: string[] = [];
    const filters = [
      ...functions.map((entry) => call(entry.name, entry)),
      ...methods.map((entry) =>
        call(`${SUBJECT[entry.on]!}.${entry.name}`, entry),
      ),
      ...properties.map((entry) => `${SUBJECT[entry.on]!}.${entry.name}`),
    ];

    for (const filter of filters) {
      const code = await codeOf({ filter });
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
  ] satisfies [Omit<ItemQueryRequest, "library">, string][])(
    "rejects a name outside it: %j",
    async (request, code) => {
      expect(await codeOf(request)).toBe(code);
    },
  );
});
