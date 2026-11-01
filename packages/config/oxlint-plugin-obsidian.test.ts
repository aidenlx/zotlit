import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

import plugin from "./oxlint-plugin-obsidian.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const rule = (name: string) => plugin.rules[name] as never;

tester.run("no-global-this", rule("no-global-this"), {
  valid: ["const w = window;"],
  invalid: [
    {
      code: "const w = globalThis.window;",
      output: "const w = window.window;",
      errors: [{ messageId: "avoidGlobal" }],
    },
  ],
});

tester.run("no-static-styles-assignment", rule("no-static-styles-assignment"), {
  valid: ["el.style.setProperty('font-variant', value);"],
  invalid: [
    {
      code: "el.style.setProperty('font-variant', 'small-caps');",
      errors: [{ messageId: "avoidStyleAssignment" }],
    },
  ],
});

describe("oxlint-plugin-obsidian", () => {
  it("leaves the type-aware rules to ESLint", () => {
    assert.equal(plugin.rules["prefer-create-el"], undefined);
    assert.equal(plugin.rules["no-unsupported-api"], undefined);
  });
});
