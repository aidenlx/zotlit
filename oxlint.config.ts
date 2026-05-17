import baseConfig from "@zotlit/config/oxlint";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [baseConfig],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  ignorePatterns: [
    "**/dist/**",
    "**/dist-dev/**",
    "**/build/**",
    "**/.turbo/**",
    "**/.next/**",
    "**/node_modules/**",
    "**/coverage/**",
    "**/*.min.js",
    "pnpm-lock.yaml",
    ".agents/**",
    ".claude/**",
    "tests/zt-vault/**",
    "packages/obsidian-api/**",
  ],
  overrides: [
    {
      files: ["**/*.{test,spec}.{ts,tsx,js,jsx}"],
      plugins: ["vitest"],
      rules: {
        "typescript/no-floating-promises": "off",
      },
    },
  ],
});
