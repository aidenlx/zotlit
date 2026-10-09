import { Cause, Exit } from "effect";
import { expect, it } from "vitest";

import { openScenarioDatabase } from "@zotlit/db/test-scenario";

import { diagnose, renderDiagnostic } from "./diagnose";
import reports from "./diagnostic-reports.json";
import { ItemQueryError } from "./error";
import { queryItems } from "./query-items";
import type { ItemQueryRequest } from "./request";
import { runEffect } from "./test-helpers";

it("reports an unknown global from the function registry", () => {
  const diagnostic = diagnose(
    {
      kind: "unknown",
      role: "global",
      name: "contains",
      at: { from: 0, to: 8 },
    },
    'contains(title, "x")',
    { argument: "filter" },
  );

  expect(diagnostic).toMatchObject({
    code: "unknown-function",
    message: '"contains" is not a global function of Item Query.',
    hint: "Use a global function: if, number, min, max, now, today, date, duration, list.",
    found: "contains",
    expected: [
      "if",
      "number",
      "min",
      "max",
      "now",
      "today",
      "date",
      "duration",
      "list",
    ],
    suggestions: [],
  });
  expect(diagnostic.report).toEqual([
    '"contains" is not a global function of Item Query.',
    'contains(title, "x")',
    "^^^^^^^^",
    "`contains` is a method; call it on a value as `value.contains(...)`.",
    "Use a global function: if, number, min, max, now, today, date, duration, list.",
  ]);
});

it("ranks field names and replaces the full filter for one near match", () => {
  const title = diagnose(
    {
      kind: "unknown",
      role: "field",
      name: "Title",
      at: { from: 0, to: 5 },
    },
    'Title.contains("x")',
    { argument: "filter" },
  );
  const year = diagnose(
    {
      kind: "unknown",
      role: "field",
      name: "year",
      at: { from: 0, to: 4 },
    },
    "year > 2015",
    { argument: "filter" },
  );

  expect(title.suggestions).toEqual(["title"]);
  expect(title.hint).toBe('Try: title.contains("x")');
  expect(year.suggestions).toEqual([
    "date.year",
    "issueDate.year",
    "filingDate.year",
  ]);
  expect(year.hint).toBe("Try: date.year");
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
    { argument: "filter" },
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
    { argument: "filter" },
  );

  expect(includes.expected).toEqual([
    "toString",
    "isType",
    "isTruthy",
    "isEmpty",
    "lower",
    "startsWith",
    "endsWith",
    "contains",
    "containsAny",
    "containsAll",
    "trim",
    "title",
    "repeat",
    "reverse",
    "slice",
    "replace",
    "split",
  ]);
  expect(includes.suggestions).toEqual([]);
  expect(some.expected).toContain("filter");
  expect(some.suggestions).toEqual([]);
});

it("gets a function's real signature without source text", () => {
  const error = new ItemQueryError({
    fault: {
      kind: "unknown",
      role: "field",
      name: "now",
      at: { from: 0, to: 3 },
    },
    location: { argument: "filter", span: { from: 0, to: 3 } },
  });

  expect(error.message).toBe('"now" is a function, not a field.');
  expect(error.hint).toBe(
    "Use a field from the Item Query Schema; field names are case-sensitive.",
  );
  expect(diagnose(error.fault, "", error.location).report).toContain(
    "`now` is a function; call it as `now()`.",
  );
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
    { argument: "filter" },
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
    { argument: "filter" },
  );

  expect(methodCall.report).toContain(
    "`length` is a property; read it as `value.length`.",
  );
  expect(propertyRead.report).toContain(
    "`lower` is a method; call it as `value.lower(...)`.",
  );
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
    { argument: "filter" },
  );

  expect(diagnostic.hint).toBe("Try: /re/.matches(title)");
  expect(diagnostic.suggestions).toEqual(["/re/.matches(title)"]);
});

// Golden diagnostic reports, with excerpt and caret lines. The first 24 entries
// are the spec's probe cases; the rest replace the former sentence tests.
it.each(reports)("reports $name", async ({ request, report }) => {
  using scenario = openScenarioDatabase();
  const query: ItemQueryRequest = {
    libraries: [{ libraryID: 1, groupID: null }],
    ...request,
  } as ItemQueryRequest;
  const { exit } = await runEffect(queryItems(query), { client: scenario.db });
  if (Exit.isSuccess(exit)) {
    expect(exit.value.warnings).toHaveLength(1);
    const diagnostic = exit.value.warnings[0]!;
    expect(diagnostic.report).toEqual(report);
    expect(diagnostic.report[0]).toBe(diagnostic.message);
    expect(diagnostic.report.at(-1)).toBe(diagnostic.hint);
    expect(diagnostic.severity).toBe("warning");
    return;
  }
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None" || error.value._tag !== "ItemQueryError")
    throw new Error("Expected an Item Query fault");
  const diagnostic = diagnose(
    error.value.fault,
    query.filter ?? "",
    error.value.location,
  );
  expect(diagnostic.report).toEqual(report);
  expect(diagnostic.report[0]).toBe(diagnostic.message);
  expect(diagnostic.report.at(-1)).toBe(diagnostic.hint);
  expect(diagnostic.severity).toBe("error");
  if (error.value.fault.kind === "plain") {
    expect(diagnostic).toMatchObject({
      found: "",
      expected: [],
      suggestions: [],
    });
  } else if (error.value.fault.kind === "unknown") {
    expect(diagnostic.found).toBe(error.value.fault.name);
  }
  const span = diagnostic.location?.span;
  if (span)
    expect(diagnostic.excerpt?.at).toBe(
      query.filter?.slice(span.from, span.to),
    );
  else expect(diagnostic.excerpt).toBeUndefined();
});

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
    { argument: "filter" },
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
    { argument: "filter" },
  );
  expect(diagnostic.suggestions).toEqual([]);
});

// Failure modes: successful warnings must reach the result, suggest membership,
// and mark both operands without changing the matching rows.
it("returns a membership warning with an empty successful result", async () => {
  using scenario = openScenarioDatabase();
  const { exit } = await runEffect(
    queryItems({
      libraries: [{ libraryID: 1, groupID: null }],
      filter: 'tags == "bulk"',
    }),
    { client: scenario.db },
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
    using scenario = openScenarioDatabase();
    const { exit } = await runEffect(
      queryItems({ libraries: [{ libraryID: 1, groupID: null }], filter }),
      { client: scenario.db },
    );
    if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
    expect(exit.value.warnings).toHaveLength(1);
    const warning = exit.value.warnings[0]!;
    expect(warning.suggestions).toEqual(correction ? [correction] : []);
    if (
      filter.includes("&&") ||
      filter.includes("||") ||
      filter.startsWith("!")
    )
      expect(warning.message).not.toContain("The filter selects every Item");
  },
);

it("keeps source order and aligns escaped operand markers", async () => {
  using scenario = openScenarioDatabase();
  const filter = '"a\\tb" == 3 || tags != "x"';
  const { exit } = await runEffect(
    queryItems({
      libraries: [{ libraryID: 1, groupID: null }],
      filter,
    }),
    { client: scenario.db },
  );
  if (!Exit.isSuccess(exit)) throw new Error(String(exit.cause));
  expect(exit.value.warnings.map((warning) => warning.code)).toEqual([
    "never-true",
    "always-true",
  ]);
  expect(exit.value.warnings[0]!.report[2]).toBe("---------    ^");
  expect(exit.value.warnings[1]!.message).not.toContain(
    "The filter selects every Item",
  );
});
