import { describe, expect, it } from "vitest";

import { formulaCheck } from "./property-page";

/** The text each Fault of a check underlines. */
const underlined = (
  text: string,
  { faults }: ReturnType<typeof formulaCheck>,
) => faults.map(({ from, to }) => text.slice(from, to));

describe("the faults the formula page underlines", () => {
  it("underlines an unclosed string from its quote, as the researcher types", () => {
    const text = "title == 'book";
    const check = formulaCheck(text, null);
    expect(check.issue).not.toBeNull();
    expect(check.syntax).toBe("invalid");
    expect(underlined(text, check)).toEqual(["'book"]);
  });

  it("underlines the operator a formula ends on", () => {
    const text = "title ==  ";
    expect(underlined(text, formulaCheck(text, null))).toEqual(["=="]);
  });

  it("underlines only the operator a formula ends on without spaces", () => {
    expect(underlined("title==", formulaCheck("title==", null))).toEqual([
      "==",
    ]);
    const call = "title.lower()+";
    expect(underlined(call, formulaCheck(call, null))).toEqual(["+"]);
  });

  it("underlines the token where parsing stopped", () => {
    const text = "title == )";
    expect(underlined(text, formulaCheck(text, null))).toEqual([")"]);
  });

  it("underlines nothing in a formula that parses and has no engine Fault", () => {
    expect(formulaCheck("title.lower()", null)).toEqual({
      issue: null,
      syntax: "valid",
      faults: [],
    });
  });

  it("underlines nothing in an empty formula, which the status line explains", () => {
    const check = formulaCheck("", null);
    expect(check.issue).not.toBeNull();
    expect(check.faults).toEqual([]);
  });

  it("underlines the span of an engine Fault while the text is the saved text", () => {
    const text = "title.nope()";
    const fault = {
      saved: text,
      message: "nope is not a method of string.",
      place: { text, span: { from: 6, to: 10 } },
    };
    const check = formulaCheck(text, fault);
    expect(check.issue).toBe("nope is not a method of string.");
    expect(check.syntax).toBe("valid");
    expect(underlined(text, check)).toEqual(["nope"]);
    expect(formulaCheck("title.nop()", fault)).toEqual({
      issue: null,
      syntax: "valid",
      faults: [],
    });
  });

  it("underlines nothing from a run of other text, while the next run is pending", () => {
    // The text was saved again, but the Fault is from the run of the text before.
    const text = "title.slice(0, 3)";
    const check = formulaCheck(text, {
      saved: text,
      message: "nope is not a method of string.",
      place: { text: "title.nope()", span: { from: 6, to: 10 } },
    });
    expect(check).toEqual({
      issue: "nope is not a method of string.",
      syntax: "valid",
      faults: [],
    });
  });

  it("reports an engine Fault without a span and underlines nothing", () => {
    const text = "formula.gone";
    const check = formulaCheck(text, {
      saved: text,
      message: "The formula gone has no definition.",
    });
    expect(check).toEqual({
      issue: "The formula gone has no definition.",
      syntax: "valid",
      faults: [],
    });
  });
});
