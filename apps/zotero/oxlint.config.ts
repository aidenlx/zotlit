import { defineConfig } from "oxlint";

import { testBaselineOverrides } from "@zotlit/config/oxlint";
import baseConfig from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  rules: {
    "no-restricted-properties": [
      "error",
      {
        object: "Zotero",
        property: "Prefs",
        message:
          "Use the typed `prefs` wrapper in src/prefs/index.ts, which passes the required global:true flag. Raw Zotero.Prefs targets the wrong extensions.zotero.* branch.",
      },
    ],
  },
  overrides: [
    ...testBaselineOverrides("apps/zotero"),
    {
      // Zotero's Firefox 140 ESR ships no Temporal (policies/dates.md); the
      // Node scripts have it.
      files: ["src/**"],
      rules: {
        "effecttsgo/global-date": "off",
        "effecttsgo/global-date-in-effect": "off",
        "no-restricted-globals": "off",
        "typescript/no-restricted-types": "off",
      },
    },
    {
      files: ["src/prefs/index.ts"],
      rules: {
        "no-restricted-properties": "off",
      },
    },
  ],
});
