import { defineConfig } from "oxfmt";

import baseConfig from "@zotlit/config/oxfmt";

export default defineConfig({
  ...baseConfig,
  sortTailwindcss: {
    stylesheet: "./src/styles.css",
  },
  ignorePatterns: [
    "**/dist/**",
    "**/build/**",
    "**/.turbo/**",
    "**/.output/**",
    "**/.tanstack/**",
    "**/.nitro/**",
    "**/node_modules/**",
    "**/coverage/**",
    "**/*.min.js",
    "**/*.md",
    "src/routeTree.gen.ts",
  ],
});
