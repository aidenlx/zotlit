// Formulas: named Filter Expressions that a query evaluates for each record
// and returns with the Query Row as `formula.<name>`.
import { Cause } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  openScenarioDatabase,
  SCENARIO_LIBRARIES,
} from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import {
  ANNOTATIONS,
  ATTACHMENTS,
  collectQuery,
  formulaReferences,
  ITEMS,
} from ".";
import type { ItemQueryRequest, QueryDataset, QueryResult } from ".";
import { ItemQueryError } from "./error";
import { runEffect } from "./test-helpers";

const { personal } = SCENARIO_LIBRARIES;
let scenario: ScenarioDatabase;
let annotatedScenario: ScenarioDatabase;

beforeAll(() => {
  scenario = openScenarioDatabase();
  annotatedScenario = openScenarioDatabase({ annotations: true });
});
afterAll(() => {
  scenario.close();
  annotatedScenario.close();
});

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
  const result = await run(scenario, {
    filter: 'indexedKey == "BK2MNTH2"',
    formulas: { next: "date.year + 1" },
    fields: ["title", "formula.next"],
  });
  expect(result.rows!.map((row) => row.values["formula.next"])).toEqual([2020]);
  expect(result.query.formulas).toEqual({ next: "date.year + 1" });
});

it("returns formula.<name> on Attachment Rows and Annotation Rows", async () => {
  const scenario = annotatedScenario;
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

it("finds the Formulas a Filter Expression reads as the planner resolves them", () => {
  expect(
    formulaReferences('formula . year > 2000 && title == "formula.bad"'),
  ).toEqual([{ name: "year", from: 0, to: 14 }]);
  expect(formulaReferences("formula.parts[0] + formula.n.round()")).toEqual([
    { name: "parts", from: 0, to: 13 },
    { name: "n", from: 19, to: 28 },
  ]);
  // A text that does not parse reads no Formula.
  expect(formulaReferences("formula.year +")).toEqual([]);
});

it.each([
  [
    "sort",
    {
      formulas: { year: "date.year" },
      fields: ["formula.year"],
      sort: [{ field: "formula.year", direction: "asc" }],
    },
    { code: "unsortable-field", location: { argument: "sort", index: 0 } },
  ],
  [
    "group",
    {
      formulas: { year: "date.year" },
      fields: ["formula.year"],
      group: "formula.year",
    },
    { code: "invalid-group", location: { argument: "group" } },
  ],
] satisfies [string, Omit<ItemQueryRequest, "libraries">, object][])(
  "rejects a %s by a Formula, and says that it is not available yet",
  async (_, request, expected) => {
    const error = await failure(scenario, request);
    expect(error.diagnostic).toMatchObject(expected);
    expect(error.diagnostic.message).toContain("formula.year yet");
  },
);

it("reads a Formula whose name is also an object member, such as __proto__", async () => {
  const result = await run(scenario, {
    filter: 'indexedKey == "BK2MNTH2"',
    formulas: JSON.parse(
      '{"__proto__":"date.year","constructor":"formula.__proto__ + 1"}',
    ) as Record<string, string>,
    fields: ["formula.__proto__", "formula.constructor"],
  });
  expect(result.rows!.map((row) => row.values)).toEqual([
    { "formula.__proto__": 2019, "formula.constructor": 2020 },
  ]);
});

it.each([
  [
    "a Formula that reads it",
    { formulas: { a: "formula.b + 1", b: "title * 2" }, fields: ["formula.a"] },
  ],
  [
    "the filter",
    {
      filter: "title != null && formula.a > 0",
      formulas: { a: "formula.b + 1", b: "title * 2" },
      fields: ["title"],
    },
  ],
] satisfies [string, Omit<ItemQueryRequest, "libraries">][])(
  "reports a mistake in the Formula's own text when %s reads it",
  async (_, request) => {
    const error = await failure(scenario, request);
    expect(error.diagnostic).toMatchObject({
      code: "wrong-operand-type",
      location: { argument: "formulas", path: "b", span: { from: 0, to: 9 } },
    });
  },
);

it("reports a Formula that reads an undefined Formula in its own text", async () => {
  const error = await failure(scenario, {
    formulas: { a: "formula.b + formula.zz", b: "date.year" },
    fields: ["formula.a"],
  });
  expect(error.diagnostic).toMatchObject({
    code: "unknown-formula",
    found: "zz",
    location: { argument: "formulas", path: "a", span: { from: 12, to: 22 } },
  });
});

it("reports a cycle at the Formula that closes it, from the first Formula read", async () => {
  const error = await failure(scenario, {
    formulas: { a: "formula.b + 1", b: "formula.a * 2" },
    fields: ["formula.b"],
  });
  expect(error.diagnostic).toMatchObject({
    code: "formula-cycle",
    location: { argument: "formulas", path: "a", span: { from: 0, to: 9 } },
  });
  expect(error.diagnostic.report.join("\n")).toContain(
    "formula.b → formula.a → formula.b",
  );
});

it("reports the first mistake in request order: names, then the filter, then fields", async () => {
  const formulas = { bad: "title * 2", worse: "title.nope()" };
  const named = await failure(scenario, {
    filter: "formula.bad > 0",
    formulas: { ...formulas, "2nd": "title" },
    fields: ["formula.worse"],
  });
  expect(named.diagnostic).toMatchObject({ code: "invalid-formula-name" });
  const filtered = await failure(scenario, {
    filter: "formula.bad > 0",
    formulas,
    fields: ["formula.worse"],
  });
  expect(filtered.diagnostic).toMatchObject({
    location: { argument: "formulas", path: "bad" },
  });
  const projected = await failure(scenario, {
    formulas,
    fields: ["formula.worse", "formula.bad"],
  });
  expect(projected.diagnostic).toMatchObject({
    location: { argument: "formulas", path: "worse" },
  });
});

describe('onFormulaFault: "leave-out"', () => {
  it("answers the rows without a wrong Formula, and its Diagnostic beside the warnings", async () => {
    const result = await run(scenario, {
      filter: 'indexedKey == "BK2MNTH2"',
      formulas: { year: "date.year", bad: "title * 2" },
      fields: ["title", "formula.bad", "formula.year"],
      onFormulaFault: "leave-out",
    });
    expect(result.rows!.map((row) => row.values)).toEqual([
      { title: expect.any(String), "formula.year": 2019 },
    ]);
    expect(result.query.fields).toEqual([
      "title",
      "formula.bad",
      "formula.year",
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.formulaDiagnostics).toEqual({
      bad: expect.objectContaining({
        code: "wrong-operand-type",
        severity: "error",
        message: expect.stringMatching(/^In formula\.bad: /),
        location: {
          argument: "formulas",
          path: "bad",
          span: { from: 0, to: 9 },
        },
      }),
    });
  });

  it("leaves out each Formula that reads a wrong one, with one Diagnostic that names the first wrong Formula it reads", async () => {
    const result = await run(scenario, {
      filter: 'indexedKey == "BK2MNTH2"',
      formulas: {
        bad: "title * 2",
        worse: "title.nope()",
        a: "formula.worse + formula.bad",
        b: "formula.a + 1",
        ok: "date.year",
      },
      fields: ["formula.b", "formula.ok"],
      onFormulaFault: "leave-out",
    });
    expect(result.rows!.map((row) => row.values)).toEqual([
      { "formula.ok": 2019 },
    ]);
    const faults = result.formulaDiagnostics!;
    // a reads worse first; the query still plans bad, which a reads after it.
    expect(Object.keys(faults).sort()).toEqual(["a", "b", "bad", "worse"]);
    expect(faults.bad).toMatchObject({ code: "wrong-operand-type" });
    expect(faults.a).toMatchObject({
      code: "reads-faulted-formula",
      message: "formula.a reads formula.worse, which has a mistake.",
      location: { argument: "formulas", path: "a", span: { from: 0, to: 13 } },
      report: [
        "formula.a reads formula.worse, which has a mistake.",
        "formula.worse + formula.bad",
        "^^^^^^^^^^^^^",
        faults.worse!.message,
        "Correct the mistake in formula.worse.",
      ],
    });
    expect(faults.b).toMatchObject({
      code: "reads-faulted-formula",
      message: "formula.b reads formula.a, which has a mistake.",
      hint: "Correct the mistake in formula.worse.",
    });
    expect(faults.worse).toMatchObject({
      code: "unknown-function",
      location: { argument: "formulas", path: "worse" },
    });
  });

  it.each([
    [
      "an invalid Formula name",
      { formulas: { "2nd": "title", ok: "date.year" }, fields: ["formula.ok"] },
      { "2nd": "invalid-formula-name" },
    ],
    [
      "an invalid Formula name that fields reads",
      {
        formulas: { "2nd": "date.year", ok: "date.year" },
        fields: ["formula.2nd", "formula.ok"],
      },
      { "2nd": "invalid-formula-name" },
    ],
    [
      "a cycle",
      {
        formulas: { a: "formula.b + 1", b: "formula.a * 2", ok: "date.year" },
        fields: ["formula.a", "formula.ok"],
      },
      { a: "formula-cycle", b: "formula-cycle" },
    ],
    [
      "a read of an undefined Formula",
      {
        formulas: { a: "formula.zz + 1", ok: "date.year" },
        fields: ["formula.a", "formula.ok"],
      },
      { a: "unknown-formula" },
    ],
    [
      "a result type that a Query Row cannot hold",
      {
        formulas: { a: "/x/", ok: "date.year" },
        fields: ["formula.a", "formula.ok"],
      },
      { a: "invalid-formula-result" },
    ],
    [
      "a syntax mistake",
      {
        formulas: { a: "date.year +", ok: "date.year" },
        fields: ["formula.a", "formula.ok"],
      },
      { a: "invalid-filter" },
    ],
    [
      "a name that is no field and no custom field of the source",
      {
        formulas: { a: "dat", b: "formula.a + 1", ok: "date.year" },
        fields: ["formula.b", "formula.ok"],
      },
      { a: "unknown-field", b: "reads-faulted-formula" },
    ],
    [
      "a property of a name that is no custom field of the source",
      {
        formulas: { a: "dat.year", ok: "date.year" },
        fields: ["formula.a", "formula.ok"],
      },
      { a: "unknown-property" },
    ],
    [
      "a Formula that fields reads and the request does not define",
      { formulas: { ok: "date.year" }, fields: ["formula.zz", "formula.ok"] },
      { zz: "unknown-formula" },
    ],
  ] satisfies [
    string,
    Omit<ItemQueryRequest, "libraries">,
    Record<string, string>,
  ][])("leaves out only the Formula for %s", async (_, request, codes) => {
    const result = await run(scenario, {
      filter: 'indexedKey == "BK2MNTH2"',
      ...request,
      onFormulaFault: "leave-out",
    });
    expect(result.rows!.map((row) => row.values)).toEqual([
      { "formula.ok": 2019 },
    ]);
    expect(
      Object.fromEntries(
        Object.entries(result.formulaDiagnostics!).map(([name, fault]) => [
          name,
          fault.code,
        ]),
      ),
    ).toEqual(codes);
  });

  it("marks each Formula on a cycle with the cycle from it, and a Formula that reads into the cycle as a reader", async () => {
    const result = await run(scenario, {
      filter: 'indexedKey == "BK2MNTH2"',
      formulas: {
        out: "formula.a",
        a: "formula.b + 1",
        b: "formula.c * 2",
        c: "date.year + formula.a",
      },
      fields: ["formula.out"],
      onFormulaFault: "leave-out",
    });
    const faults = result.formulaDiagnostics!;
    expect(Object.keys(faults).sort()).toEqual(["a", "b", "c", "out"]);
    expect(faults.out).toMatchObject({
      code: "reads-faulted-formula",
      message: "formula.out reads formula.a, which has a mistake.",
    });
    expect(faults.a).toMatchObject({
      code: "formula-cycle",
      message:
        "The Formulas read each other in a cycle: formula.a → formula.b → formula.c → formula.a.",
      location: { argument: "formulas", path: "a", span: { from: 0, to: 9 } },
    });
    expect(faults.b).toMatchObject({
      code: "formula-cycle",
      message:
        "The Formulas read each other in a cycle: formula.b → formula.c → formula.a → formula.b.",
      location: { argument: "formulas", path: "b", span: { from: 0, to: 9 } },
    });
    expect(faults.c).toMatchObject({
      code: "formula-cycle",
      message:
        "The Formulas read each other in a cycle: formula.c → formula.a → formula.b → formula.c.",
      location: {
        argument: "formulas",
        path: "c",
        span: { from: 12, to: 21 },
      },
    });
  });

  it("marks each Formula on any cycle with a cycle from it, also where two cycles share a Formula", async () => {
    const result = await run(scenario, {
      filter: 'indexedKey == "BK2MNTH2"',
      formulas: {
        a: "formula.b + formula.c",
        b: "formula.a",
        c: "formula.a",
        ok: "date.year",
      },
      fields: ["formula.a", "formula.ok"],
      onFormulaFault: "leave-out",
    });
    const faults = result.formulaDiagnostics!;
    expect(Object.keys(faults).sort()).toEqual(["a", "b", "c"]);
    expect(faults.a).toMatchObject({
      code: "formula-cycle",
      message:
        "The Formulas read each other in a cycle: formula.a → formula.b → formula.a.",
    });
    expect(faults.b).toMatchObject({
      code: "formula-cycle",
      message:
        "The Formulas read each other in a cycle: formula.b → formula.a → formula.b.",
    });
    expect(faults.c).toMatchObject({
      code: "formula-cycle",
      message:
        "The Formulas read each other in a cycle: formula.c → formula.a → formula.c.",
      location: { argument: "formulas", path: "c", span: { from: 0, to: 9 } },
    });
  });

  it("fails a filter that reads a wrong Formula with the Diagnostic of a Formula of fields that names a custom field the source lacks", async () => {
    const error = await failure(scenario, {
      filter: "formula.bad > 0",
      formulas: { bad: "title * 2", missing: 'custom["absent"]' },
      fields: ["title", "formula.missing"],
      onFormulaFault: "leave-out",
    });
    expect(error.diagnostic).toMatchObject({
      code: "reads-faulted-formula",
      location: { argument: "filter" },
    });
    expect(
      Object.fromEntries(
        Object.entries(error.formulaDiagnostics!).map(([name, fault]) => [
          name,
          fault.code,
        ]),
      ),
    ).toEqual({ bad: "wrong-operand-type", missing: "unknown-field" });
  });

  it("plans every Formula that the request reads, also after a reader's first read of a wrong Formula", async () => {
    const error = await failure(scenario, {
      filter: "formula.bad > 0 && formula.reader > 0",
      formulas: {
        bad: "title * 2",
        reader: "formula.bad + formula.deep",
        deep: "formula.worse",
        worse: "title.nope()",
        unread: "title * 3",
      },
      fields: ["title"],
      onFormulaFault: "leave-out",
    });
    expect(error.diagnostic).toMatchObject({
      code: "reads-faulted-formula",
      message: "The filter reads formula.bad, which has a mistake.",
    });
    expect(
      Object.fromEntries(
        Object.entries(error.formulaDiagnostics!).map(([name, fault]) => [
          name,
          fault.code,
        ]),
      ),
    ).toEqual({
      bad: "wrong-operand-type",
      reader: "reads-faulted-formula",
      deep: "reads-faulted-formula",
      worse: "unknown-function",
    });
    expect(error.formulaDiagnostics!.reader!.message).toBe(
      "formula.reader reads formula.bad, which has a mistake.",
    );
  });

  it("gives no Diagnostic and no Formula fault for an answer without a mistake", async () => {
    const result = await run(scenario, {
      filter: 'indexedKey == "BK2MNTH2"',
      formulas: { ok: "date.year", unused: "title" },
      fields: ["formula.ok"],
      onFormulaFault: "leave-out",
    });
    expect({ ...result.formulaDiagnostics }).toEqual({});
    // A Formula that no part of the request reads gives no warning: the
    // caller sends Formulas that other requests read.
    expect(result.warnings).toEqual([]);
  });

  it("gives the Formula fault of an undefined column of fields when the filter reads a wrong Formula", async () => {
    const error = await failure(scenario, {
      filter: "formula.bad > 0",
      formulas: { bad: "title * 2" },
      fields: ["title", "formula.zz"],
      onFormulaFault: "leave-out",
    });
    expect(error.diagnostic).toMatchObject({
      code: "reads-faulted-formula",
      location: { argument: "filter" },
    });
    expect(
      Object.fromEntries(
        Object.entries(error.formulaDiagnostics!).map(([name, fault]) => [
          name,
          fault.code,
        ]),
      ),
    ).toEqual({ bad: "wrong-operand-type", zz: "unknown-formula" });
  });

  it("fails a filter that reads a wrong Formula at the filter, with the root mistake as a note and every Formula fault", async () => {
    const error = await failure(scenario, {
      filter: "title != null && formula.a > 0",
      formulas: {
        a: "formula.bad + 1",
        bad: "title * 2",
        shown: "title.nope()",
      },
      fields: ["title", "formula.shown"],
      onFormulaFault: "leave-out",
    });
    expect(error.diagnostic).toMatchObject({
      code: "reads-faulted-formula",
      message: "The filter reads formula.a, which has a mistake.",
      location: { argument: "filter", span: { from: 17, to: 26 } },
      report: [
        "The filter reads formula.a, which has a mistake.",
        "title != null && formula.a > 0",
        "                 ^^^^^^^^^",
        "In formula.bad: The operator * cannot use a string and a number.",
        "Correct the mistake in formula.bad.",
      ],
    });
    expect(
      Object.fromEntries(
        Object.entries(error.formulaDiagnostics!).map(([name, fault]) => [
          name,
          fault.code,
        ]),
      ),
    ).toEqual({
      a: "reads-faulted-formula",
      bad: "wrong-operand-type",
      shown: "unknown-function",
    });
  });

  it("fails a filter that reads a Formula with a custom field that the source lacks at the filter", async () => {
    const error = await failure(scenario, {
      filter: "formula.a > 0",
      formulas: { a: "dat", ok: "date.year" },
      fields: ["title", "formula.ok"],
      onFormulaFault: "leave-out",
    });
    expect(error.diagnostic).toMatchObject({
      code: "reads-faulted-formula",
      message: "The filter reads formula.a, which has a mistake.",
      location: { argument: "filter", span: { from: 0, to: 9 } },
    });
    expect(
      Object.fromEntries(
        Object.entries(error.formulaDiagnostics!).map(([name, fault]) => [
          name,
          fault.code,
        ]),
      ),
    ).toEqual({ a: "unknown-field" });
  });

  it("fails a filter that reads a wrong Formula with the root mistake when the request fails on it", async () => {
    const error = await failure(scenario, {
      filter: "formula.a > 0",
      formulas: { a: "formula.bad + 1", bad: "title * 2" },
      fields: ["title"],
    });
    expect(error.diagnostic).toMatchObject({
      code: "wrong-operand-type",
      location: { argument: "formulas", path: "bad" },
    });
    expect(error.formulaDiagnostics).toBeUndefined();
  });
});

describe.each(["fail", "leave-out"] as const)(
  'onFormulaFault: "%s" fails the whole run',
  (policy) => {
    it.each([
      [
        'for formula["x"] in fields',
        { formulas: { x: "date.year" }, fields: ['formula["x"]'] },
        "invalid-path",
      ],
      [
        "for a sort by a Formula",
        {
          formulas: { x: "date.year" },
          fields: ["formula.x"],
          sort: [{ field: "formula.x", direction: "asc" }],
        },
        "unsortable-field",
      ],
      [
        "for a group by a Formula",
        {
          formulas: { x: "date.year" },
          fields: ["formula.x"],
          group: "formula.x",
        },
        "invalid-group",
      ],
      [
        "for a mistake outside a Formula",
        { formulas: { x: "title * 2" }, fields: ["titel", "formula.x"] },
        "unknown-field",
      ],
      [
        "for a mistake in the filter text",
        {
          filter: "title.nope()",
          formulas: { x: "title * 2" },
          fields: ["formula.x"],
        },
        "unknown-function",
      ],
    ] satisfies [string, Omit<ItemQueryRequest, "libraries">, string][])(
      "%s",
      async (_, request, code) => {
        const error = await failure(scenario, {
          ...request,
          onFormulaFault: policy,
        });
        expect(error.diagnostic.code).toBe(code);
      },
    );
  },
);
