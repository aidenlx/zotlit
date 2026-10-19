import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];
type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type CallNode = Parameters<NonNullable<Visitor["CallExpression"]>>[0];
type Node =
  | Parameters<NonNullable<Visitor["Literal"]>>[0]
  | Parameters<NonNullable<Visitor["TemplateElement"]>>[0];

/** A `zt:` utility class, escaped (`zt\:`) as a CSS selector writes it. */
const ztClass = /(?<![\w-])zt\\*:(?=\S)/;

/**
 * Code held in a string, such as a script the End-to-end Run evaluates in
 * Obsidian, that reads a `zt:` class: `classList.contains('zt:…')`, a
 * `.zt\:` selector, or a `[class~="zt:…"]` selector.
 */
const classQuery =
  /classList\.contains\(\s*["'`]zt:|\.zt\\+:|\[class[~*^$|]?=\s*["'`]?zt\\*:/;

/** Whether a callee is `expect` or a matcher chained off `expect(…)`. */
function isExpectChain(callee: CallNode["callee"]): boolean {
  let at: CallNode["callee"] = callee;
  for (;;) {
    if (at.type === "Identifier") return at.name === "expect";
    if (at.type === "MemberExpression") at = at.object;
    else if (at.type === "CallExpression") at = at.callee;
    else return false;
  }
}

/** Whether the node stands in the subject or a matcher of an assertion. */
function inAssertion(node: Node): boolean {
  for (let at: Node["parent"] | null = node.parent; at; at = at.parent)
    if (at.type === "CallExpression" && isExpectChain(at.callee)) return true;
  return false;
}

/** Whether the node is the class a `classList.contains(…)` call reads. */
function inClassListContains(node: Node): boolean {
  const call = node.parent;
  if (call?.type !== "CallExpression" || call.arguments[0] !== node)
    return false;
  const { callee } = call;
  return (
    callee.type === "MemberExpression" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "contains" &&
    callee.object.type === "MemberExpression" &&
    callee.object.property.type === "Identifier" &&
    callee.object.property.name === "classList"
  );
}

/**
 * A `zt:` class is how a control is drawn, not what it does: a restyle that
 * keeps the behavior breaks a test that reads it (policies/ui-testing.md,
 * "Change detectors" in policies/tautological-tests.md).
 */
export const noClassAssertion: Rule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Assert behavior in tests, not zt: utility classes.",
    },
    messages: {
      ztClass:
        "Assert what the element does or says (text, role, state, data attribute), not its zt: classes; the running app proves the drawing (policies/ui-testing.md).",
    },
    schema: [],
  },
  create(context) {
    const check = (node: Node, text: string) => {
      if (
        classQuery.test(text) ||
        (ztClass.test(text) && (inClassListContains(node) || inAssertion(node)))
      )
        context.report({ node, messageId: "ztClass" });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
        else if ("regex" in node && node.regex) check(node, node.regex.pattern);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

export default {
  meta: { name: "zotlit-tests" },
  rules: { "no-class-assertion": noClassAssertion },
};
