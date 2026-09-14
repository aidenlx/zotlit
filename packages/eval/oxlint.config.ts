import { defineConfig } from "oxlint";

import baseConfig from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  ignorePatterns: ["**/node_modules/**", "**/.turbo/**"],
});
