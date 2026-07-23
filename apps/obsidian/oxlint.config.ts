import { defineConfig } from "oxlint";

import baseConfig from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  rules: {
    "no-console": "error",
  },
  overrides: [
    {
      files: [
        "vite.config.ts",
        "src/zt-main.ts",
        "src/services/build.ts",
        "src/services/service-base.ts",
        "src/services/settings/service.ts",
        "src/services/log/**",
      ],
      rules: {
        "no-console": "off",
      },
    },
  ],
});
