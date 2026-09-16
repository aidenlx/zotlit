import { defineConfig } from "oxlint";

import baseConfig from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  // The pinned port is upstream code, copied verbatim and never hand-edited.
  ignorePatterns: ["src/vendor/*.js"],
});
