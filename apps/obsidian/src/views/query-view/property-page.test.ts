import { describe, expect, it } from "vitest";

import { formulaCheck } from "./property-page";

// Where the field underlines each Fault is the field's own behavior,
// proved through MatchExpressionInput in @zotlit/workbench.
describe("what the formula page reports", () => {
  it("reports the Syntax Fault of a formula as it is typed", () => {
    const check = formulaCheck("title == 'book", null);
    expect(check.issue).not.toBeNull();
    expect(check.syntax).toBe("invalid");
    expect(check.fault).toBeUndefined();
  });

  it("reports nothing in a formula that parses and has no engine Fault", () => {
    expect(formulaCheck("title.lower()", null)).toEqual({
      issue: null,
      syntax: "valid",
    });
  });

  it("reports an empty formula, which the status line explains", () => {
    const check = formulaCheck("", null);
    expect(check.issue).not.toBeNull();
    expect(check.fault).toBeUndefined();
  });

  it("gives the field an engine Fault's place while the text is the saved text", () => {
    const text = "title.nope()";
    const place = { text, span: { from: 6, to: 10 } };
    const fault = {
      saved: text,
      message: "nope is not a method of string.",
      place,
    };
    expect(formulaCheck(text, fault)).toEqual({
      issue: "nope is not a method of string.",
      syntax: "valid",
      fault: place,
    });
    expect(formulaCheck("title.nop()", fault)).toEqual({
      issue: null,
      syntax: "valid",
    });
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
