import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noLiteralMenuSection } from "../../scripts/oxlint-plugin-menu-sections";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

tester.run("no-literal-section", noLiteralMenuSection, {
  valid: [
    "item.setSection(MENU_SECTION.action)",
    "item.setSection(SECTION['ink-width'])",
    "item.setSection(options.section)",
    "item.setTitle('zotlit')",
  ],
  invalid: [
    {
      code: "item.setSection('zotlit')",
      errors: [{ messageId: "literal" }],
    },
    {
      code: "item.setTitle('Copy').setSection(`action`)",
      errors: [{ messageId: "literal" }],
    },
  ],
});
