// The typed tree consumers validate a vocabulary over.
import { describe, expect, it } from "vitest";

import { parseExpressionAst } from "./index";
import type { ExpressionNode } from "./index";

/** The tree without source ranges, so a case reads as the structure alone. */
function strip(node: ExpressionNode): unknown {
  const { from: _from, to: _to, ...rest } = node;
  return Object.fromEntries(
    Object.entries(rest).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? value.map((entry) => strip(entry as ExpressionNode))
        : typeof value === "object" && value !== null && "type" in value
          ? strip(value as ExpressionNode)
          : value,
    ]),
  );
}

function ast(input: string): unknown {
  const result = parseExpressionAst(input);
  if (result.error) throw new Error(`syntax error in ${input}`);
  return strip(result.ast);
}

describe("parseExpressionAst", () => {
  it("reads literals", () => {
    expect(ast("null")).toEqual({ type: "null" });
    expect(ast("true")).toEqual({ type: "boolean", value: true });
    expect(ast("false")).toEqual({ type: "boolean", value: false });
    expect(ast("12.5")).toEqual({ type: "number", value: 12.5 });
    expect(ast('"book"')).toEqual({ type: "string", value: "book" });
    expect(ast("'a\\'b\\n'")).toEqual({ type: "string", value: "a'b\n" });
    expect(ast("/re.ad/gi")).toEqual({
      type: "regexp",
      source: "re.ad",
      flags: "gi",
    });
    expect(ast("[1, 'two']")).toEqual({
      type: "array",
      elements: [
        { type: "number", value: 1 },
        { type: "string", value: "two" },
      ],
    });
  });

  it("reads binary, unary, and grouped operators with their precedence", () => {
    expect(ast('itemType == "book" && !(a || b)')).toEqual({
      type: "binary",
      operator: "&&",
      left: {
        type: "binary",
        operator: "==",
        left: { type: "identifier", name: "itemType" },
        right: { type: "string", value: "book" },
      },
      right: {
        type: "unary",
        operator: "!",
        operand: {
          type: "group",
          expression: {
            type: "binary",
            operator: "||",
            left: { type: "identifier", name: "a" },
            right: { type: "identifier", name: "b" },
          },
        },
      },
    });
    expect(ast("1 + 2 * 3 >= -4")).toEqual({
      type: "binary",
      operator: ">=",
      left: {
        type: "binary",
        operator: "+",
        left: { type: "number", value: 1 },
        right: {
          type: "binary",
          operator: "*",
          left: { type: "number", value: 2 },
          right: { type: "number", value: 3 },
        },
      },
      right: {
        type: "unary",
        operator: "-",
        operand: { type: "number", value: 4 },
      },
    });
  });

  it("reads calls and member access", () => {
    expect(ast('inCollection("ABCD1234", true)')).toEqual({
      type: "call",
      callee: { type: "identifier", name: "inCollection" },
      args: [
        { type: "string", value: "ABCD1234" },
        { type: "boolean", value: true },
      ],
    });
    expect(ast("tags[0].name")).toEqual({
      type: "object-access",
      object: {
        type: "array-access",
        object: { type: "identifier", name: "tags" },
        index: { type: "number", value: 0 },
      },
      property: "name",
    });
    expect(ast("f()")).toEqual({
      type: "call",
      callee: { type: "identifier", name: "f" },
      args: [],
    });
  });

  it("keeps source ranges", () => {
    const result = parseExpressionAst(' itemType == "book"');
    expect(result.ast).toMatchObject({
      from: 1,
      to: 19,
      left: { from: 1, to: 9 },
      right: { from: 13, to: 19 },
    });
  });

  it("reports a syntax error instead of a tree", () => {
    expect(parseExpressionAst("itemType ==")).toEqual({
      ast: null,
      error: { from: 11, to: 11 },
    });
  });
});
