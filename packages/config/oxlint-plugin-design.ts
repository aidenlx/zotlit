import { regex } from "arkregex";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { RuleTester } from "oxlint/plugins-dev";
import postcss from "postcss";

type Rule = Parameters<RuleTester["run"]>[1];
type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type Attribute = Parameters<NonNullable<Visitor["JSXAttribute"]>>[0];
type Node = NonNullable<Attribute["parent"]>;

/** Class fragments in JSX expressions: literals, templates, clsx and branches. */
function classFragments(node: Node | null | undefined): string[] {
  if (!node) return [];
  switch (node.type) {
    case "Literal":
      return typeof node.value === "string" ? [node.value] : [];
    case "JSXExpressionContainer":
      return classFragments(node.expression);
    case "TemplateLiteral":
      return [
        ...node.quasis.map((part) => part.value.cooked ?? part.value.raw),
        ...node.expressions.flatMap(classFragments),
      ];
    case "CallExpression":
      return node.arguments.flatMap(classFragments);
    case "ConditionalExpression":
      return [
        ...classFragments(node.consequent),
        ...classFragments(node.alternate),
      ];
    case "BinaryExpression":
    case "LogicalExpression":
      return [...classFragments(node.left), ...classFragments(node.right)];
    case "ArrayExpression":
      return node.elements.flatMap(classFragments);
    case "ObjectExpression":
      return node.properties.flatMap((property) =>
        property.type === "Property" ? classFragments(property.key) : [],
      );
    default:
      return [];
  }
}

const whitespace = regex("\\s+");
const physicalUtility = regex.as<string, { captures: [] }>(
  "^(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|scroll-ml|scroll-mr)-",
);
const buttonOverride = regex(
  "^(?:min-h-|h-(?:[0-9]|\\[)|size-(?:[0-9]|\\[)|px-|py-|p-(?:[0-9]|\\[)|gap-|text-(?:xs|sm|base|lg|\\[))",
);
const physicalProperty = regex(
  "^(?:margin|padding|border)-(?:left|right)(?:-|$)|^(?:left|right)$",
);
const pxSize = regex("^([0-9.]+)px$");

/** The last variant separator outside brackets, including zt: and hover:. */
function utility(token: string): string {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    if (token[i] === "[") depth++;
    else if (token[i] === "]") depth--;
    else if (token[i] === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start).replaceAll("!", "").replace(regex("^-"), "");
}

function classProblems(
  tokens: string[],
  typography: boolean,
  annotation: boolean,
): string[] {
  const utilities = tokens.map(utility);
  const problems = new Set<string>();
  for (const value of utilities) {
    if (
      physicalUtility.test(value) ||
      value === "text-left" ||
      value === "text-right"
    )
      problems.add("Use logical direction utilities.");
    if (typography && (value.startsWith("text-[") || value === "uppercase"))
      problems.add("Use the text scale and sentence case for chrome.");
    if (annotation && value.startsWith("columns-"))
      problems.add("Use grid for the Annotation list.");
    if (annotation && value === "transition-all")
      problems.add("Name the transitioned properties.");
  }
  if (
    annotation &&
    utilities.some((value) => value.startsWith("line-clamp-")) &&
    utilities.some(
      (value) => value === "leading-tight" || value === "leading-none",
    )
  )
    problems.add("Pair line clamps with normal leading.");
  return [...problems];
}

function literalAttribute(
  node: Parameters<NonNullable<Visitor["JSXOpeningElement"]>>[0],
  name: string,
): string | undefined {
  const attribute = node.attributes.find(
    (attribute) =>
      attribute.type === "JSXAttribute" &&
      attribute.name.type === "JSXIdentifier" &&
      attribute.name.name === name,
  );
  if (attribute?.type !== "JSXAttribute") return undefined;
  const value =
    attribute.value?.type === "JSXExpressionContainer"
      ? attribute.value.expression
      : attribute.value;
  return value?.type === "Literal" && typeof value.value === "string"
    ? value.value
    : undefined;
}

export const workbenchChrome: Rule = {
  meta: {
    type: "problem",
    schema: [],
    messages: { chrome: "{{reason}} (Workbench chrome design)." },
  },
  create(context) {
    const report = (node: Node, reason: string) =>
      context.report({ node, messageId: "chrome", data: { reason } });
    return {
      ImportDeclaration(node) {
        if (node.source.value === "@base-ui/react/popover")
          report(node, "Use the shared Popover kit");
      },
      JSXOpeningElement(node) {
        const name =
          node.name.type === "JSXIdentifier"
            ? node.name.name
            : node.name.type === "JSXMemberExpression" &&
                node.name.object.type === "JSXIdentifier"
              ? `${node.name.object.name}.${node.name.property.name}`
              : "";
        if (name === "Popover.Close" || name === "PopoverClose")
          report(node, "Keep the title row free of close controls");
        if (
          name === "Button" &&
          !["xs", "2xs", "icon-sm", "icon-xs", "icon-2xs"].includes(
            literalAttribute(node, "size") ?? "",
          )
        )
          report(node, "Choose a Workbench Button size from the shared kit");
        if (
          ["Input", "NativeSelect", "Textarea", "DropdownMenuContent"].includes(
            name,
          ) &&
          literalAttribute(node, "size") !== "xs"
        )
          report(node, 'Use size="xs" for text controls and action menus');
        for (const attribute of node.attributes) {
          if (
            attribute.type !== "JSXAttribute" ||
            attribute.name.type !== "JSXIdentifier" ||
            attribute.name.name !== "className"
          )
            continue;
          const tokens = classFragments(attribute.value).flatMap((part) =>
            part.split(whitespace),
          );
          for (const reason of classProblems(
            tokens,
            !context.filename.endsWith("/reading-view.tsx"),
            false,
          ))
            report(attribute, reason);
          if (
            name === "Button" &&
            tokens.some(
              (token) =>
                buttonOverride.test(utility(token)) ||
                (token.includes("&_svg") && utility(token).startsWith("size-")),
            )
          )
            report(attribute, "Size and space Buttons through kit variants");
        }
      },
    };
  },
};

/** Parse declarations so selectors, comments and strings cannot act as CSS rules. */
export function annotationCssProblems(
  source: string,
): { line: number; reason: string }[] {
  const problems: { line: number; reason: string }[] = [];
  postcss.parse(source).walkDecls((declaration) => {
    const property = declaration.prop.toLowerCase();
    const value = declaration.value.toLowerCase().trim();
    const add = (reason: string) =>
      problems.push({ line: declaration.source?.start?.line ?? 1, reason });
    if (
      physicalProperty.test(property) ||
      (property === "text-align" && (value === "left" || value === "right"))
    )
      add("Use logical CSS direction properties");
    const size = pxSize.exec(value);
    if (
      (property === "font-size" && size && Number(size[1]) < 11) ||
      (property === "text-transform" && value === "uppercase")
    )
      add("Use the text scale and sentence case for chrome");
    if (property === "columns" || property === "column-count")
      add("Use grid for the Annotation list");
    if (
      (property === "transition" || property === "transition-property") &&
      value
        .split(",")
        .some((part) => part.trim().split(whitespace).includes("all"))
    )
      add("Name the transitioned properties");
  });
  return problems;
}

export const annotationDesign: Rule = {
  meta: {
    type: "problem",
    schema: [],
    messages: { design: "{{reason}} (Annotation View design)." },
  },
  create(context) {
    const report = (node: Node, reason: string) =>
      context.report({ node, messageId: "design", data: { reason } });
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier") return;
        if (node.name.name === "title") report(node, "Use aria-label tooltips");
        if (node.name.name === "className") {
          const tokens = classFragments(node.value).flatMap((part) =>
            part.split(whitespace),
          );
          for (const reason of classProblems(tokens, true, true))
            report(node, reason);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "setAttribute" &&
          node.arguments[0]?.type === "Literal" &&
          node.arguments[0].value === "title"
        )
          report(node, "Use aria-label tooltips");
      },
      ImportDeclaration(node) {
        if (!node.source.value.endsWith(".css")) return;
        const file = resolve(dirname(context.filename), node.source.value);
        for (const problem of annotationCssProblems(readFileSync(file, "utf8")))
          report(
            node,
            `${node.source.value}:${problem.line}: ${problem.reason}`,
          );
      },
    };
  },
};

export default {
  meta: { name: "zotlit-design" },
  rules: {
    "workbench-chrome": workbenchChrome,
    "annotation-view": annotationDesign,
  },
};
