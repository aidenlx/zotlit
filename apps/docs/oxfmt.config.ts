import { defineConfig } from "oxfmt";

import baseConfig from "@zotlit/config/oxfmt";

export default defineConfig({
  ...baseConfig,
  sortTailwindcss: {
    stylesheet: "./src/styles.css",
    functions: ["cn"],
  },
  ignorePatterns: [
    ...baseConfig.ignorePatterns,
    "**/dist/**",
    "**/.tanstack/**",
    "src/routeTree.gen.ts",
    "worker-configuration.d.ts",
  ],
});
