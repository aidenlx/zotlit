// Executable specification for the ZotLit Filter Expression language.
//
// The raw `parser` is the seam for accepted syntax, node structure, delimiter
// layout, and source ranges. `parseExpression()` is the seam for the consumer
// result contract: a tree plus the first syntax-error range.
import type { SyntaxNode, Tree } from "@lezer/common";
import { describe, expect, it } from "vitest";

import { parseExpression, parser } from "./index";

const ERROR = "⚠";

/** The first node under `program`. */
function expressionNode(input: string): SyntaxNode {
  const node = parser.parse(input).topNode.firstChild;
  if (!node) throw new Error(`no expression node in ${JSON.stringify(input)}`);
  return node;
}

/** Name of the parsed expression node. */
function topName(input: string): string {
  return expressionNode(input).name;
}

/** Source range of the parsed expression node, in UTF-16 offsets. */
function topRange(input: string): { from: number; to: number } {
  const { from, to } = expressionNode(input);
  return { from, to };
}

/** Symbolic operator and delimiter tokens, which `shape()` leaves out. */
const PUNCTUATION = new Set([
  "||",
  "&&",
  "+",
  "-",
  "*",
  "/",
  "%",
  "!",
  "(",
  ")",
  "[",
  "]",
  ",",
  ".",
]);

/**
 * Nested structure of the parsed expression, written as `Name(child, child)`.
 * Symbolic operator and delimiter tokens are left out so that grouping stays
 * readable; the named `Equality` and `Relation` operator tokens stay in.
 */
function shape(input: string): string {
  return render(expressionNode(input));
}

function render(node: SyntaxNode): string {
  const parts = childNodes(node).filter(isStructural).map(render);
  return parts.length > 0 ? `${node.name}(${parts.join(", ")})` : node.name;
}

/** Direct child names of the parsed expression node, delimiters included. */
function layout(input: string): string[] {
  return childNodes(expressionNode(input)).map((node) => node.name);
}

function childNodes(node: SyntaxNode): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    nodes.push(child);
  }
  return nodes;
}

function isStructural(node: SyntaxNode): boolean {
  return !PUNCTUATION.has(node.name);
}

/** Every node name in a tree, in document order. */
function nodeNames(tree: Tree): string[] {
  const names: string[] = [];
  tree.iterate({
    enter(node) {
      names.push(node.name);
    },
  });
  return names;
}

/** First syntax-error range, or `null` for a clean parse. */
function errorOf(input: string) {
  return parseExpression(input).error;
}

describe("literals", () => {
  it.each([
    { input: "null", node: "NullLiteral" },
    { input: "true", node: "BooleanLiteral" },
    { input: "false", node: "BooleanLiteral" },
    { input: "1", node: "RealNumber" },
    { input: '"x"', node: "String" },
    { input: "'x'", node: "String" },
    { input: "/x/", node: "RegExp" },
    { input: "[]", node: "Array" },
    { input: "a", node: "Identifier" },
    { input: "(a)", node: "GroupedExpression" },
  ])("parses $input as $node", ({ input, node }) => {
    expect(topName(input)).toBe(node);
    expect(errorOf(input)).toBeNull();
  });

  it.each([
    { input: "NULL" },
    { input: "Null" },
    { input: "True" },
    { input: "FALSE" },
    { input: "nullish" },
    { input: "trueish" },
    { input: "falsey" },
  ])("treats $input as an identifier, not a reserved literal", ({ input }) => {
    expect(topName(input)).toBe("Identifier");
    expect(topRange(input)).toEqual({ from: 0, to: input.length });
    expect(errorOf(input)).toBeNull();
  });
});

describe("identifiers", () => {
  it.each([
    { input: "a", why: "ASCII letter" },
    { input: "A", why: "uppercase ASCII letter" },
    { input: "_", why: "underscore alone" },
    { input: "$", why: "dollar alone" },
    { input: "_a", why: "underscore start" },
    { input: "$a$", why: "dollar start and continuation" },
    { input: "a1", why: "ASCII digit continuation" },
    { input: "a_1", why: "underscore and digit continuation" },
    { input: "café", why: "Unicode letter continuation" },
    { input: "日本語", why: "non-Latin script" },
    { input: "¡", why: "U+00A1, the first accepted code point" },
    { input: "→", why: "Unicode symbol accepted by the current rule" },
    { input: "•", why: "Unicode punctuation accepted by the current rule" },
    { input: "a·b", why: "Unicode punctuation continuation" },
    { input: "😀", why: "astral code point start" },
    { input: "a😀", why: "astral code point continuation" },
    { input: "\u{10ffff}", why: "U+10FFFF, the last accepted code point" },
    { input: "a\u{10ffff}", why: "U+10FFFF as a continuation" },
  ])("accepts $input as one identifier ($why)", ({ input }) => {
    expect(topName(input)).toBe("Identifier");
    expect(topRange(input)).toEqual({ from: 0, to: input.length });
    expect(errorOf(input)).toBeNull();
  });

  it("rejects a digit as an identifier start", () => {
    expect(errorOf("1a")).toEqual({ from: 1, to: 2 });
  });

  it("rejects U+00A0, the code point below the accepted range", () => {
    expect(errorOf("\u{a0}")).toEqual({ from: 0, to: 1 });
  });
});

describe("whitespace", () => {
  it.each([
    { input: "a\u{20}+\u{20}b", why: "space" },
    { input: "a\t+\tb", why: "tab" },
    { input: "a\n+\nb", why: "line feed" },
    { input: "a\r+\rb", why: "carriage return" },
  ])("skips $why around operators", ({ input }) => {
    expect(shape(input)).toBe("AdditiveExpression(Identifier, Identifier)");
    expect(errorOf(input)).toBeNull();
  });

  it("skips leading and trailing whitespace", () => {
    expect(topRange("\t\n\r a \r\n\t")).toEqual({ from: 4, to: 5 });
    expect(errorOf("\t\n\r a \r\n\t")).toBeNull();
  });

  it.each([
    { input: "a\u{2003}b", why: "em space" },
    { input: "a\u{3000}b", why: "ideographic space" },
  ])("reads $why as identifier text, not a separator", ({ input }) => {
    expect(topName(input)).toBe("Identifier");
    expect(topRange(input)).toEqual({ from: 0, to: 3 });
    expect(errorOf(input)).toBeNull();
  });

  it.each([
    { input: "a\u{b}b", why: "vertical tab" },
    { input: "a\u{c}b", why: "form feed" },
    { input: "a\u{a0}b", why: "no-break space" },
  ])("rejects $why between expressions", ({ input }) => {
    expect(errorOf(input)).toEqual({ from: 1, to: 3 });
  });
});

describe("numbers", () => {
  it.each([
    { input: "0", why: "single digit" },
    { input: "42", why: "several digits" },
    { input: "007", why: "leading zeroes" },
    { input: "1.5", why: "decimal point with fraction" },
    { input: "1.", why: "trailing decimal point" },
    { input: "0.", why: "zero with trailing decimal point" },
    { input: ".5", why: "leading decimal point" },
  ])("accepts $input ($why)", ({ input }) => {
    expect(topName(input)).toBe("RealNumber");
    expect(topRange(input)).toEqual({ from: 0, to: input.length });
    expect(errorOf(input)).toBeNull();
  });

  it.each([
    { input: "1e5", error: { from: 1, to: 1 }, why: "exponent notation" },
    { input: "0x1f", error: { from: 1, to: 1 }, why: "hexadecimal notation" },
    { input: "1_000", error: { from: 1, to: 1 }, why: "numeric separators" },
    {
      input: "1.2.3",
      error: { from: 4, to: 5 },
      why: "a second decimal point",
    },
    { input: ".", error: { from: 0, to: 1 }, why: "a bare decimal point" },
  ])("rejects $why in $input", ({ input, error }) => {
    expect(errorOf(input)).toEqual(error);
  });
});

describe("strings", () => {
  it.each([
    { input: '"x"', why: "double quotes" },
    { input: "'x'", why: "single quotes" },
    { input: '""', why: "empty double-quoted" },
    { input: "''", why: "empty single-quoted" },
    { input: '"a\nb"', why: "an unescaped line feed" },
    { input: "'a\rb'", why: "an unescaped carriage return" },
  ])("accepts $input ($why)", ({ input }) => {
    expect(topName(input)).toBe("String");
    expect(errorOf(input)).toBeNull();
  });

  it.each([
    { input: '"a\\"b"', why: "escaped double quote" },
    { input: "'a\\'b'", why: "escaped single quote" },
    { input: '"a\\nb"', why: "escaped letter" },
    { input: '"a\\\\b"', why: "escaped backslash" },
    { input: '"a\\qb"', why: "escape with no standard meaning" },
  ])("marks an Escape node in $input ($why)", ({ input }) => {
    expect(shape(input)).toBe("String(Escape)");
    expect(errorOf(input)).toBeNull();
  });

  it("leaves escape meaning to the consumer", () => {
    // The grammar spans backslash plus one code point; it does not decode.
    expect(errorOf('"\\u00e9"')).toBeNull();
    expect(shape('"\\u00e9"')).toBe("String(Escape)");
    expect(expressionNode('"\\u00e9"').firstChild).toMatchObject({
      from: 1,
      to: 3,
    });
  });

  it("spans a whole astral code point in an escape", () => {
    // Two UTF-16 units for the emoji, one for the backslash.
    expect(errorOf('"\\😀"')).toBeNull();
    expect(expressionNode('"\\😀"').firstChild).toMatchObject({
      from: 1,
      to: 4,
    });
  });

  it.each([
    { input: '"unterminated', error: { from: 13, to: 13 } },
    { input: "'unterminated", error: { from: 13, to: 13 } },
    { input: '"\\"', error: { from: 3, to: 3 } },
  ])("reports $input as unterminated", ({ input, error }) => {
    expect(errorOf(input)).toEqual(error);
  });
});

describe("regular expressions", () => {
  it.each([
    { input: "/abc/", why: "plain body" },
    { input: "/ /", why: "space body" },
    { input: "/a\\/b/", why: "escaped delimiter" },
    { input: "/a\\nb/", why: "escaped letter" },
    { input: "/a\\\nb/", why: "escaped line feed" },
    { input: "/a\rb/", why: "unescaped carriage return" },
    { input: "/abc/gi", why: "flags" },
    { input: "/a/dgimsuvy", why: "every current flag" },
    { input: "/a/yd", why: "flags out of canonical order" },
    { input: "/a/gg", why: "a repeated flag" },
    { input: "/abc", why: "closing slash omitted at end of input" },
  ])("accepts $input ($why)", ({ input }) => {
    expect(topName(input)).toBe("RegExp");
    expect(topRange(input)).toEqual({ from: 0, to: input.length });
    expect(errorOf(input)).toBeNull();
  });

  it.each([
    { input: "//", error: { from: 0, to: 2 }, why: "an empty body" },
    { input: "/", error: { from: 0, to: 1 }, why: "a bare slash" },
    { input: "/\\", error: { from: 0, to: 2 }, why: "a dangling escape" },
    { input: "/a/q", error: { from: 3, to: 4 }, why: "an unknown flag" },
  ])("rejects $why in $input", ({ input, error }) => {
    expect(errorOf(input)).toEqual(error);
  });

  it("ends a regular expression at a line feed", () => {
    expect(errorOf("/a\nb/")).toEqual({ from: 3, to: 4 });
  });

  it.each([
    { input: "a / b", why: "identifier operands" },
    { input: "x/2/3", why: "a repeated divisor" },
    { input: "(1)/2", why: "a grouped dividend" },
  ])("reads / as division in $input ($why)", ({ input }) => {
    expect(topName(input)).toBe("MultiplicativeExpression");
    expect(errorOf(input)).toBeNull();
  });

  it("prefers a regular expression where an operand is expected", () => {
    expect(shape("a == /x/")).toBe(
      "EqualityExpression(Identifier, Equality, RegExp)",
    );
  });
});

describe("arrays", () => {
  it.each([
    { input: "[]", expected: "Array" },
    { input: "[1]", expected: "Array(RealNumber)" },
    { input: "[1, 2]", expected: "Array(RealNumber, RealNumber)" },
    {
      input: "[null, true, false]",
      expected: "Array(NullLiteral, BooleanLiteral, BooleanLiteral)",
    },
    {
      input: "[[1], [2]]",
      expected: "Array(Array(RealNumber), Array(RealNumber))",
    },
  ])("parses $input as an array", ({ input, expected }) => {
    expect(shape(input)).toBe(expected);
    expect(errorOf(input)).toBeNull();
  });

  it("keeps brackets and commas in the child layout", () => {
    expect(layout("[1, 2]")).toEqual([
      "[",
      "RealNumber",
      ",",
      "RealNumber",
      "]",
    ]);
  });

  it.each([
    { input: "[1,]", error: { from: 3, to: 3 }, why: "a trailing comma" },
    {
      input: "[1, 2,]",
      error: { from: 6, to: 6 },
      why: "a trailing comma after two entries",
    },
    { input: "[,]", error: { from: 1, to: 2 }, why: "a leading comma" },
    { input: "[1 2]", error: { from: 3, to: 4 }, why: "a missing comma" },
  ])("rejects $why in $input", ({ input, error }) => {
    expect(errorOf(input)).toEqual(error);
  });
});

describe("grouping", () => {
  it.each([
    { input: "(1)", expected: "GroupedExpression(RealNumber)" },
    {
      input: "((1))",
      expected: "GroupedExpression(GroupedExpression(RealNumber))",
    },
  ])("parses $input", ({ input, expected }) => {
    expect(shape(input)).toBe(expected);
    expect(errorOf(input)).toBeNull();
  });

  it("keeps parentheses in the child layout", () => {
    expect(layout("(a)")).toEqual(["(", "Identifier", ")"]);
  });

  it.each([
    { input: "()", error: { from: 1, to: 1 }, why: "an empty group" },
    {
      input: "(1, 2)",
      error: { from: 2, to: 3 },
      why: "a comma inside a group",
    },
  ])("rejects $why in $input", ({ input, error }) => {
    expect(errorOf(input)).toEqual(error);
  });
});

describe("calls", () => {
  it.each([
    { input: "f()", expected: "Call(Identifier)" },
    { input: "f(1)", expected: "Call(Identifier, RealNumber)" },
    { input: "f(1, 2)", expected: "Call(Identifier, RealNumber, RealNumber)" },
    {
      input: "f(g(1))",
      expected: "Call(Identifier, Call(Identifier, RealNumber))",
    },
    { input: "f()()", expected: "Call(Call(Identifier))" },
    { input: "a.b()", expected: "Call(ObjectAccess(Identifier, Identifier))" },
    { input: "(f)()", expected: "Call(GroupedExpression(Identifier))" },
  ])("parses $input", ({ input, expected }) => {
    expect(shape(input)).toBe(expected);
    expect(errorOf(input)).toBeNull();
  });

  it.each([
    { input: "1()", callee: "RealNumber" },
    { input: '"s"()', callee: "String" },
    { input: "[1]()", callee: "Array" },
    { input: "null()", callee: "NullLiteral" },
  ])("accepts $callee as a callee in $input", ({ input, callee }) => {
    // The grammar allows any expression callee; meaning is a consumer concern.
    expect(topName(input)).toBe("Call");
    expect(expressionNode(input).firstChild?.name).toBe(callee);
    expect(errorOf(input)).toBeNull();
  });

  it("keeps parentheses and commas in the child layout", () => {
    expect(layout("f(1, 2)")).toEqual([
      "Identifier",
      "(",
      "RealNumber",
      ",",
      "RealNumber",
      ")",
    ]);
  });

  it.each([
    { input: "f(1,)", error: { from: 4, to: 4 }, why: "a trailing comma" },
    {
      input: "f(a, b,)",
      error: { from: 7, to: 7 },
      why: "a trailing comma after two arguments",
    },
    { input: "f(,)", error: { from: 2, to: 3 }, why: "a leading comma" },
  ])("rejects $why in $input", ({ input, error }) => {
    expect(errorOf(input)).toEqual(error);
  });
});

describe("object and array access", () => {
  it.each([
    { input: "a.b", expected: "ObjectAccess(Identifier, Identifier)" },
    {
      input: "a.b.c",
      expected:
        "ObjectAccess(ObjectAccess(Identifier, Identifier), Identifier)",
    },
    { input: "a[0]", expected: "ArrayAccess(Identifier, RealNumber)" },
    {
      input: "a[0][1]",
      expected: "ArrayAccess(ArrayAccess(Identifier, RealNumber), RealNumber)",
    },
    {
      input: "a[b[c]]",
      expected: "ArrayAccess(Identifier, ArrayAccess(Identifier, Identifier))",
    },
    {
      input: "a.b[0].c",
      expected:
        "ObjectAccess(ArrayAccess(ObjectAccess(Identifier, Identifier), RealNumber), Identifier)",
    },
    {
      input: "a.b(c)[0]",
      expected:
        "ArrayAccess(Call(ObjectAccess(Identifier, Identifier), Identifier), RealNumber)",
    },
    { input: "true.x", expected: "ObjectAccess(BooleanLiteral, Identifier)" },
  ])("parses $input", ({ input, expected }) => {
    expect(shape(input)).toBe(expected);
    expect(errorOf(input)).toBeNull();
  });

  it("keeps the dot and the brackets in the child layout", () => {
    expect(layout("a.b")).toEqual(["Identifier", ".", "Identifier"]);
    expect(layout("a[0]")).toEqual(["Identifier", "[", "RealNumber", "]"]);
  });

  it("requires an identifier after a dot", () => {
    expect(errorOf("a.1")).toEqual({ from: 2, to: 3 });
    expect(errorOf("a.")).toEqual({ from: 2, to: 2 });
  });

  it("requires an index between the brackets", () => {
    // Empty brackets are a valid array literal, but never a valid access.
    expect(errorOf("a[]")).toEqual({ from: 2, to: 2 });
  });
});

describe("unary operators", () => {
  it.each([
    { input: "!a", expected: "UnaryExpression(Identifier)" },
    { input: "-a", expected: "UnaryExpression(Identifier)" },
    { input: "- 1", expected: "UnaryExpression(RealNumber)" },
    { input: "-.5", expected: "UnaryExpression(RealNumber)" },
    { input: "!true", expected: "UnaryExpression(BooleanLiteral)" },
    { input: "!!a", expected: "UnaryExpression(UnaryExpression(Identifier))" },
    { input: "--a", expected: "UnaryExpression(UnaryExpression(Identifier))" },
    { input: "-!a", expected: "UnaryExpression(UnaryExpression(Identifier))" },
    { input: "!-a", expected: "UnaryExpression(UnaryExpression(Identifier))" },
  ])("parses $input", ({ input, expected }) => {
    expect(shape(input)).toBe(expected);
    expect(errorOf(input)).toBeNull();
  });

  it("keeps the operator token in the child layout", () => {
    expect(layout("!a")).toEqual(["!", "Identifier"]);
    expect(layout("-a")).toEqual(["-", "Identifier"]);
  });
});

describe("binary operators", () => {
  it.each([
    { input: "a * b", node: "MultiplicativeExpression", token: "*" },
    { input: "a / b", node: "MultiplicativeExpression", token: "/" },
    { input: "a % b", node: "MultiplicativeExpression", token: "%" },
    { input: "a + b", node: "AdditiveExpression", token: "+" },
    { input: "a - b", node: "AdditiveExpression", token: "-" },
    { input: "a < b", node: "RelationalExpression", token: "Relation" },
    { input: "a > b", node: "RelationalExpression", token: "Relation" },
    { input: "a <= b", node: "RelationalExpression", token: "Relation" },
    { input: "a >= b", node: "RelationalExpression", token: "Relation" },
    { input: "a == b", node: "EqualityExpression", token: "Equality" },
    { input: "a != b", node: "EqualityExpression", token: "Equality" },
    { input: "a && b", node: "LogicalExpression", token: "&&" },
    { input: "a || b", node: "LogicalExpression", token: "||" },
  ])("parses $input as $node", ({ input, node, token }) => {
    expect(topName(input)).toBe(node);
    expect(layout(input)).toEqual(["Identifier", token, "Identifier"]);
    expect(errorOf(input)).toBeNull();
  });
});

describe("precedence", () => {
  it.each([
    {
      input: "-a.b",
      expected: "UnaryExpression(ObjectAccess(Identifier, Identifier))",
      why: "access binds tighter than unary",
    },
    {
      input: "-f()",
      expected: "UnaryExpression(Call(Identifier))",
      why: "a call binds tighter than unary",
    },
    {
      input: "!a * b",
      expected:
        "MultiplicativeExpression(UnaryExpression(Identifier), Identifier)",
      why: "unary binds tighter than multiplication",
    },
    {
      input: "a * b + c",
      expected:
        "AdditiveExpression(MultiplicativeExpression(Identifier, Identifier), Identifier)",
      why: "multiplication binds tighter than addition",
    },
    {
      input: "a + b < c",
      expected:
        "RelationalExpression(AdditiveExpression(Identifier, Identifier), Relation, Identifier)",
      why: "addition binds tighter than comparison",
    },
    {
      input: "a < b == c",
      expected:
        "EqualityExpression(RelationalExpression(Identifier, Relation, Identifier), Equality, Identifier)",
      why: "comparison binds tighter than equality",
    },
    {
      input: "a == b && c",
      expected:
        "LogicalExpression(EqualityExpression(Identifier, Equality, Identifier), Identifier)",
      why: "equality binds tighter than logical AND",
    },
    {
      input: "a * !b",
      expected:
        "MultiplicativeExpression(Identifier, UnaryExpression(Identifier))",
      why: "unary binds tighter than multiplication on the right",
    },
    {
      input: "a + b * c",
      expected:
        "AdditiveExpression(Identifier, MultiplicativeExpression(Identifier, Identifier))",
      why: "multiplication binds tighter than addition on the right",
    },
    {
      input: "a < b + c",
      expected:
        "RelationalExpression(Identifier, Relation, AdditiveExpression(Identifier, Identifier))",
      why: "addition binds tighter than comparison on the right",
    },
    {
      input: "a == b < c",
      expected:
        "EqualityExpression(Identifier, Equality, RelationalExpression(Identifier, Relation, Identifier))",
      why: "comparison binds tighter than equality on the right",
    },
    {
      input: "a && b == c",
      expected:
        "LogicalExpression(Identifier, EqualityExpression(Identifier, Equality, Identifier))",
      why: "equality binds tighter than logical AND on the right",
    },
    {
      input: "a && b || c",
      expected:
        "LogicalExpression(LogicalExpression(Identifier, Identifier), Identifier)",
      why: "logical AND binds tighter than logical OR",
    },
    {
      input: "a || b && c",
      expected:
        "LogicalExpression(Identifier, LogicalExpression(Identifier, Identifier))",
      why: "logical AND binds tighter than logical OR on the right",
    },
  ])("$why in $input", ({ input, expected }) => {
    expect(shape(input)).toBe(expected);
    expect(errorOf(input)).toBeNull();
  });

  it.each([
    {
      input: "(a + b) * c",
      expected:
        "MultiplicativeExpression(GroupedExpression(AdditiveExpression(Identifier, Identifier)), Identifier)",
    },
    {
      input: "!(a && b)",
      expected:
        "UnaryExpression(GroupedExpression(LogicalExpression(Identifier, Identifier)))",
    },
    {
      input: "(a || b) && c",
      expected:
        "LogicalExpression(GroupedExpression(LogicalExpression(Identifier, Identifier)), Identifier)",
    },
  ])("grouping overrides precedence in $input", ({ input, expected }) => {
    expect(shape(input)).toBe(expected);
    expect(errorOf(input)).toBeNull();
  });
});

describe("associativity", () => {
  it.each([
    {
      input: "1 - 2 - 3",
      expected:
        "AdditiveExpression(AdditiveExpression(RealNumber, RealNumber), RealNumber)",
    },
    {
      input: "1 / 2 / 3",
      expected:
        "MultiplicativeExpression(MultiplicativeExpression(RealNumber, RealNumber), RealNumber)",
    },
    {
      input: "a < b < c",
      expected:
        "RelationalExpression(RelationalExpression(Identifier, Relation, Identifier), Relation, Identifier)",
    },
    {
      input: "a == b == c",
      expected:
        "EqualityExpression(EqualityExpression(Identifier, Equality, Identifier), Equality, Identifier)",
    },
    {
      input: "a && b && c",
      expected:
        "LogicalExpression(LogicalExpression(Identifier, Identifier), Identifier)",
    },
    {
      input: "a || b || c",
      expected:
        "LogicalExpression(LogicalExpression(Identifier, Identifier), Identifier)",
    },
  ])("associates $input to the left", ({ input, expected }) => {
    expect(shape(input)).toBe(expected);
    expect(errorOf(input)).toBeNull();
  });
});

describe("source ranges", () => {
  it("reports UTF-16 offsets for a compound expression", () => {
    expect(errorOf('title.contains("x")')).toBeNull();
    const call = expressionNode('title.contains("x")');
    expect({ from: call.from, to: call.to }).toEqual({ from: 0, to: 19 });
    expect(layout('title.contains("x")')).toEqual([
      "ObjectAccess",
      "(",
      "String",
      ")",
    ]);
    const access = call.firstChild;
    expect({ from: access?.from, to: access?.to }).toEqual({ from: 0, to: 14 });
  });

  it("counts an astral code point as two UTF-16 units", () => {
    // "😀" occupies offsets 5..9 because the emoji is a surrogate pair.
    expect(errorOf('a == "😀"')).toBeNull();
    const equality = expressionNode('a == "😀"');
    expect({ from: equality.from, to: equality.to }).toEqual({
      from: 0,
      to: 9,
    });
    expect({
      from: equality.lastChild?.from,
      to: equality.lastChild?.to,
    }).toEqual({ from: 5, to: 9 });
  });

  it("counts an astral identifier as two UTF-16 units", () => {
    expect(errorOf("😀")).toBeNull();
    expect(topRange("😀")).toEqual({ from: 0, to: 2 });
  });
});

describe("highlighting vocabulary", () => {
  // Every name an editor can select on. Changing this list changes a public contract.
  const VOCABULARY = [
    ERROR,
    "program",
    "LogicalExpression",
    "||",
    "&&",
    "EqualityExpression",
    "Equality",
    "RelationalExpression",
    "Relation",
    "AdditiveExpression",
    "+",
    "-",
    "MultiplicativeExpression",
    "*",
    "/",
    "%",
    "UnaryExpression",
    "!",
    "Call",
    "(",
    ",",
    ")",
    "ArrayAccess",
    "[",
    "]",
    "ObjectAccess",
    ".",
    "Identifier",
    "NullLiteral",
    "BooleanLiteral",
    "RealNumber",
    "String",
    "Escape",
    "RegExp",
    "Array",
    "GroupedExpression",
  ];

  it("exposes exactly the named nodes and tokens above", () => {
    // Declaration order is a generator detail; the set of selectable names is not.
    const exposed = parser.nodeSet.types
      .map((type) => type.name)
      .filter((name) => name.length > 0);
    expect(exposed.toSorted()).toEqual(VOCABULARY.toSorted());
  });

  it.each([
    { name: ERROR, input: "a &&" },
    { name: "program", input: "a" },
    { name: "LogicalExpression", input: "a && b" },
    { name: "||", input: "a || b" },
    { name: "&&", input: "a && b" },
    { name: "EqualityExpression", input: "a == b" },
    { name: "Equality", input: "a != b" },
    { name: "RelationalExpression", input: "a < b" },
    { name: "Relation", input: "a >= b" },
    { name: "AdditiveExpression", input: "a + b" },
    { name: "+", input: "a + b" },
    { name: "-", input: "a - b" },
    { name: "MultiplicativeExpression", input: "a * b" },
    { name: "*", input: "a * b" },
    { name: "/", input: "a / b" },
    { name: "%", input: "a % b" },
    { name: "UnaryExpression", input: "!a" },
    { name: "!", input: "!a" },
    { name: "Call", input: "f()" },
    { name: "(", input: "f()" },
    { name: ",", input: "f(a, b)" },
    { name: ")", input: "f()" },
    { name: "ArrayAccess", input: "a[0]" },
    { name: "[", input: "a[0]" },
    { name: "]", input: "a[0]" },
    { name: "ObjectAccess", input: "a.b" },
    { name: ".", input: "a.b" },
    { name: "Identifier", input: "a" },
    { name: "NullLiteral", input: "null" },
    { name: "BooleanLiteral", input: "true" },
    { name: "RealNumber", input: "1" },
    { name: "String", input: "'x'" },
    { name: "Escape", input: "'\\n'" },
    { name: "RegExp", input: "/x/" },
    { name: "Array", input: "[]" },
    { name: "GroupedExpression", input: "(a)" },
  ])("produces $name from $input", ({ name, input }) => {
    expect(nodeNames(parser.parse(input))).toContain(name);
  });
});

describe("parseExpression", () => {
  it("returns the parse tree and no error for well-formed input", () => {
    const { tree, error } = parseExpression("x.y == 'z' || !w[0]");
    expect(error).toBeNull();
    expect(tree.topNode.firstChild?.name).toBe("LogicalExpression");
  });

  it("reports empty input as an error at the grammar boundary", () => {
    // Blank-input meaning is a consumer policy, not a grammar rule.
    expect(parseExpression("").error).toEqual({ from: 0, to: 0 });
  });

  it("reports whitespace-only input as an error", () => {
    expect(parseExpression(" ").error).toEqual({ from: 1, to: 1 });
  });

  it.each([
    {
      input: "a &&",
      error: { from: 4, to: 4 },
      why: "a missing right operand",
    },
    { input: "&& a", error: { from: 0, to: 0 }, why: "a missing left operand" },
    {
      input: "1 +",
      error: { from: 3, to: 3 },
      why: "a dangling additive operator",
    },
    {
      input: "a b",
      error: { from: 2, to: 3 },
      why: "two adjacent expressions",
    },
    { input: "@", error: { from: 0, to: 1 }, why: "an unknown character" },
    { input: "a[", error: { from: 2, to: 2 }, why: "an unclosed bracket" },
    {
      input: "f(",
      error: { from: 2, to: 2 },
      why: "an unclosed argument list",
    },
    { input: "(1", error: { from: 2, to: 2 }, why: "an unclosed group" },
    { input: "[1", error: { from: 2, to: 2 }, why: "an unclosed array" },
    {
      input: "a === b",
      error: { from: 4, to: 5 },
      why: "an unsupported operator",
    },
    {
      input: "title.contains(",
      error: { from: 15, to: 15 },
      why: "an unfinished call",
    },
    { input: "a & b", error: { from: 2, to: 3 }, why: "a single ampersand" },
    { input: "a | b", error: { from: 2, to: 3 }, why: "a single pipe" },
    { input: "a = b", error: { from: 2, to: 3 }, why: "a single equals sign" },
  ])("positions the first error on $why", ({ input, error }) => {
    expect(parseExpression(input).error).toEqual(error);
  });

  it("reports only the first error in document order", () => {
    expect(parseExpression("a b c").error).toEqual({ from: 2, to: 3 });
  });

  it("still returns a recovery tree for malformed input", () => {
    // Availability only: an editor gets a walkable tree with content in it. The
    // recovery shape stays an implementation detail and is left unasserted.
    const { tree, error } = parseExpression("title.contains(");
    expect(error).not.toBeNull();
    expect(nodeNames(tree).length).toBeGreaterThan(1);
  });
});
