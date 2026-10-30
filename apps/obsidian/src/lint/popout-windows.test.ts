import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import {
  noCrossWindowInstanceof,
  noGlobalTimer,
} from "../../scripts/oxlint-plugin-popout-windows";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

tester.run("no-cross-window-instanceof", noCrossWindowInstanceof, {
  valid: [
    "node.instanceOf(HTMLElement)",
    "event.instanceOf(MouseEvent)",
    "value instanceof DomainEvent",
    "node instanceof node.win.HTMLElement",
  ],
  invalid: [
    {
      code: "node instanceof HTMLElement",
      errors: [
        {
          messageId: "crossWindow",
          data: {
            type: "HTMLElement",
            replacement: "node.instanceOf(HTMLElement)",
          },
        },
      ],
    },
    {
      code: "event instanceof MouseEvent",
      errors: [
        {
          messageId: "crossWindow",
          data: {
            type: "MouseEvent",
            replacement: "event.instanceOf(MouseEvent)",
          },
        },
      ],
    },
    {
      code: "target instanceof Node",
      errors: [
        {
          messageId: "crossWindow",
          data: { type: "Node", replacement: "target.instanceOf(Node)" },
        },
      ],
    },
    {
      code: "button instanceof HTMLButtonElement",
      errors: [
        {
          messageId: "crossWindow",
          data: {
            type: "HTMLButtonElement",
            replacement: "button.instanceOf(HTMLButtonElement)",
          },
        },
      ],
    },
    {
      code: "(event.target ?? node) instanceof HTMLSelectElement",
      errors: [
        {
          messageId: "crossWindow",
          data: {
            type: "HTMLSelectElement",
            replacement: "(event.target ?? node).instanceOf(HTMLSelectElement)",
          },
        },
      ],
    },
    {
      code: "event instanceof CustomEvent",
      errors: [
        {
          messageId: "crossWindow",
          data: {
            type: "CustomEvent",
            replacement: "event.instanceOf(CustomEvent)",
          },
        },
      ],
    },
  ],
});

tester.run("no-global-timer", noGlobalTimer, {
  valid: [
    "node.win.setTimeout(save, 250)",
    "activeWindow.requestAnimationFrame(paint)",
    "pending.win.clearTimeout(pending.timer)",
    "timers.setTimeout(save, 250)",
  ],
  invalid: [
    {
      code: "window.setTimeout(save, 250)",
      errors: [{ messageId: "globalTimer", data: { name: "setTimeout" } }],
    },
    {
      code: "clearTimeout(timer)",
      errors: [{ messageId: "globalTimer", data: { name: "clearTimeout" } }],
    },
    {
      code: "requestAnimationFrame(paint)",
      errors: [
        { messageId: "globalTimer", data: { name: "requestAnimationFrame" } },
      ],
    },
    {
      code: "globalThis.setInterval(poll, 1000)",
      errors: [{ messageId: "globalTimer", data: { name: "setInterval" } }],
    },
  ],
});
