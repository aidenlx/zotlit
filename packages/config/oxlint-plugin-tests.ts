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

/** Static fragments of a path, including join/resolve and URL expressions. */
function pathFragments(
  node: NonNullable<CallNode["parent"]> | undefined,
): string[] {
  if (!node) return [];
  switch (node.type) {
    case "Literal":
      return typeof node.value === "string" ? [node.value] : [];
    case "TemplateLiteral":
      return [
        ...node.quasis.map((part) => part.value.cooked ?? part.value.raw),
        ...node.expressions.flatMap(pathFragments),
      ];
    case "CallExpression":
    case "NewExpression":
      return node.arguments.flatMap(pathFragments);
    case "BinaryExpression":
      return [...pathFragments(node.left), ...pathFragments(node.right)];
    case "ConditionalExpression":
      return [
        ...pathFragments(node.consequent),
        ...pathFragments(node.alternate),
      ];
    case "ArrayExpression":
      return node.elements.flatMap((element) =>
        pathFragments(element ?? undefined),
      );
    default:
      return [];
  }
}

const sourceExtensions = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "mjs",
  "cjs",
  "yml",
  "yaml",
  "md",
  "mdx",
  "css",
]);
const fixtureDirectories = new Set([
  "fixtures",
  "__fixtures__",
  "test-fixtures",
  "__snapshots__",
]);

function isSourceFile(path: string): boolean {
  const name = path.split("/").at(-1) ?? "";
  return (
    [...sourceExtensions].some((extension) => name.endsWith(`.${extension}`)) ||
    name === "package.json" ||
    name === "turbo.json" ||
    (name.startsWith("tsconfig") && name.endsWith(".json"))
  );
}

export const noSourceText: Rule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      sourceText:
        "Test the behavior a file produces, or enforce its static rules with lint or types; use fixtures for test data (policies/testing-strategy.md).",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        const name =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression"
              ? staticName(callee)
              : undefined;
        if (name !== "readFile" && name !== "readFileSync") return;
        const fragments = pathFragments(node.arguments[0]).map((part) =>
          part.replaceAll("\\", "/"),
        );
        if (
          fragments.some((part) =>
            part
              .split("/")
              .some((directory) => fixtureDirectories.has(directory)),
          )
        )
          return;
        if (fragments.some((part) => isSourceFile(part)))
          context.report({ node, messageId: "sourceText" });
      },
      ImportDeclaration(node) {
        if (node.source.value.endsWith("?raw"))
          context.report({ node, messageId: "sourceText" });
      },
    };
  },
};

/** The static property name, including a quoted bracket key. */
function staticName(
  node: Extract<CallNode["callee"], { type: "MemberExpression" }>,
): string | undefined {
  if (!node.computed && node.property.type === "Identifier")
    return node.property.name;
  if (
    node.computed &&
    node.property.type === "Literal" &&
    typeof node.property.value === "string"
  )
    return node.property.value;
  return undefined;
}

export const noInternalMock: Rule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      internalMock:
        "Run repository modules for real; mock process, network and OS boundaries and assert outputs and effects (policies/testing-strategy.md).",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== "MemberExpression" ||
          callee.object.type !== "Identifier" ||
          callee.object.name !== "vi"
        )
          return;
        const name = staticName(callee);
        if (name !== "mock" && name !== "doMock") return;
        const argument = node.arguments[0];
        const specifier =
          argument?.type === "ImportExpression" ? argument.source : argument;
        const parts =
          specifier?.type === "Literal" && typeof specifier.value === "string"
            ? [specifier.value]
            : specifier?.type === "TemplateLiteral" &&
                specifier.expressions.length === 0
              ? pathFragments(specifier)
              : [];
        if (
          parts.some(
            (part) =>
              part.startsWith(".") ||
              part.startsWith("#") ||
              part.startsWith("@/") ||
              part.startsWith("@zotlit/"),
          )
        )
          context.report({ node, messageId: "internalMock" });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-tests" },
  rules: {
    "no-class-assertion": noClassAssertion,
    "no-source-text": noSourceText,
    "no-internal-mock": noInternalMock,
  },
};
