import { defineConfig } from "oxlint";

import { testBaselineOverrides } from "@zotlit/config/oxlint";
import baseConfig from "@zotlit/config/oxlint";

export default defineConfig({
  overrides: [...testBaselineOverrides("packages/obsidian-i18n")],
  extends: [baseConfig],
});
