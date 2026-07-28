import preact from "@preact/preset-vite";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const here = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      // The published `obsidian` package is types-only; redirect runtime
      // imports to our local mock so tests can `import { ... } from "obsidian"`.
      obsidian: resolve(here, "__mocks__/obsidian.ts"),
    },
    tsconfigPaths: true,
  },
  define: {
    __DEV__: JSON.stringify(true),
  },
  plugins: [preact()],
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
  },
});
