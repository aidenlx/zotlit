import { defineConfig } from "oxlint";

import baseConfig, { testBaselineOverrides } from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  jsPlugins: [
    "./src/lint/oxlint-plugin.ts",
    // The Obsidian adapter pushes the Scope a layer drawn here needs, so the
    // Workbench's key handlers answer to the plugin's keyboard policy.
    new URL("../../packages/config/oxlint-plugin-keyboard.ts", import.meta.url)
      .pathname,
  ],
  rules: {
    "zotlit-workbench/no-controller-source-slice": "error",
    "zotlit-keyboard/no-layer-check": "error",
  },
  overrides: [
    {
      // Tests read their own LF fixtures and set up state they then check.
      files: ["**/*.test.{ts,tsx}"],
      rules: {
        "zotlit-workbench/no-controller-source-slice": "off",
      },
    },
    ...testBaselineOverrides("packages/workbench"),
  ],
});
