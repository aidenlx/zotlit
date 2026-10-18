import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

/**
 * A private Obsidian API is declared in `src/typings/obsidian-ex.d.ts`, so a
 * guarded module reaches it through a typed optional member. A cast through
 * `unknown` gives the surface a shape no other module shares.
 */
export const noUnknownCast: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Declare a private Obsidian API in obsidian-ex.d.ts rather than cast to it.",
    },
    messages: {
      unknownCast:
        "Declare this surface as optional in src/typings/obsidian-ex.d.ts and keep the runtime guard, instead of casting through unknown.",
    },
    schema: [],
  },
  create(context) {
    return {
      TSAsExpression(node) {
        const inner = node.expression;
        if (
          inner.type === "TSAsExpression" &&
          inner.typeAnnotation.type === "TSUnknownKeyword"
        )
          context.report({ node, messageId: "unknownCast" });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-private" },
  rules: { "no-unknown-cast": noUnknownCast },
};
