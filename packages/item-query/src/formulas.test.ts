// Formulas: named Filter Expressions that a query evaluates for each record
// and returns with the Query Row as `formula.<name>`.
import { Cause } from "effect";
import { expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import { ANNOTATIONS, ATTACHMENTS, collectQuery, ITEMS } from ".";
import type { ItemQueryRequest, QueryDataset, QueryResult } from ".";
import { ItemQueryError } from "./error";
import { runEffect } from "./test-helpers";

const { personal } = SCENARIO_LIBRARIES;

async function run(
  scenario: ScenarioDatabase,
  request: Omit<ItemQueryRequest, "libraries">,
  dataset: QueryDataset = ITEMS,
): Promise<QueryResult> {
  const { exit } = await runEffect(
    collectQuery(dataset, { libraries: [personal], ...request }),
    { client: scenario.db },
  );
  if (exit._tag === "Failure") throw new Error(Cause.pretty(exit.cause));
  return exit.value;
}

it("returns a Formula's value as formula.<name> in each Item Row", async () => {
  using scenario = openScenarioDatabase();
  const result = await run(scenario, {
    filter: 'indexedKey == "BK2MNTH2"',
    formulas: { next: "date.year + 1" },
    fields: ["title", "formula.next"],
  });
  expect(result.rows!.map((row) => row.values["formula.next"])).toEqual([2020]);
  expect(result.query.formulas).toEqual({ next: "date.year + 1" });
});

it("returns formula.<name> on Attachment Rows and Annotation Rows", async () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const files = await run(
    scenario,
    {
      filter: 'indexedKey == "PDF2LIVE"',
      formulas: { parent: 'item.indexedKey + "/" + contentType' },
      fields: ["formula.parent"],
    },
    ATTACHMENTS,
  );
  expect(files.rows!.map((row) => row.values)).toEqual([
    { "formula.parent": "ART2FULL/application/pdf" },
  ]);
  const marks = await run(
    scenario,
    {
      filter: 'indexedKey == "ANN2UNDR"',
      formulas: { parent: "attachment.indexedKey.lower()" },
      fields: ["type", "formula.parent"],
    },
    ANNOTATIONS,
  );
  expect(marks.rows!.map((row) => row.values)).toEqual([
    { type: "underline", "formula.parent": "pdf2live" },
  ]);
});

it("returns a date in the date object shape and a list element by element", async () => {
  using scenario = openScenarioDatabase();
  const result = await run(scenario, {
    filter: '["BK2MNTH2", "CHP2YEAR"].contains(indexedKey)',
    formulas: { published: "date", pair: "[date.year, title.length > 0]" },
    fields: ["formula.published", "formula.pair"],
    sort: [{ field: "indexedKey", direction: "asc" }],
  });
  expect(result.rows!.map((row) => row.values)).toEqual([
    {
      "formula.published": {
        kind: "yearMonth",
        value: Temporal.PlainYearMonth.from("2019-11"),
        year: 2019,
        month: 11,
        day: null,
        text: null,
        raw: "2019-11",
      },
      "formula.pair": [2019, true],
    },
    {
      "formula.published": {
        kind: "year",
        value: null,
        year: 2018,
        month: null,
        day: null,
        text: null,
        raw: "2018",
      },
      "formula.pair": [2018, true],
    },
  ]);
});

it("returns an Error Value cell as kind, code, and message", async () => {
  using scenario = openScenarioDatabase();
  const result = await run(scenario, {
    filter: 'indexedKey == "BK2MNTH2"',
    formulas: {
      volumes: "number(title)",
      pair: "[date.year, number(title)]",
      checked: 'number(title).isType("error")',
    },
    fields: ["title", "formula.volumes", "formula.pair", "formula.checked"],
  });
  const [row] = result.rows!;
  const title = row!.values.title as string;
  const cell = {
    kind: "error",
    code: "unparseable-text",
    message: `number() cannot read ${JSON.stringify(title)} as a number.`,
  };
  expect(row!.values).toEqual({
    title,
    "formula.volumes": cell,
    "formula.pair": [2019, cell],
    "formula.checked": true,
  });
});

it("excludes a record whose filter reads an Error Value of a Formula", async () => {
  using scenario = openScenarioDatabase();
  const read = (filter: string) =>
    run(scenario, {
      filter: `indexedKey == "BK2MNTH2" && (${filter})`,
      formulas: { volumes: "number(title)" },
      fields: ["title"],
    });
  expect((await read("formula.volumes")).rows).toEqual([]);
  expect((await read("formula.volumes == formula.volumes")).rows).toEqual([]);
  expect((await read("formula.volumes != null")).rows).toHaveLength(1);
});

async function failure(
  scenario: ScenarioDatabase,
  request: Omit<ItemQueryRequest, "libraries">,
): Promise<ItemQueryError> {
  const { exit } = await runEffect(
    collectQuery(ITEMS, { libraries: [personal], ...request }),
    { client: scenario.db },
  );
  if (exit._tag === "Success") throw new Error("The query succeeded.");
  const error = Cause.squash(exit.cause);
  if (!(error instanceof ItemQueryError)) throw error;
  return error;
}

it.each([
  [
    "a name that is not an identifier",
    { formulas: { "2nd": "title" }, fields: ["title"] },
    {
      code: "invalid-formula-name",
      location: { argument: "formulas", path: "2nd" },
    },
  ],
  [
    "a value that a Query Row cannot hold",
    { formulas: { wait: 'duration("7 days")' }, fields: ["formula.wait"] },
    {
      code: "invalid-formula-result",
      location: {
        argument: "formulas",
        path: "wait",
        span: { from: 0, to: 18 },
      },
      found: "duration",
    },
  ],
  [
    "a name in fields that no Formula has",
    { formulas: { year: "date.year" }, fields: ["title", "formula.yeer"] },
    {
      code: "unknown-formula",
      location: { argument: "fields", index: 1, path: "fields[1]" },
      found: "yeer",
      suggestions: ['fields=\'["title","formula.year"]\''],
    },
  ],
  [
    "formula.<name> in fields without formulas",
    { fields: ["formula.year"] },
    {
      code: "unknown-formula",
      location: { argument: "fields", index: 0, path: "fields[0]" },
    },
  ],
  [
    "an unknown method in the Formula text",
    { formulas: { short: "title.nope()" }, fields: ["formula.short"] },
    {
      code: "unknown-function",
      location: {
        argument: "formulas",
        path: "short",
        span: { from: 6, to: 10 },
      },
    },
  ],
  [
    "arithmetic on a type that the operator never takes",
    { formulas: { twice: "title * 2" }, fields: ["formula.twice"] },
    {
      code: "wrong-operand-type",
      location: {
        argument: "formulas",
        path: "twice",
        span: { from: 0, to: 9 },
      },
    },
  ],
  [
    "a Formula in fields in the bracket form",
    { formulas: { f: "title" }, fields: ["title", 'formula["f"]'] },
    {
      code: "invalid-path",
      location: { argument: "fields", index: 1, path: "fields[1]" },
      hint: "Read the Formula as formula.f.",
    },
  ],
  [
    "a Formula in fields with a path after its name",
    { formulas: { f: "title" }, fields: ["formula.f.length"] },
    {
      code: "invalid-path",
      location: { argument: "fields", index: 0, path: "fields[0]" },
    },
  ],
  [
    "a syntax mistake in the Formula text",
    { formulas: { short: "title +" }, fields: ["formula.short"] },
    {
      code: "invalid-filter",
      location: { argument: "formulas", path: "short" },
    },
  ],
] satisfies [string, Omit<ItemQueryRequest, "libraries">, object][])(
  "fails a request with %s, and the report names the Formula",
  async (_, request, expected) => {
    using scenario = openScenarioDatabase();
    const error = await failure(scenario, request);
    expect(error.diagnostic).toMatchObject(expected);
    const name =
      expected.code === "invalid-formula-name"
        ? JSON.stringify(expected.location.path)
        : expected.location.path.startsWith("fields")
          ? request.fields!.at(-1)!
          : `formula.${expected.location.path}`;
    expect(error.diagnostic.report.join("\n")).toContain(name);
  },
);

it("checks a custom field of a Formula against the source", async () => {
  using scenario = openScenarioDatabase();
  const error = await failure(scenario, {
    formulas: { status: 'custom["no such field"]' },
    fields: ["formula.status"],
  });
  expect(error.diagnostic).toMatchObject({
    code: "unknown-field",
    location: { argument: "formulas", path: "status" },
  });
  expect(error.diagnostic.report.join("\n")).toContain("formula.status");
});

it("warns about a Formula that the request names and never reads", async () => {
  using scenario = openScenarioDatabase();
  const result = await run(scenario, {
    filter: 'indexedKey == "BK2MNTH2"',
    formulas: { year: "date.year", unused: "title.nope()" },
    fields: ["formula.year"],
  });
  expect(result.rows!.map((row) => row.values)).toEqual([
    { "formula.year": 2019 },
  ]);
  expect(result.warnings).toMatchObject([
    {
      code: "unused-formula",
      severity: "warning",
      location: { argument: "formulas", path: "unused" },
      found: "unused",
    },
  ]);
  expect(result.warnings[0]!.report.join("\n")).toContain("formula.unused");
});

it("reserves formula: a filter reads a Formula as formula.<name>", async () => {
  using scenario = openScenarioDatabase();
  const error = await failure(scenario, {
    filter: 'formula == "x"',
    formulas: { year: "date.year" },
  });
  expect(error.diagnostic).toMatchObject({
    code: "unknown-formula",
    location: { argument: "filter", span: { from: 0, to: 7 } },
  });
  expect(error.diagnostic.hint).toContain("formula.year");
  const alone = await failure(scenario, { filter: 'formula == "x"' });
  expect(alone.diagnostic).toMatchObject({
    code: "unknown-formula",
    location: { argument: "filter", span: { from: 0, to: 7 } },
  });
  expect(alone.diagnostic.hint).not.toContain('{"":');
  expect(alone.diagnostic.hint).toContain("formula.year");
});

it("selects the records whose Formula value the filter accepts", async () => {
  using scenario = openScenarioDatabase();
  const keys = async (request: Omit<ItemQueryRequest, "libraries">) =>
    (await run(scenario, { ...request, fields: ["title"] })).rows!.map(
      (row) => row.indexedKey,
    );
  const byFormula = await keys({
    filter: "formula.year > 2018",
    formulas: { year: "date.year" },
  });
  expect(byFormula.length).toBeGreaterThan(0);
  expect(byFormula).toEqual(await keys({ filter: "date.year > 2018" }));
});

it("projects a Formula that reads another Formula", async () => {
  using scenario = openScenarioDatabase();
  const result = await run(scenario, {
    filter: 'indexedKey == "BK2MNTH2"',
    formulas: { a: "formula.b + 1", b: "date.year" },
    fields: ["formula.a"],
  });
  expect(result.rows!.map((row) => row.values)).toEqual([
    { "formula.a": 2020 },
  ]);
  expect(result.warnings).toEqual([]);
});

it("fails Formulas that read each other, and the report names the chain", async () => {
  using scenario = openScenarioDatabase();
  const error = await failure(scenario, {
    formulas: { a: "formula.b + 1", b: "formula.a * 2" },
    fields: ["formula.a"],
  });
  expect(error.diagnostic).toMatchObject({
    code: "formula-cycle",
    location: { argument: "formulas", path: "b", span: { from: 0, to: 9 } },
  });
  expect(error.diagnostic.report.join("\n")).toContain(
    "formula.a → formula.b → formula.a",
  );
});

it("fails a filter that reads a Formula the request does not define", async () => {
  using scenario = openScenarioDatabase();
  const error = await failure(scenario, {
    filter: "title != null && formula.yeer > 2000",
    formulas: { year: "date.year" },
  });
  expect(error.diagnostic).toMatchObject({
    code: "unknown-formula",
    location: { argument: "filter", span: { from: 17, to: 29 } },
    found: "yeer",
    suggestions: ["formula.year"],
  });
  expect(error.fault).toMatchObject({ kind: "unknown", role: "formula" });
  expect(error.diagnostic.report.join("\n")).toContain("formula.yeer");
});

it("plans a Formula that reads another one many times once for each Formula", async () => {
  using scenario = openScenarioDatabase();
  // Each Formula reads the one before it twice: 2^18 reads of a0 in all.
  const formulas: Record<string, string> = { a0: "date.year" };
  for (let index = 1; index <= 18; index++)
    formulas[`a${index}`] = `formula.a${index - 1} + formula.a${index - 1}`;
  const result = await run(scenario, {
    filter: 'indexedKey == "BK2MNTH2"',
    formulas,
    fields: ["formula.a18"],
  });
  expect(result.rows!.map((row) => row.values["formula.a18"])).toEqual([
    2019 * 2 ** 18,
  ]);
});

it("warns about a comparison in the text of a Formula, at the Formula", async () => {
  using scenario = openScenarioDatabase();
  const result = await run(scenario, {
    filter: 'indexedKey == "BK2MNTH2"',
    formulas: { x: 'date > "2019"' },
    fields: ["formula.x"],
  });
  expect(
    result.warnings.map(({ code, message, location }) => ({
      code,
      message,
      location,
    })),
  ).toEqual([
    {
      code: expect.stringMatching(/^(never|always)-true$/),
      message: expect.stringMatching(
        /^In formula\.x: date is a date and "2019" is a string/,
      ),
      location: { argument: "formulas", path: "x", span: { from: 0, to: 13 } },
    },
  ]);
});
