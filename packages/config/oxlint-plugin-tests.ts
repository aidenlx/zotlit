// zotlit-tests: tests that assert behavior, not implementation
// (policies/testing-strategy.md, policies/tautological-tests.md). Rejects
// class and markup assertions, reading source as text, and mocking repository
// modules. Rule tests: oxlint-plugin-tests.test.ts.
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

type AnyNode = NonNullable<CallNode["parent"]>;

/** Whether the callee is `Array.from`, which keeps the elements it copies. */
function isArrayFrom(callee: CallNode["callee"]): boolean {
  return (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Array" &&
    staticName(callee) === "from"
  );
}

/** Whether the call is `….getAttribute("class")`. */
function isClassAttribute(node: CallNode): boolean {
  const [name] = node.arguments;
  return (
    node.callee.type === "MemberExpression" &&
    staticName(node.callee) === "getAttribute" &&
    name?.type === "Literal" &&
    name.value === "class"
  );
}

const selectorMethods = new Set([
  "querySelector",
  "querySelectorAll",
  "closest",
  "matches",
]);

/** A selector's static text, with `x` standing in for each expression. */
function selectorText(node: AnyNode | undefined): string {
  if (node?.type === "Literal")
    return typeof node.value === "string" ? node.value : "x";
  if (node?.type === "TemplateLiteral")
    return node.quasis
      .map((part) => part.value.cooked ?? part.value.raw)
      .join("x");
  if (node?.type === "BinaryExpression" && node.operator === "+")
    return selectorText(node.left) + selectorText(node.right);
  return "x";
}

/** Whether the selector matches on a class: `.name` or `[class…]`. */
function isClassSelector(text: string): boolean {
  if (/\[\s*class\s*[\]~*^$|=]/.test(text)) return true;
  // Quoted values and attribute selectors may hold dots of their own.
  const bare = text.replaceAll(/"[^"]*"|'[^']*'|\[[^\]]*\]/g, "");
  return /\.[\w\\-]/.test(bare);
}

/** Whether the call selects elements, or tests one, by class. */
function isClassQuery(node: CallNode): boolean {
  return (
    node.callee.type === "MemberExpression" &&
    selectorMethods.has(staticName(node.callee) ?? "") &&
    isClassSelector(selectorText(node.arguments[0]))
  );
}

/**
 * Markup is how the host draws an element, and a unit test runs in happy-dom,
 * not the host: assert it in the End-to-end Run (policies/testing-strategy.md).
 */
export const noMarkupAssertion: Rule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Assert behavior in unit tests, not classes or markup.",
    },
    messages: {
      markup:
        "Assert what the element does or says (text, role, state, data attribute), not its classes; markup belongs in an *.e2e.ts test (policies/testing-strategy.md).",
    },
    schema: [],
  },
  create(context) {
    /**
     * Whether the value reaches an assertion, directly or through the
     * variables it initializes. Acting on an element (`click`, `fireEvent`,
     * typing) leaves it outside `expect`, and handing it to a helper
     * (`EditorView.findFromDOM(el)`) turns it into something else: both stay
     * legal.
     */
    const asserted = (node: AnyNode, seen = new Set<AnyNode>()): boolean => {
      // Until the walk leaves a callback, the value itself is in hand.
      let direct = true;
      for (let from = node, at = node.parent; at; from = at, at = at.parent) {
        if (at.type === "CallExpression") {
          if (isExpectChain(at.callee)) return true;
          if (
            direct &&
            at.arguments.includes(from as never) &&
            !isArrayFrom(at.callee)
          )
            return false;
        } else if (at.type === "VariableDeclarator" && at.init === from) {
          if (seen.has(at)) return false;
          seen.add(at);
          return context.sourceCode
            .getDeclaredVariables(at)
            .some((variable) =>
              variable.references.some(
                (reference) =>
                  !reference.init &&
                  asserted(reference.identifier as AnyNode, seen),
              ),
            );
        } else if (
          at.type === "ArrowFunctionExpression" ||
          at.type === "FunctionExpression"
        )
          direct = false;
        else if (
          direct &&
          at.type.endsWith("Statement") &&
          at.type !== "ReturnStatement" &&
          at.type !== "BlockStatement"
        )
          return false;
      }
      return false;
    };
    return {
      CallExpression(node) {
        if ((isClassAttribute(node) || isClassQuery(node)) && asserted(node))
          context.report({ node, messageId: "markup" });
      },
      MemberExpression(node) {
        const name = staticName(node);
        if ((name === "className" || name === "classList") && asserted(node))
          context.report({ node, messageId: "markup" });
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

/**
 * A test that reads source text (`readFile` of a `.ts`, `.css`, config or doc
 * file, or a `?raw` import) asserts how code is written, not what it does: a
 * behavior-preserving edit breaks it (policies/testing-strategy.md). Static
 * rules belong in lint or types. Files under a fixtures directory are test
 * data and stay allowed.
 */
export const noSourceText: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Test behavior instead of reading source files as text.",
    },
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

/**
 * `vi.mock` of a repository module (relative, `#`, `@/` or `@zotlit/`) tests
 * the mock instead of the code, and passes while the real wiring breaks
 * (policies/testing-strategy.md). Mock only process, network and OS
 * boundaries; third-party specifiers stay allowed.
 */
export const noInternalMock: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Run repository modules for real; mock only outer boundaries.",
    },
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
    "no-markup-assertion": noMarkupAssertion,
    "no-source-text": noSourceText,
    "no-internal-mock": noInternalMock,
  },
};
