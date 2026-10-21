import { describe, expect, it } from "vitest";

import { formulaCheck } from "./property-page";

// A Syntax Fault, a valid text, and an engine Fault on the saved text but
// not on an edited one are proved on the Formula page in the running app
// (query-view-properties e2e). Where the field underlines each Fault is the
// field's own behavior, proved through MatchExpressionInput in
// @zotlit/workbench.
describe("what the formula page reports", () => {
  it("reports an empty formula, which the status line explains", () => {
    const check = formulaCheck("", null);
    expect(check.issue).not.toBeNull();
    expect(check.fault).toBeUndefined();
  });

  it("reports an engine Fault without a span and gives the field no place", () => {
    const text = "formula.gone";
    const check = formulaCheck(text, {
      saved: text,
      message: "The formula gone has no definition.",
    });
    expect(check).toEqual({
      issue: "The formula gone has no definition.",
      syntax: "valid",
    });
  });
});
