import { describe, expect, it } from "vitest";

import {
  filterExpressionLanguage,
  highlightFilterExpression,
} from "./filter-expression";

/** Each highlighted token of `source` with the hooks it carries. */
function hooks(source: string): [string, string][] {
  const tokens: [string, string][] = [];
  highlightFilterExpression(
    filterExpressionLanguage.parser.parse(source),
    (from, to, classes) => tokens.push([source.slice(from, to), classes]),
  );
  return tokens;
}

describe("filter expression highlighting", () => {
  it("colors the callee of a function call as a function, and its arguments as properties", () => {
    expect(hooks("contains(title, x)")).toEqual([
      ["contains", "zt-template-filter"],
      ["(", "zt-template-punctuation"],
      ["title", "zt-template-property"],
      [",", "zt-template-punctuation"],
      ["x", "zt-template-property"],
      [")", "zt-template-punctuation"],
    ]);
  });

  it("colors a method after `.` as a function, and a property path as properties", () => {
    expect(hooks("title.lower()")).toEqual([
      ["title", "zt-template-property"],
      [".", "zt-template-punctuation"],
      ["lower", "zt-template-filter"],
      ["(", "zt-template-punctuation"],
      [")", "zt-template-punctuation"],
    ]);
    expect(hooks("f(a.b)[0]")).toEqual([
      ["f", "zt-template-filter"],
      ["(", "zt-template-punctuation"],
      ["a", "zt-template-property"],
      [".", "zt-template-punctuation"],
      ["b", "zt-template-property"],
      [")", "zt-template-punctuation"],
      ["[", "zt-template-punctuation"],
      ["0", "zt-template-value"],
      ["]", "zt-template-punctuation"],
    ]);
  });

  it("keeps `this` and `formula` plain names, colored as properties", () => {
    expect(hooks("this.file.name")).toEqual([
      ["this", "zt-template-property"],
      [".", "zt-template-punctuation"],
      ["file", "zt-template-property"],
      [".", "zt-template-punctuation"],
      ["name", "zt-template-property"],
    ]);
    expect(hooks("formula.x")[0]).toEqual(["formula", "zt-template-property"]);
  });

  it("colors true, false, null and numbers as values, and strings as strings", () => {
    expect(hooks(`[true, false, null, 1.5, "a", 'b']`)).toEqual([
      ["[", "zt-template-punctuation"],
      ["true", "zt-template-value"],
      [",", "zt-template-punctuation"],
      ["false", "zt-template-value"],
      [",", "zt-template-punctuation"],
      ["null", "zt-template-value"],
      [",", "zt-template-punctuation"],
      ["1.5", "zt-template-value"],
      [",", "zt-template-punctuation"],
      [`"a"`, "zt-template-string"],
      [",", "zt-template-punctuation"],
      ["'b'", "zt-template-string"],
      ["]", "zt-template-punctuation"],
    ]);
  });

  it("keeps an escape inside a string in the string color", () => {
    expect(hooks(String.raw`"a\nb"`)).toEqual([
      [String.raw`"a\nb"`, "zt-template-string"],
    ]);
  });

  it("colors operators", () => {
    expect(
      hooks("!a && b || c == 1 != 2 < 3 + 4 - 5 * 6 / 7 % 8 >= -9")
        .filter(([, hook]) => hook === "zt-template-operator")
        .map(([text]) => text),
    ).toEqual([
      "!",
      "&&",
      "||",
      "==",
      "!=",
      "<",
      "+",
      "-",
      "*",
      "/",
      "%",
      ">=",
      "-",
    ]);
  });

  it("colors a regular expression with the regexp hook", () => {
    expect(hooks("/ab+c/i.matches(title)")).toEqual([
      ["/ab+c/i", "zt-template-value zt-template-regexp"],
      [".", "zt-template-punctuation"],
      ["matches", "zt-template-filter"],
      ["(", "zt-template-punctuation"],
      ["title", "zt-template-property"],
      [")", "zt-template-punctuation"],
    ]);
  });
});
