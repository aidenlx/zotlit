import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

/** The fields this rule reads; every ESTree node fits it. */
interface AstNode {
  readonly type: string;
  readonly parent?: AstNode | null;
  readonly name?: unknown;
  readonly value?: unknown;
  readonly computed?: boolean;
  readonly object?: AstNode;
  readonly property?: AstNode;
  readonly callee?: AstNode;
  readonly arguments?: readonly AstNode[];
  readonly expression?: AstNode;
  readonly expressions?: readonly AstNode[];
  readonly quasis?: readonly { readonly value: { readonly cooked: string } }[];
  readonly body?: readonly AstNode[];
  readonly kind?: string;
  readonly declarations?: readonly AstNode[];
  readonly declaration?: AstNode | null;
  readonly id?: AstNode;
  readonly init?: AstNode | null;
}

/** The name after the dot in `a.name`, or null for anything else. */
function memberName(node: AstNode | undefined): string | null {
  return node?.type === "MemberExpression" &&
    !node.computed &&
    node.property?.type === "Identifier"
    ? String(node.property.name)
    : null;
}

function calleeName(call: AstNode): string | null {
  return call.callee?.type === "Identifier"
    ? String(call.callee.name)
    : memberName(call.callee);
}

function isKeyEvent(node: AstNode | undefined): boolean {
  return (
    node?.type === "Literal" && /^key(?:down|up)$/.test(String(node.value))
  );
}

const jsxKeyProps = new Set([
  "onKeyDown",
  "onKeyUp",
  "onKeyDownCapture",
  "onKeyUpCapture",
]);

/**
 * Whether a function is a key handler by where it is passed: a JSX key prop,
 * a `keydown`/`keyup` listener, or a Scope's keymap callback.
 */
function isKeyHandler(fn: AstNode): boolean {
  const { parent } = fn;
  if (parent?.type === "JSXExpressionContainer") {
    const attr = parent.parent;
    const prop = attr?.type === "JSXAttribute" ? (attr.name as AstNode) : null;
    return prop?.type === "JSXIdentifier" && jsxKeyProps.has(String(prop.name));
  }
  if (parent?.type !== "CallExpression") return false;
  const args = parent.arguments ?? [];
  switch (calleeName(parent)) {
    case "addEventListener":
      return args[1] === fn && isKeyEvent(args[0]);
    case "registerDomEvent":
      return args[2] === fn && isKeyEvent(args[1]);
    // `scope.register(modifiers, key, fn)`; a Component's register takes one.
    case "register":
      return args.length === 3 && args[2] === fn;
    case "registerKeymap":
      return args.length === 4 && args[3] === fn;
    default:
      return false;
  }
}

function inKeyHandler(node: AstNode): boolean {
  for (let at = node.parent; at != null; at = at.parent)
    if (
      (at.type === "ArrowFunctionExpression" ||
        at.type === "FunctionExpression") &&
      isKeyHandler(at)
    )
      return true;
  return false;
}

/**
 * What another layer is drawn with: a popover, a menu, a dialog or modal, a
 * suggester, or the trigger that marks one open. A field, an editor or a
 * list box the key landed on is the target's own, and is not here.
 */
const layerSelector =
  /\[popover|:popover-open|\[role\s*=\s*["']?(?:menu|menuitem\w*|dialog|alertdialog)["']?\s*\]|\[aria-(?:haspopup|expanded)|has-active-menu|(?:^|[\s,>+~(])dialog(?![\w-])|\.(?:menu|menu-item|modal|modal-container|suggestion-container|suggestion-item|prompt|popover|hover-popover)(?![\w-])/;

/** A class that marks a layer, or its trigger, open. */
const layerClass = /^(?:has-active-menu|is-open|popover-open)$/;

/** An attribute that marks a layer, or its trigger, open. */
const layerAttribute = /^(?:popover|aria-haspopup|aria-expanded)$/;

const selectorMethods = new Set([
  "closest",
  "matches",
  "querySelector",
  "querySelectorAll",
]);

/**
 * A key the surface would give up while another layer is open belongs on a
 * Scope that layer pushes; the innermost Scope hears it first, and the
 * surface needs no knowledge of the layer.
 */
export const noLayerCheck: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow key handlers that inspect the DOM for another open layer.",
    },
    messages: {
      layerCheck:
        "A key handler that inspects the DOM to see whether another layer is open is a Scope missing in that layer (apps/obsidian/policies/keyboard-scope.md).",
    },
    schema: [],
  },
  create(context) {
    // Top-level string consts, so a selector list named once is read
    // where a handler passes it.
    const constants = new Map<string, string>();
    const text = (node: AstNode | undefined): string | null => {
      if (node?.type === "Literal" && typeof node.value === "string")
        return node.value;
      if (node?.type === "TemplateLiteral")
        return (node.quasis ?? [])
          .map(
            (quasi, i) =>
              quasi.value.cooked + (text(node.expressions?.[i]) ?? ""),
          )
          .join("");
      if (node?.type === "Identifier")
        return constants.get(String(node.name)) ?? null;
      return null;
    };
    return {
      Program(program) {
        for (let statement of (program as AstNode).body ?? []) {
          if (statement.type === "ExportNamedDeclaration")
            statement = statement.declaration ?? statement;
          if (
            statement.type !== "VariableDeclaration" ||
            statement.kind !== "const"
          )
            continue;
          for (const { id, init } of statement.declarations ?? []) {
            if (id?.type !== "Identifier" || init == null) continue;
            const value = text(init);
            if (value !== null) constants.set(String(id.name), value);
          }
        }
      },
      CallExpression(node) {
        const call = node as AstNode;
        const name = memberName(call.callee);
        if (name === null) return;
        const arg = text(call.arguments?.[0]);
        if (arg === null) return;
        const probes =
          (selectorMethods.has(name) && layerSelector.test(arg)) ||
          (name === "hasClass" && layerClass.test(arg)) ||
          (name === "contains" &&
            memberName(call.callee?.object) === "classList" &&
            layerClass.test(arg)) ||
          ((name === "hasAttribute" || name === "getAttribute") &&
            layerAttribute.test(arg));
        if (probes && inKeyHandler(call))
          context.report({ node, messageId: "layerCheck" });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-keyboard" },
  rules: { "no-layer-check": noLayerCheck },
};
