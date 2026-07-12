// Root config — governs everything not covered by a closer oxfmt.config.ts.
// App-level configs (apps/*, packages/*) shadow this file for their subtrees.
import { defineConfig } from "oxfmt";

import baseConfig from "@zotlit/config/oxfmt";

export default defineConfig({
  ...baseConfig,
  ignorePatterns: [
    ...baseConfig.ignorePatterns,
    ".scratch/**",
    "tests/zt-vault/**",
    "packages/obsidian-api/**",
    "packages/pdfjs-dist/**",
    "packages/zotero-types/zotero-schema/**",
  ],
});
