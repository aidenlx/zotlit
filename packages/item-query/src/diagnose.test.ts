import { Cause, Exit } from "effect";
import { expect, it } from "vitest";

import { openScenarioDatabase } from "@zotlit/db/test-scenario";

import { diagnose, renderDiagnostic } from "./diagnose";
import reports from "./diagnostic-reports.json";
import { queryItems } from "./query-items";
import type { ItemQueryRequest } from "./request";
import { runEffect } from "./test-helpers";

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
  expect(diagnostic).toMatchObject({
    severity: "error",
  });
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
