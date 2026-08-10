import preact from "@preact/preset-vite";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

import { pandocFilterVariants } from "./scripts/lua-filter.ts";

const packageRoot = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      // The published `obsidian` package is types-only; redirect runtime
      // imports to our local mock so tests can `import { ... } from "obsidian"`.
      obsidian: resolve(packageRoot, "__mocks__/obsidian.ts"),
    },
    tsconfigPaths: true,
  },
  define: {
    __DEV__: JSON.stringify(true),
    // Resolving the real pin needs the network; a test that cares about engine
    // metadata takes it as an argument rather than reading this placeholder.
    __PANDOC_ENGINE__: JSON.stringify({
      version: "0.0.0",
      url: "https://example.invalid/pandoc.wasm.zip",
      sha256: "0".repeat(64),
    }),
  },
  plugins: [preact(), pandocFilterVariants()],
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
