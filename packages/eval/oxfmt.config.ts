import { defineConfig } from "oxfmt";

import baseConfig from "@zotlit/config/oxfmt";

export default defineConfig({
  ...baseConfig,
  // Retain the exact bytes of captured trial inputs, outputs, and reports.
  ignorePatterns: [...baseConfig.ignorePatterns, "cases/**"],
});
