import { defineConfig } from "oxfmt";

import baseConfig from "@zotlit/config/oxfmt";

export default defineConfig({
  ...baseConfig,
  ignorePatterns: [
    ...baseConfig.ignorePatterns,
    // add app/obsidian specific ignore patterns here
  ],
  sortTailwindcss: {
    stylesheet: "./src/zt-main.css",
    functions: ["cn", "tv"],
  },
});
