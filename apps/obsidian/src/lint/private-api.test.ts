import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noUnknownCast } from "../../scripts/oxlint-plugin-private-api";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

tester.run("no-unknown-cast", noUnknownCast, {
  valid: [
    "const field = el as HTMLInputElement",
    "const chooser = suggest.suggestions?.forceSetSelectedItem",
    "const raw = value as unknown",
  ],
  invalid: [
    {
      code: "const chooser = (suggest as unknown as { chooser: Chooser }).chooser",
      errors: [{ messageId: "unknownCast" }],
    },
  ],
});
