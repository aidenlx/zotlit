import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noControllerSourceSlice } from "./oxlint-plugin";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

tester.run("no-controller-source-slice", noControllerSourceSlice, {
  valid: [
    "controller.sliceText(entrySlice(entry.position))",
    "controller.state.doc.sliceString(range.from, range.to)",
    "caller.source.slice(site.from, site.to)",
    "controller.source",
  ],
  invalid: [
    {
      code: "controller.source.slice(entry.expression.from, entry.expression.to)",
      errors: [{ messageId: "sourceSlice" }],
    },
    {
      code: "editor.controller.source.slice(from, to)",
      errors: [{ messageId: "sourceSlice" }],
    },
  ],
});
