import { defineConfig } from "oxlint";

import baseConfig, {
  datePattern,
  testBaselineOverrides,
} from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  plugins: ["node"],
  overrides: [
    ...testBaselineOverrides("packages/db"),
    {
      // Codegen scripts read `src/` directly; the `@/` alias resolves for the
      // bundler, not for `node scripts/*.ts`.
      files: ["scripts/**"],
      rules: {
        "no-restricted-imports": ["error", { patterns: [datePattern] }],
      },
    },
  ],
});
