import { defineConfig } from "oxlint";

import baseConfig from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  overrides: [
    {
      // Prototype scripts read sibling packages' `src/` directly; the `@/`
      // alias resolves for the bundler, not for `node scripts/*.ts`.
      files: ["scripts/**"],
      rules: {
        "no-restricted-imports": "off",
      },
    },
  ],
});
