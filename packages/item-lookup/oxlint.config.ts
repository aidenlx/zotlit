import { defineConfig } from "oxlint";

import baseConfig, { testBaselineOverrides } from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  overrides: [...testBaselineOverrides("packages/item-lookup")],
});
