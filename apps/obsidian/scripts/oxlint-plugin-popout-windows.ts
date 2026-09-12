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
        "Use node.instanceOf({{type}}) or event.instanceOf({{type}}); global DOM constructors do not match pop-out window objects (see policies/popout-windows.md).",
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
        context.report({
          node,
          messageId: "crossWindow",
          data: { type: node.right.name },
        });
      },
    };
  },
};

export default {
  meta: { name: "zotlit-obsidian" },
  rules: { "no-cross-window-instanceof": noCrossWindowInstanceof },
};
