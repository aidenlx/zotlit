import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noCrossWindowInstanceof } from "../../scripts/oxlint-plugin-popout-windows";

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
      errors: [{ messageId: "crossWindow", data: { type: "HTMLElement" } }],
    },
    {
      code: "event instanceof MouseEvent",
      errors: [{ messageId: "crossWindow", data: { type: "MouseEvent" } }],
    },
    {
      code: "target instanceof Node",
      errors: [{ messageId: "crossWindow", data: { type: "Node" } }],
    },
    {
      code: "button instanceof HTMLButtonElement",
      errors: [
        { messageId: "crossWindow", data: { type: "HTMLButtonElement" } },
      ],
    },
    {
      code: "event instanceof CustomEvent",
      errors: [{ messageId: "crossWindow", data: { type: "CustomEvent" } }],
    },
  ],
});
