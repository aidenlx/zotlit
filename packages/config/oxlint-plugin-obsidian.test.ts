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

tester.run("no-restricted-globals", rule("no-restricted-globals"), {
  valid: [
    "window.fetch(url);",
    "const o = { fetch: 1 }; o.fetch;",
    "function f(fetch) { return fetch(1); }",
    "const app = plugin.app; app.vault;",
    "type F = typeof fetch;",
  ],
  invalid: [
    { code: "fetch(url);", errors: [{ messageId: "restricted" }] },
    { code: "localStorage.getItem(k);", errors: [{ messageId: "restricted" }] },
    { code: "app.vault.read(f);", errors: [{ messageId: "restricted" }] },
  ],
});

tester.run("no-restricted-imports", rule("no-restricted-imports"), {
  valid: [
    "import { requestUrl } from 'obsidian';",
    "import type { Moment } from 'moment';",
  ],
  invalid: [
    {
      code: "import axios from 'axios';",
      errors: [{ messageId: "restricted" }],
    },
    {
      code: "import moment from 'moment';",
      errors: [{ messageId: "restricted" }],
    },
  ],
});

describe("oxlint-plugin-obsidian", () => {
  it("leaves the type-aware rules to ESLint", () => {
    assert.equal(plugin.rules["prefer-create-el"], undefined);
    assert.equal(plugin.rules["no-unsupported-api"], undefined);
  });
});
