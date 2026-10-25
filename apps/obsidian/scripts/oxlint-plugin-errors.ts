// zotlit-errors: code decides a failure by its type, not its text
// (policies/events.md, Capability tags → Expected outcomes).
// Rule tests: src/lint/errors.test.ts.
import type { AstNode, Rule } from "./oxlint-ast.ts";

const COMPARISONS = new Set(["===", "!==", "==", "!="]);
const STRING_TESTS = new Set(["includes", "startsWith", "endsWith", "match"]);

/** `<anything>.message` or `<anything>?.message`, not computed. */
function isMessage(node: AstNode | null | undefined): boolean {
  return (
    node?.type === "MemberExpression" &&
    !node.computed &&
    node.property?.type === "Identifier" &&
    node.property.name === "message"
  );
}

/** The node itself, or the optional chain that wraps it. */
function outer(node: AstNode): AstNode {
  return node.parent?.type === "ChainExpression" ? node.parent : node;
}

/**
 * Rejects a match on an error's `.message`: a comparison (`===`, `!==`),
 * a string test (`.includes`, `.startsWith`, `.endsWith`, `.match`), or a
 * regex `.test` of it. A message is text for people: Obsidian's carries an
 * absolute path or changes between versions, and our own is localized. A
 * capability tag decides an expected outcome before it calls Obsidian and
 * fails with a tagged error, which a caller handles with `Effect.catchTag`;
 * our own errors carry a `_tag`, a class or a `code` to test instead.
 */
export const noMessageMatch: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Decide a failure by its tag or class, not its message.",
    },
    messages: {
      messageMatch:
        "Test the error's tag, class or `code`, not its `.message`; a capability tag decides an expected Obsidian outcome as a tagged error (policies/events.md, Expected outcomes).",
    },
    schema: [],
  },
  create(context) {
    const report = (node: AstNode) =>
      context.report({ node: node as never, messageId: "messageMatch" });
    return {
      MemberExpression(node) {
        const member = node as unknown as AstNode;
        if (!isMessage(member)) return;
        const self = outer(member);
        const parent = self.parent as
          | (AstNode & {
              operator?: string;
              left?: AstNode;
              right?: AstNode;
            })
          | null
          | undefined;
        if (!parent) return;
        // `error.message === "…"`
        if (
          parent.type === "BinaryExpression" &&
          COMPARISONS.has(parent.operator ?? "")
        )
          return report(parent);
        // `error.message.includes("…")`
        if (
          parent.type === "MemberExpression" &&
          parent.object === self &&
          parent.property?.type === "Identifier" &&
          STRING_TESTS.has(parent.property.name as string)
        ) {
          const call = outer(parent).parent;
          if (call?.type === "CallExpression") return report(call);
        }
        // `/…/.test(error.message)`
        if (
          parent.type === "CallExpression" &&
          parent.arguments?.[0] === self &&
          parent.callee?.type === "MemberExpression" &&
          parent.callee.property?.type === "Identifier" &&
          parent.callee.property.name === "test"
        )
          return report(parent);
      },
    };
  },
};

export default {
  meta: { name: "zotlit-errors" },
  rules: { "no-message-match": noMessageMatch },
};
