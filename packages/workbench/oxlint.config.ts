import { defineConfig } from "oxlint";

import baseConfig from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: ["./src/lint/oxlint-plugin.ts"],
  rules: {
    "zotlit-workbench/no-controller-source-slice": "error",
  },
  overrides: [
    {
      // Tests read their own LF fixtures and set up state they then check.
      files: ["**/*.test.{ts,tsx}"],
      rules: {
        "zotlit-workbench/no-controller-source-slice": "off",
      },
    },
  ],
});
