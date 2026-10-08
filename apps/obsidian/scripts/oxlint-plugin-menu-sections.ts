import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

/**
 * A menu shows a section it never registered after every registered one —
 * below "Delete" — so a section name is read from the list its menu
 * registered: `MENU_SECTION` for Obsidian's menus, `menuSections(…)` for a
 * menu ZotLit raises.
 */
export const noLiteralMenuSection: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require menu section names from a registered list.",
    },
    messages: {
      literal:
        'Take the section from MENU_SECTION (@/lib/menu-section) or menuSections(…) (@/services/menu-events); a section the menu never registered sorts below "Delete".',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== "MemberExpression" ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "setSection"
        )
          return;
        const [section] = node.arguments;
        if (
          (section?.type === "Literal" && typeof section.value === "string") ||
          (section?.type === "TemplateLiteral" &&
            section.expressions.length === 0)
        )
          context.report({ node: section, messageId: "literal" });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-menu" },
  rules: { "no-literal-section": noLiteralMenuSection },
};
