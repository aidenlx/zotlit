// zotlit-obsidian: UI code works in the window it stands in, a pop-out
// included (policies/popout-windows.md). Rejects global DOM instanceof checks
// and global timers in UI code. Rule tests: src/lint/popout-windows.test.ts.
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

/**
 * Each pop-out window has its own DOM constructors, so `x instanceof
 * HTMLElement` is false for an element from a pop-out. Obsidian's
 * `instanceOf` checks against the element's own window; the message names the
 * replacement for each constructor.
 */
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

/**
 * A `ResizeObserver` reports only elements in the window whose constructor
 * made it: the main window's never reports an element in a pop-out. Verified
 * against Obsidian 1.14.5.
 */
export const noGlobalResizeObserver: Rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a ResizeObserver from the window of the element it observes.",
    },
    messages: {
      globalResizeObserver:
        "Use observeResize from @/lib/observe-resize, or the ResizeObserver of the element's own window (el.win); the main window's ResizeObserver never reports an element in a pop-out (see policies/popout-windows.md).",
    },
    schema: [],
  },
  create(context) {
    /** Whether code around `node` declares its name, as `win`'s `ResizeObserver` taken apart. */
    const declared = (
      node: Parameters<typeof context.sourceCode.getScope>[0],
      name: string,
    ) => {
      for (
        let scope = context.sourceCode.getScope(node);
        scope;
        scope = scope.upper!
      )
        if (scope.set.get(name)?.defs.length) return true;
      return false;
    };
    return {
      NewExpression(node) {
        const { callee } = node;
        const global =
          callee.type === "Identifier"
            ? callee.name === "ResizeObserver" && !declared(callee, callee.name)
            : callee.type === "MemberExpression" &&
              callee.object.type === "Identifier" &&
              (callee.object.name === "window" ||
                callee.object.name === "globalThis") &&
              callee.property.type === "Identifier" &&
              callee.property.name === "ResizeObserver";
        if (global) context.report({ node, messageId: "globalResizeObserver" });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-obsidian" },
  rules: {
    "no-cross-window-instanceof": noCrossWindowInstanceof,
    "no-global-resize-observer": noGlobalResizeObserver,
    "no-global-timer": noGlobalTimer,
  },
};
