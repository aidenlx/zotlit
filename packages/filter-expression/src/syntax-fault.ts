import type { PartialParse, Tree } from "@lezer/common";
import type { Stack } from "@lezer/lr";

import { parser } from "./generated/parser.js";
import type { ExpressionSyntaxError } from "./index.js";

// Lezer's public partial parse omits its live stacks and term count. Keep that
// version-specific surface here; no grammar terms leave the package.
type LiveParse = PartialParse & { stacks: Stack[] };
const strict = parser.configure({ strict: true });
const terms = parser as typeof parser & { maxTerm: number };
const DISPLAY: Record<string, readonly string[]> = {
  Equality: ["==", "!="],
  Relation: ["<", "<=", ">", ">="],
  identifier: ["a name"],
  RealNumber: ["a number"],
  RegExp: ["a regular expression"],
};

export function syntaxFault(input: string, tree: Tree): ExpressionSyntaxError {
  const parse = strict.startParse(input) as LiveParse;
  let stacks = parse.stacks;
  try {
    while (true) {
      // advance replaces the array before processing it, and may append splits.
      stacks = parse.stacks;
      if (parse.advance()) throw new Error("Expected a syntax fault");
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const from = parse.parsedPos;
  const opened = findOpened(input, tree, from);
  const expected = new Set<string>();
  for (let term = 1; term <= terms.maxTerm; term++) {
    if (!stacks.some((stack) => stack.canShift(term))) continue;
    const name = parser.getName(term);
    const mapped = DISPLAY[name];
    if (mapped) for (const value of mapped) expected.add(value);
    else if (name.startsWith('"') || name.startsWith('identifier/"')) {
      const literal: string = JSON.parse(name.slice(name.indexOf('"')));
      expected.add(
        (literal === '"' || literal === "'") && opened?.closer !== literal
          ? "a string"
          : literal,
      );
    }
  }
  // EOF accepts through reductions and an accepting-state flag, not a shift.
  try {
    strict.parse(input.slice(0, from));
    expected.add("end of filter");
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const to = tokenEnd(input, from);
  return {
    from,
    to,
    found: from === input.length ? null : input.slice(from, to),
    expected: [...expected].sort((a, b) => {
      const word = (value: string) =>
        value.charCodeAt(0) >= 97 && value.charCodeAt(0) <= 122;
      return Number(word(a)) - Number(word(b)) || (a < b ? -1 : a > b ? 1 : 0);
    }),
    opened,
  };
}

function tokenEnd(input: string, from: number): number {
  if (from === input.length) return from;
  const suffix = parser.parse(input.slice(from));
  let end = 0;
  suffix.iterate({
    enter(node) {
      if (
        node.from === 0 &&
        !node.type.isError &&
        (!node.node.firstChild || node.name === "String") &&
        node.to > 0
      )
        end = Math.max(end, node.to);
    },
  });
  return from + (end || (input.codePointAt(from)! > 0xffff ? 2 : 1));
}

function findOpened(
  input: string,
  tree: Tree,
  position: number,
): ExpressionSyntaxError["opened"] {
  let opened: ExpressionSyntaxError["opened"] = null;
  tree.iterate({
    enter(ref) {
      if (ref.from > position || ref.to < position) return false;
      const node = ref.node;
      if (node.name === "String") {
        const quote = input[node.from]!;
        const last = node.to - 1;
        let escaped = false;
        for (let child = node.firstChild; child; child = child.nextSibling)
          if (child.name === "Escape" && child.from <= last && child.to > last)
            escaped = true;
        if (last <= node.from || input[last] !== quote || escaped)
          opened = { from: node.from, to: node.from + 1, closer: quote };
        return;
      }
      const pair =
        node.name === "Call" || node.name === "GroupedExpression"
          ? ["(", ")"]
          : node.name === "Array" || node.name === "ArrayAccess"
            ? ["[", "]"]
            : null;
      if (!pair) return;
      let start = -1;
      let closed = false;
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === pair[0]) start = child.from;
        if (child.name === pair[1]) closed = true;
      }
      if (start >= 0 && start < position && !closed)
        opened = { from: start, to: start + 1, closer: pair[1]! };
    },
  });
  return opened;
}
