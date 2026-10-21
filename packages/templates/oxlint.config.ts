import { defineConfig } from "oxlint";

import { testBaselineOverrides } from "@zotlit/config/oxlint";
import baseConfig from "@zotlit/config/oxlint";

export default defineConfig({
  overrides: [...testBaselineOverrides("packages/templates")],
  extends: [baseConfig],
});
