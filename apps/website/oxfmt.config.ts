import { defineConfig } from "oxfmt";

import baseConfig from "@zotlit/config/oxfmt";

export default defineConfig({
  ...baseConfig,
  sortTailwindcss: {
    stylesheet: "./src/styles.css",
  },
  ignorePatterns: [
    ...baseConfig.ignorePatterns,
    "**/dist/**",
    "**/.tanstack/**",
    "**/.next/**",
    "src/routeTree.gen.ts",
  ],
});
