import { Cause, Exit } from "effect";
import { afterAll, beforeAll, expect, it } from "vitest";

import { openScenarioDatabase } from "@zotlit/db/test-scenario";
import type { ScenarioDatabase } from "@zotlit/db/test-scenario";

import type { QueryDataset } from "./dataset";
import { diagnose, diagnoseDecode, renderDiagnostic } from "./diagnose";
import reports from "./diagnostic-reports.json";
import { ItemQueryError } from "./error";
import { collectQuery } from "./query";
import { ANNOTATIONS } from "./query-annotations";
import { ATTACHMENTS } from "./query-attachments";
import { ITEMS } from "./query-items";
import type { ItemQueryRequest, QueryResult } from "./request";
import { describeQueryVocabulary } from "./schema";
import { runEffect } from "./test-helpers";

// Read-only scenarios; a test that changes the database opens its own.
let shared: ScenarioDatabase;
let sharedAnnotations: ScenarioDatabase;

beforeAll(() => {
  shared = openScenarioDatabase();
  sharedAnnotations = openScenarioDatabase({ annotations: true });
});

afterAll(() => {
  shared.close();
  sharedAnnotations.close();
});

const vocabulary = describeQueryVocabulary();

/** The hint line of a golden report, the canonical text of that diagnostic. */
function goldenHint(name: string): string {
  const entry = reports.find((report) => report.name === name);
  if (!entry) throw new Error(`No golden report named ${name}`);
  return entry.report.at(-1)!;
}

it("accepts every suggested correction for group Faults", async () => {
  const failures: string[] = [];
  let checked = 0;
  for (const dataset of [ITEMS, ATTACHMENTS, ANNOTATIONS]) {
    const paths = vocabulary.datasets[dataset.id].fields
      .filter((field) => !field.group)
      .map((field) => field.path);
    if (dataset === ITEMS)
      paths.push(
        "attachments[].tags",
        "attachments[].item.collections",
        "attachments[].tags[]",
      );
    for (const group of paths) {
      const { exit } = await runEffect(
        collectQuery(dataset, { libraries: [], fields: [], group }),
        { client: shared.db },
      );
      if (!Exit.isFailure(exit))
        throw new Error(`Expected a Fault for ${group}`);
      const error = Cause.findErrorOption(exit.cause);
      if (error._tag === "None" || !(error.value instanceof ItemQueryError))
        throw new Error(String(exit.cause));
      if (error.value.fault.kind !== "group") continue;
      for (const suggestion of error.value.diagnostic.suggestions) {
        checked++;
        expect(suggestion.startsWith("group='")).toBe(true);
        expect(suggestion.endsWith("'")).toBe(true);
        const corrected = suggestion.slice("group='".length, -1);
        const { exit: result } = await runEffect(
          collectQuery(dataset, {
            libraries: [],
            fields: [],
            group: corrected,
          }),
          { client: shared.db },
        );
        if (Exit.isFailure(result))
          failures.push(`${dataset.id}: ${group} → ${suggestion}`);
      }
    }
  }
  expect(checked).toBeGreaterThan(0);
  expect(failures).toEqual([]);
});

it.each([
  [ITEMS, "creators.fullName", "creators[].fullName"],
  [ANNOTATIONS, "item.creators.fullName", "item.creators[].fullName"],
] as const)(
  "suggests explicit element projection on $1",
  async (dataset, path, corrected) => {
    const { exit } = await runEffect(
      collectQuery(dataset, { libraries: [], fields: [path] }),
    );
    if (!Exit.isFailure(exit)) throw new Error("the query did not fail");
    const error = Cause.findErrorOption(exit.cause);
    if (error._tag === "None") throw new Error(String(exit.cause));
    expect(error.value).toBeInstanceOf(ItemQueryError);
    expect((error.value as ItemQueryError).diagnostic).toMatchObject({
      code: "unknown-path",
      suggestions: [`fields='["${corrected}"]'`],
      excerpt: { at: path },
    });
  },
);

it("reports a non-list Projection Path before reading rows", async () => {
  const { exit } = await runEffect(
    collectQuery(ITEMS, { libraries: [], fields: ["title[]"] }),
  );
  if (!Exit.isFailure(exit)) throw new Error("the query did not fail");
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") throw new Error(String(exit.cause));
  expect((error.value as ItemQueryError).diagnostic).toMatchObject({
    code: "unknown-path",
    found: "scalar",
    expected: ["list"],
  });
  expect((error.value as ItemQueryError).diagnostic.message).toContain(
    "is not a list",
  );
});

it("reports an unknown global from the function registry", () => {
  const diagnostic = diagnose(
    {
      kind: "unknown",
      role: "global",
      name: "contains",
      at: { from: 0, to: 8 },
    },
    'contains(title, "x")',
    { argument: "filter", dataset: ITEMS },
  );

  expect(diagnostic).toMatchObject({
    code: "unknown-function",
    found: "contains",
    expected: vocabulary.functions.map((entry) => entry.name),
    suggestions: [],
  });
});

it("ranks field name corrections", () => {
  const title = diagnose(
    {
      kind: "unknown",
      role: "field",
      name: "Title",
      at: { from: 0, to: 5 },
    },
    'Title.contains("x")',
    { argument: "filter", dataset: ITEMS },
  );
  const year = diagnose(
    {
      kind: "unknown",
      role: "field",
      name: "year",
      at: { from: 0, to: 4 },
    },
    "year > 2015",
    { argument: "filter", dataset: ITEMS },
  );

  expect(title.suggestions).toEqual(["title"]);
  expect(year.suggestions).toEqual([
    "date.year",
    "issueDate.year",
    "filingDate.year",
  ]);
});

it("uses only the receiver type's registered names without aliases", () => {
  const includes = diagnose(
    {
      kind: "unknown",
      role: "method",
      name: "includes",
      at: { from: 6, to: 14 },
      receiver: {
        type: "string",
        at: { from: 0, to: 5 },
        field: "title",
      },
    },
    'title.includes("x")',
    { argument: "filter", dataset: ITEMS },
  );
  const some = diagnose(
    {
      kind: "unknown",
      role: "method",
      name: "some",
      at: { from: 9, to: 13 },
      receiver: {
        type: "list",
        at: { from: 0, to: 8 },
        field: "creators",
      },
    },
    'creators.some(name == "Smith")',
    { argument: "filter", dataset: ITEMS },
  );

  const methodsOf = (type: string) => [
    ...new Set(
      vocabulary.methods
        .filter((entry) => entry.on === "any" || entry.on === type)
        .map((entry) => entry.name),
    ),
  ];
  expect(includes.expected).toEqual(methodsOf("string"));
  expect(includes.suggestions).toEqual([]);
  expect(some.expected).toEqual(methodsOf("list"));
  expect(some.suggestions).toEqual([]);
});

it("keeps legacy diagnostic fields without source text", () => {
  const error = new ItemQueryError({
    fault: {
      kind: "unknown",
      role: "field",
      name: "now",
      at: { from: 0, to: 3 },
    },
    dataset: ITEMS,
    location: { argument: "filter", span: { from: 0, to: 3 } },
  });

  const diagnostic = error.diagnostic;
  expect(diagnostic).toMatchObject({ code: "unknown-field", found: "now" });
  expect(error.hint).toBe(goldenHint("F13-function-as-field"));
});

it("names a method and property used in the other form", () => {
  const receiver = {
    type: "string" as const,
    at: { from: 0, to: 5 },
    field: "title",
  };
  const methodCall = diagnose(
    {
      kind: "unknown",
      role: "method",
      name: "length",
      at: { from: 6, to: 12 },
      receiver,
    },
    "title.length()",
    { argument: "filter", dataset: ITEMS },
  );
  const propertyRead = diagnose(
    {
      kind: "unknown",
      role: "property",
      name: "lower",
      at: { from: 6, to: 11 },
      receiver,
    },
    "title.lower",
    { argument: "filter", dataset: ITEMS },
  );

  expect(methodCall.hint).toBe(goldenHint("property called as method"));
  expect(propertyRead.hint).toBe(goldenHint("method read as property"));
});

it("uses a registered global signature for a global called as a method", () => {
  const diagnostic = diagnose(
    {
      kind: "unknown",
      role: "method",
      name: "number",
      at: { from: 6, to: 12 },
      receiver: {
        type: "string",
        at: { from: 0, to: 5 },
        field: "title",
      },
    },
    "title.number()",
    { argument: "filter", dataset: ITEMS },
  );

  expect(diagnostic.hint).toBe(goldenHint("title.number()"));
});

it("prefers an exact cross-role action to an unrelated near match", () => {
  const diagnostic = diagnose(
    {
      kind: "unknown",
      role: "method",
      name: "max",
      at: { from: 5, to: 8 },
      receiver: {
        type: "list",
        at: { from: 0, to: 4 },
        field: "tags",
      },
    },
    "tags.max()",
    { argument: "filter", dataset: ITEMS },
  );

  expect(diagnostic.suggestions).toEqual(["map"]);
});

it("swaps a receiver with the one argument when the registered method fits", () => {
  const diagnostic = diagnose(
    {
      kind: "unknown",
      role: "method",
      name: "matches",
      at: { from: 6, to: 13 },
      receiver: {
        type: "string",
        at: { from: 0, to: 5 },
        field: "title",
      },
    },
    "title.matches(/re/)",
    { argument: "filter", dataset: ITEMS },
  );

  expect(diagnostic.suggestions).toEqual(["/re/.matches(title)"]);
});

it("lists attachment.indexedKey among the Annotation Sortable Fields", async () => {
  const { exit } = await runEffect(
    collectQuery(ANNOTATIONS, {
      libraries: [{ libraryID: 1, groupID: null }],
      sort: [{ field: "noSuchField", direction: "asc" }],
    }),
    { client: sharedAnnotations.db },
  );
  const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : null;
  if (error?._tag !== "Some" || error.value._tag !== "ItemQueryError")
    throw new Error("Expected an Item Query fault");
  expect(error.value.diagnostic).toMatchObject({
    code: "unknown-field",
    found: "noSuchField",
  });
  expect(error.value.diagnostic.expected).toContain("attachment.indexedKey");
});

// Golden diagnostic reports, with excerpt and caret lines. The first 24 entries
// are the spec's probe cases; the rest replace the former sentence tests.
it.each(reports)("reports $name", async ({ request, report, ...setup }) => {
  const dataset =
    "dataset" in setup && setup.dataset === "annotations" ? ANNOTATIONS : ITEMS;
  const withoutCustomFields =
    "withoutCustomFields" in setup && setup.withoutCustomFields;
  // A case that changes the source opens its own copy.
  using changed =
    withoutCustomFields || setup.customFieldName !== undefined
      ? openScenarioDatabase({ annotations: dataset === ANNOTATIONS })
      : undefined;
  if (changed && withoutCustomFields)
    changed.sqlite.exec("update fieldsCombined set custom = 0");
  if (changed && setup.customFieldName !== undefined)
    changed.sqlite
      .prepare(
        "update fieldsCombined set fieldName = ? where fieldName = 'review.status'",
      )
      .run(setup.customFieldName);
  const scenario =
    changed ?? (dataset === ANNOTATIONS ? sharedAnnotations : shared);
  const query: ItemQueryRequest = {
    libraries: [{ libraryID: 1, groupID: null }],
    ...request,
  } as ItemQueryRequest;
  const { exit } = await runEffect(collectQuery(dataset, query), {
    client: scenario.db,
  });
  const outcome = goldenOutcome(exit, dataset);
  // A read that succeeds reports one warning; a read that fails, its Fault.
  expect(outcome.diagnostics).toHaveLength(1);
  const diagnostic = outcome.diagnostics[0]!;
  expect(outcome.dataset).toBe(dataset);
  expect(diagnostic.report).toEqual(report);
  expect(diagnostic.severity).toBe(outcome.severity);
  expect(diagnostic).toMatchObject(faultFields(outcome.fault));
  // The excerpt shows the source span, else the indexed entry, else nothing.
  const location = diagnostic.location;
  const span = location?.span;
  const argument = location?.argument === "group" ? query.group : query.filter;
  const index = diagnostic.excerpt && location?.index;
  const entry =
    location?.argument === "sort"
      ? query.sort?.[index ?? -1]?.field
      : query.fields?.[index ?? -1];
  const excerpted = Boolean(span) || index !== undefined;
  expect(excerpted ? diagnostic.excerpt?.at : diagnostic.excerpt).toBe(
    span ? argument?.slice(span.from, span.to) : excerpted ? entry : undefined,
  );
});

/** The diagnostics of a golden case: the warnings of a read of the dataset, or its Fault. */
function goldenOutcome(
  exit: Exit.Exit<QueryResult, unknown>,
  dataset: QueryDataset,
) {
  if (Exit.isSuccess(exit))
    return {
      severity: "warning",
      diagnostics: exit.value.warnings,
      dataset,
      fault: undefined,
    } as const;
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None" || !(error.value instanceof ItemQueryError))
    throw new Error("Expected an Item Query fault");
  return {
    severity: "error",
    diagnostics: [error.value.diagnostic],
    dataset: error.value.dataset,
    fault: error.value.fault,
  } as const;
}

/** The diagnostic fields a Fault fixes regardless of its report. */
function faultFields(fault: ItemQueryError["fault"] | undefined) {
  if (fault?.kind === "plain")
    return { found: "", expected: [], suggestions: [] };
  if (fault?.kind === "unknown")
    return { found: fault.pathResolution?.found ?? fault.name };
  return {};
}

// Failure modes: escaped prefixes must not shift carets, zero-width spans
// need a visible marker, and context must remain bounded on both sides.
it.each([
  { text: '"\\\t\n\r\u0000bad', from: 6, to: 9, column: 16, width: 3 },
  { text: '"x"', from: 3, to: 3, column: 5, width: 1 },
  {
    text: `${"a".repeat(100)}bad${"z".repeat(100)}`,
    from: 100,
    to: 103,
    column: 40,
    width: 3,
  },
])(
  "aligns and windows $from..$to in pretty JSON",
  ({ text, from, to, column, width }) => {
    const diagnostic = renderDiagnostic(
      {
        code: "test",
        message: "message",
        hint: "action",
        location: { span: { from, to } },
      },
      text,
    );
    expect(diagnostic.report[0]).toBe("message");
    expect(diagnostic.report.at(-1)).toBe("action");
    expect(diagnostic.report[2]).toBe(" ".repeat(column) + "^".repeat(width));
    expect(diagnostic.excerpt?.at).toBe(text.slice(from, to));
    expect(diagnostic.excerpt!.before.length).toBeLessThanOrEqual(40);
    expect(diagnostic.excerpt!.after.length).toBeLessThanOrEqual(40);
  },
);

// Syntax corrections depend on the stopped grammar's expected operators.
it("offers an AND correction as data", () => {
  const diagnostic = diagnose(
    {
      kind: "syntax",
      fault: {
        from: 2,
        to: 5,
        found: "AND",
        expected: ["&&", "end of filter"],
        opened: null,
      },
    },
    "a AND b",
    { argument: "filter", dataset: ITEMS },
  );
  expect(diagnostic).toMatchObject({
    found: "AND",
    expected: ["&&", "end of filter"],
    suggestions: ["a && b"],
  });
});

it("keeps syntax suggestions empty without source text", () => {
  const diagnostic = diagnose(
    {
      kind: "syntax",
      fault: { from: 2, to: 5, found: "AND", expected: ["&&"], opened: null },
    },
    "",
    { argument: "filter", dataset: ITEMS },
  );
  expect(diagnostic.suggestions).toEqual([]);
});

// Failure modes: successful warnings must reach the result, suggest membership,
// and mark both operands without changing the matching rows.
it("returns a membership warning with an empty successful result", async () => {
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [{ libraryID: 1, groupID: null }],
      filter: 'tags == "bulk"',
    }),
    { client: shared.db },
  );
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  expect(exit.value.rows).toEqual([]);
  expect(exit.value.warnings).toMatchObject([
    {
      code: "never-true",
      severity: "warning",
      suggestions: ['tags.contains("bulk")'],
      excerpt: { at: 'tags == "bulk"' },
    },
  ]);
});

// Corrections preserve the comparison relation and the surrounding expression.
// Ambiguous signatures, invalid conversions, and executable strings offer no Try.
it.each([
  ['tags != "bulk" && title == "x"', '!tags.contains("bulk") && title == "x"'],
  ['tags < "bulk"', undefined],
  ['date.year == "-2019"', "date.year == -2019"],
  ['date.year == "2019junk"', undefined],
  ['date.year == "1 + 2"', undefined],
  ['date.year == "now()"', undefined],
  ['date.year == "title"', undefined],
  ['date.year == ""', undefined],
  ['dateAdded > "bad"', undefined],
  ['(tags + ["x"]) == "bulk"', '(tags + ["x"]).contains("bulk")'],
  ['tags == "bulk" || title == "x"', 'tags.contains("bulk") || title == "x"'],
  ['!(tags == "bulk")', '!(tags.contains("bulk"))'],
] as const)(
  "offers only a valid correction: %s",
  async (filter, correction) => {
    const { exit } = await runEffect(
      collectQuery(ITEMS, {
        libraries: [{ libraryID: 1, groupID: null }],
        filter,
      }),
      { client: shared.db },
    );
    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value.warnings).toHaveLength(1);
    const warning = exit.value.warnings[0]!;
    expect(warning.suggestions).toEqual(correction ? [correction] : []);
  },
);

it("keeps source order and aligns escaped operand markers", async () => {
  const filter = '"a\\tb" == 3 || tags != "x"';
  const { exit } = await runEffect(
    collectQuery(ITEMS, {
      libraries: [{ libraryID: 1, groupID: null }],
      filter,
    }),
    { client: shared.db },
  );
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  expect(exit.value.warnings.map((warning) => warning.code)).toEqual([
    "never-true",
    "always-true",
  ]);
  expect(exit.value.warnings[0]!.report[2]).toBe("---------    ^");
  expect(exit.value.warnings[1]!.excerpt?.at).toBe('tags != "x"');
});

it("renders projection request facts with the JSON entry and a unique correction", () => {
  const diagnostic = diagnose(
    {
      kind: "unknown",
      role: "projection-path",
      name: "Date",
      at: { from: 0, to: 4 },
    },
    '["title","Date"]',
    { argument: "fields", index: 1, dataset: ITEMS },
  );
  expect(diagnostic).toMatchObject({
    code: "unknown-field",
    location: { index: 1, path: "fields[1]" },
    excerpt: { at: "Date" },
    suggestions: ['fields=\'["title","date"]\''],
  });
});

it.each([
  {
    name: "direction prefix",
    raw: '[{"field":"title","direction":"ascending"}]',
    input: "ascending",
    received: '"ascending"',
    path: "sort[0].direction",
    keys: [0, "direction"],
    allowed: ["asc", "desc"],
    expected: '("asc" | "desc")',
    report: [
      'sort[0].direction received "ascending"; expected "asc" or "desc".',
      "ascending",
      "^^^^^^^^^",
      'Try: sort=\'[{"field":"title","direction":"asc"}]\'',
    ],
  },
  {
    name: "missing direction",
    raw: '[{"field":"title"}]',
    input: undefined,
    received: "undefined",
    path: "sort[0].direction",
    keys: [0, "direction"],
    allowed: ["asc", "desc"],
    expected: '"direction"',
    report: [
      'sort[0].direction received undefined; expected "asc" or "desc".',
      "undefined",
      "^^^^^^^^^",
      "Correct sort.",
    ],
  },
  {
    name: "object instead of array",
    raw: '{"field":"title","direction":"asc"}',
    input: { field: "title", direction: "asc" },
    received: "Object",
    path: "sort",
    keys: [],
    expected: "Array",
    report: [
      'sort received {"field":"title","direction":"asc"}; expected Array.',
      '{"field":"title","direction":"asc"}',
      "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
      "Correct sort.",
    ],
  },
])(
  "reports decode $name",
  ({ raw, input, received, path, keys, allowed, expected, report }) => {
    const diagnostic = diagnoseDecode(
      {
        parameter: "sort",
        message: "Invalid sort.",
        received: [["sort", raw]],
        issue: {
          path,
          keys,
          input,
          received,
          expected,
          ...(allowed ? { allowed } : {}),
        },
      },
      "Correct sort.",
    );
    expect(diagnostic.report).toEqual(report);
  },
);

it("marks the received projection entry for a grammar fault", () => {
  const diagnostic = diagnose(
    {
      kind: "plain",
      code: "invalid-path",
      message: "Invalid path.",
      action: "Correct fields.",
      at: { from: 0, to: 5 },
    },
    '["title","date."]',
    { argument: "fields", index: 1, path: "fields[1]", dataset: ITEMS },
  );
  expect(diagnostic).toMatchObject({
    excerpt: { at: "date." },
    location: { path: "fields[1]" },
  });
  expect(diagnostic.location?.span).toBeUndefined();
});

// Decoder prose joins the golden reports here; adapter tests keep structured facts.
it.each(["0", "unlimited"])(
  "reports the count action for limit=%s",
  (limit) => {
    const diagnostic = diagnoseDecode(
      {
        parameter: "limit",
        message: "Invalid limit.",
        received: [["limit", limit]],
      },
      "Correct limit.",
    );
    expect(diagnostic.report).toEqual([
      "Invalid limit.",
      "To count every match, use fields='[]' limit=all.",
      "Correct limit.",
    ]);
  },
);
