import { defineConfig } from "oxlint";

import { testBaselineOverrides } from "@zotlit/config/oxlint";
import baseConfig from "@zotlit/config/oxlint";

export default defineConfig({
  overrides: [
    ...testBaselineOverrides("packages/templates"),
    {
      // Date adapters: LiquidJS's builtin `date` filter takes a Date
      // (liquid-date.ts), and a template's output can be a JS Date from its
      // own code or its data (coerce.ts and its test).
      files: ["src/liquid-date.ts", "src/coerce.ts", "src/coerce.test.ts"],
      rules: {
        "effecttsgo/global-date": "off",
        "no-restricted-globals": "off",
        "typescript/no-restricted-types": "off",
      },
    },
  ],
  extends: [baseConfig],
});
