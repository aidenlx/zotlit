import { Cause, Exit } from "effect";
import { expect, it } from "vitest";

import { openScenarioDatabase } from "@zotlit/db/test-scenario";

import { diagnose, renderDiagnostic } from "./diagnose";
import reports from "./diagnostic-reports.json";
import { queryItems } from "./query-items";
import type { ItemQueryRequest } from "./request";
import { runEffect } from "./test-helpers";

// Golden v1 sentences, with v2 excerpt and caret lines. The first 24 entries
// are the spec's probe cases; the rest replace the former sentence tests.
it.each(reports)("reports $name", async ({ request, report }) => {
  using scenario = openScenarioDatabase();
  const query: ItemQueryRequest = {
    libraries: [{ libraryID: 1, groupID: null }],
    ...request,
  } as ItemQueryRequest;
  const { exit } = await runEffect(queryItems(query), { client: scenario.db });
  if (Exit.isSuccess(exit)) throw new Error("Expected a fault");
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
    suggestions: [],
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
