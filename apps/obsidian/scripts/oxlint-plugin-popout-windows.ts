// Rule tests: src/lint/popout-windows.test.ts.
import type { RuleTester } from "oxlint/plugins-dev";

type Rule = Parameters<RuleTester["run"]>[1];

const domConstructors = new Set([
  "Node",
  "Element",
  "HTMLElement",
  "HTMLAnchorElement",
  "SVGElement",
  "Event",
  "UIEvent",
  "MouseEvent",
  "KeyboardEvent",
  "ClipboardEvent",
  "AnimationEvent",
  "BeforeUnloadEvent",
  "CloseEvent",
  "CompositionEvent",
  "CustomEvent",
  "DragEvent",
  "ErrorEvent",
  "FocusEvent",
  "HashChangeEvent",
  "InputEvent",
  "MessageEvent",
  "PageTransitionEvent",
  "PointerEvent",
  "PopStateEvent",
  "ProgressEvent",
  "PromiseRejectionEvent",
  "SecurityPolicyViolationEvent",
  "StorageEvent",
  "SubmitEvent",
  "TouchEvent",
  "ToggleEvent",
  "TransitionEvent",
  "WheelEvent",
]);

function isWindowLocalConstructor(name: string): boolean {
  return (
    domConstructors.has(name) ||
    ((name.startsWith("HTML") || name.startsWith("SVG")) &&
      name.endsWith("Element"))
  );
}

export const noCrossWindowInstanceof: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require Obsidian's cross-window DOM type checks.",
    },
    messages: {
      crossWindow:
        "Use `{{replacement}}`; global DOM constructors do not match pop-out window objects (see policies/popout-windows.md).",
    },
    schema: [],
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (
          node.operator !== "instanceof" ||
          node.right.type !== "Identifier" ||
          !isWindowLocalConstructor(node.right.name)
        )
          return;
        // The replacement names the checked value itself, so the message
        // reads as the fix for this line rather than a pattern to adapt.
        const left = context.sourceCode.getText(node.left);
        const receiver =
          node.left.type === "Identifier" ||
          node.left.type === "MemberExpression" ||
          node.left.type === "CallExpression"
            ? left
            : `(${left})`;
        context.report({
          node,
          messageId: "crossWindow",
          data: {
            type: node.right.name,
            replacement: `${receiver}.instanceOf(${node.right.name})`,
          },
        });
      },
    };
  },
};

const timers = new Set([
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]);

/**
 * A timer belongs to a window: one set on the main window keeps running, or
 * stops, apart from the pop-out the UI stands in.
 */
export const noGlobalTimer: Rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require timers from the window the UI stands in.",
    },
    messages: {
      globalTimer:
        "Call {{name}} on node.win, or on activeWindow when focus owns the work; a global timer runs on the main window, not the pop-out (see policies/popout-windows.md).",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        const name =
          callee.type === "Identifier"
            ? callee.name
            : callee.type === "MemberExpression" &&
                callee.object.type === "Identifier" &&
                (callee.object.name === "window" ||
                  callee.object.name === "globalThis") &&
                callee.property.type === "Identifier"
              ? callee.property.name
              : null;
        if (name !== null && timers.has(name))
          context.report({ node, messageId: "globalTimer", data: { name } });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-obsidian" },
  rules: {
    "no-cross-window-instanceof": noCrossWindowInstanceof,
    "no-global-timer": noGlobalTimer,
  },
};
