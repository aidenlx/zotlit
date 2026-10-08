import { defineConfig } from "oxlint";

import baseConfig from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  rules: {
    // Zotero's Firefox 140 ESR ships no Temporal (apps/zotero/policies/dates.md).
    "no-restricted-globals": "off",
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
    {
      files: ["src/prefs/index.ts"],
      rules: {
        "no-restricted-properties": "off",
      },
    },
  ],
});
