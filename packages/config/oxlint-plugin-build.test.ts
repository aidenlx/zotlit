import { join } from "node:path";
import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

import { undeclaredEnvRule } from "./oxlint-plugin-build.ts";

RuleTester.describe = describe;
RuleTester.it = it;
const filename = join(import.meta.dirname, "__fixtures__/build/config.ts");
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
// Failure modes: constant and quoted bracket reads, one missing task, quoted
// define keys, authentication tokens, writes, and modules outside the build.
tester.run(
  "no-undeclared-env",
  undeclaredEnvRule({
    files: new Set([filename]),
    tasks: { "build:dev": ["DECLARED", "DEV_*"], dev: ["DECLARED"] },
  }),
  {
    valid: [
      { filename, code: "process.env.DECLARED" },
      { filename, code: 'const NAME = "DECLARED"; process.env[NAME]' },
      { filename, code: 'const define = { "process.env.MISSING": "value" }' },
      { filename, code: "process.env.GITHUB_TOKEN; process.env.GH_TOKEN" },
      { filename, code: 'process.env.MISSING = "value"' },
      { filename: "/runtime/module.ts", code: "process.env.MISSING" },
    ],
    invalid: [
      {
        filename,
        code: 'import { ENV_KEY as KEY } from "./keys.ts"; process.env[KEY]',
        errors: [
          {
            messageId: "undeclared",
            data: { name: "IMPORTED", tasks: "build:dev and dev" },
          },
        ],
      },
      {
        filename,
        code: 'const KEY = "MISSING" as const; process.env[KEY]',
        errors: [{ messageId: "undeclared" }],
      },
      {
        filename,
        code: "process.env[`MISSING`]",
        errors: [{ messageId: "undeclared" }],
      },
      {
        filename,
        code: "process.env.MISSING",
        errors: [
          {
            messageId: "undeclared",
            data: { name: "MISSING", tasks: "build:dev and dev" },
          },
        ],
      },
      {
        filename,
        code: 'process.env["MISSING"]',
        errors: [{ messageId: "undeclared" }],
      },
      {
        filename,
        code: 'const NAME = "MISSING"; process.env[NAME]',
        errors: [{ messageId: "undeclared" }],
      },
      {
        filename,
        code: "process.env.DEV_PORT",
        errors: [
          { messageId: "undeclared", data: { name: "DEV_PORT", tasks: "dev" } },
        ],
      },
    ],
  },
);
