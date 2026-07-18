import { defineConfig } from "oxfmt";

import baseConfig from "@zotlit/config/oxfmt";

export default defineConfig({
  ...baseConfig,
  ignorePatterns: [
    ...baseConfig.ignorePatterns,
    ".source/**",
    "**/.next/**",
    "out/**",
  ],
  sortTailwindcss: {
    stylesheet: "./app/global.css",
    functions: ["cn"],
  },
});
