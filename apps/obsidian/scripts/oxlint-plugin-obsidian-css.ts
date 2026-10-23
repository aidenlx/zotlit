// Rule tests: src/lint/obsidian-css.test.ts.
import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];
type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type Node =
  | Parameters<NonNullable<Visitor["Literal"]>>[0]
  | Parameters<NonNullable<Visitor["TemplateElement"]>>[0];

/**
 * Class names Obsidian draws a control with. A component reaches them through
 * a wrapper in `src/components/obsidian/`; a layout of its own is `zt:`
 * utilities over Obsidian's variables. These names mean a class wherever a
 * string holds them, a class list kept in a variable included.
 */
function isObsidianClass(name: string): boolean {
  return (
    name === "clickable-icon" ||
    name === "mod-cta" ||
    name === "mod-warning" ||
    name.startsWith("setting-item")
  );
}

/** Obsidian's control classes that are also plain words, such as a kind. */
const wordClasses = new Set(["dropdown", "slider"]);

/**
 * Prefixes of the classes Bases and the Properties widgets draw with. A cell
 * of our own is drawn in `zt:` utilities, not with theirs. The names also
 * read as plain strings, a logger category among them, so only a class list
 * counts.
 */
const widgetPrefixes = ["bases-", "metadata-", "multi-select-"];

/** Functions whose string arguments end up in a class list. */
const classListCalls = new Set(["cn", "tv", "clsx"]);

/** Whether the string stands in a `className` or a class-list call. */
function inClassList(node: Node): boolean {
  for (let at: Node["parent"] | null = node.parent; at; at = at.parent) {
    if (
      at.type === "JSXAttribute" &&
      at.name.type === "JSXIdentifier" &&
      at.name.name === "className"
    )
      return true;
    if (
      at.type === "CallExpression" &&
      at.callee.type === "Identifier" &&
      classListCalls.has(at.callee.name)
    )
      return true;
  }
  return false;
}

export const noObsidianClass: Rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Reach Obsidian's control classes through src/components/obsidian.",
    },
    messages: {
      obsidianClass:
        'Draw "{{name}}" with zt: utilities over Obsidian\'s variables, or use the wrapper in src/components/obsidian/ (see the obsidian-css skill).',
    },
    schema: [],
  },
  create(context) {
    const check = (node: Node, text: string) => {
      for (const name of text.split(/\s+/))
        if (
          isObsidianClass(name) ||
          ((wordClasses.has(name) ||
            widgetPrefixes.some((prefix) => name.startsWith(prefix))) &&
            inClassList(node))
        )
          context.report({ node, messageId: "obsidianClass", data: { name } });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? "");
      },
    };
  },
};

/**
 * `Setting` lays out a settings row and owns its DOM; a React tree builds
 * its form rows from JSX instead.
 */
export const noSettingInReact: Rule = {
  meta: {
    type: "suggestion",
    docs: { description: "Build form rows in React from JSX." },
    messages: {
      setting:
        "Build the row in JSX: a label, the control from src/components/obsidian/, and zt: utilities (see the obsidian-css skill).",
    },
    schema: [],
  },
  create(context) {
    return {
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "Setting")
          context.report({ node, messageId: "setting" });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-css" },
  rules: {
    "no-obsidian-class": noObsidianClass,
    "no-setting-in-react": noSettingInReact,
  },
};
