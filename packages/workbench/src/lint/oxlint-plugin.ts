// Oxlint rules for the Workbench, loaded by this package's oxlint.config.ts.

import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

/** The fields these rules read; every ESTree node fits it. */
interface AstNode {
  readonly type: string;
  readonly name?: unknown;
  readonly computed?: boolean;
  readonly object?: AstNode;
  readonly property?: AstNode;
  readonly callee?: AstNode;
}

/** The name after the dot in `a.name`, or null for anything else. */
function memberName(node: AstNode | undefined): string | null {
  return node?.type === "MemberExpression" &&
    !node.computed &&
    node.property?.type === "Identifier"
    ? String(node.property.name)
    : null;
}

/** `controller` or `<anything>.controller`, the name every pane gives the document controller. */
function isController(node: AstNode | undefined): boolean {
  return node?.type === "Identifier"
    ? node.name === "controller"
    : memberName(node) === "controller";
}

export const noControllerSourceSlice: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Read a slice range from the document text it was measured in.",
    },
    messages: {
      sourceSlice:
        "Read a slice range with controller.sliceText(id) or controller.state.doc.sliceString(from, to). controller.source keeps the document's CRLF line breaks, which slice ranges count as one character.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee: AstNode = node.callee;
        if (
          memberName(callee) === "slice" &&
          memberName(callee.object) === "source" &&
          isController(callee.object?.object)
        )
          context.report({ node, messageId: "sourceSlice" });
      },
    };
  },
};

const plugin: { meta: { name: string }; rules: Record<string, Rule> } = {
  meta: { name: "zotlit-workbench" },
  rules: {
    "no-controller-source-slice": noControllerSourceSlice,
  },
};

export default plugin;
