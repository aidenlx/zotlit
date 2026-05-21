import { defineConfig } from "oxfmt";

import baseConfig from "@zotlit/config/oxfmt";

export default defineConfig({
  ...baseConfig,
  ignorePatterns: [
    "**/dist/**",
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
    "packages/pdfjs-dist/**",
    "**/*.md",
  ],
});
