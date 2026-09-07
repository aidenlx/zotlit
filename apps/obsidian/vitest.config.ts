import preact from "@preact/preset-vite";
import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

import { pandocFilterVariants } from "./scripts/lua-filter.ts";

const packageRoot = import.meta.dirname;

/**
 * Run under the `happy-dom-native-response` project below, not the default
 * `node` environment.
 *
 * @see {@link ./vitest.env.happy-dom-native-response.ts}
 */
const HAPPY_DOM_NATIVE_RESPONSE_FILES = [
  "src/services/pandoc/citation-locale.integration.test.ts",
  "src/services/pandoc/citation-presentation.integration.test.ts",
  "src/services/pandoc/document-language.integration.test.ts",
  "src/services/citation-text/document-citation-set.integration.test.ts",
];

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
    // `include`/`exclude` live on the two projects below, not here: Vite's
    // `mergeConfig` concatenates array fields a project shares with this root
    // config, so an `include` set here would survive alongside each project's
    // own and widen it back to everything. Keeping them project-only turns
    // that merge into a plain assignment instead.
    environment: "node",
    clearMocks: true,
    server: {
      deps: {
        // Run through Vite so its `react` import lands on the Preact alias
        // like our own sources; externalized, it would load real React.
        inline: ["@uiw/react-codemirror"],
      },
    },
    setupFiles: ["./vitest.setup.js"],
    // `// @vitest-environment` can't name a project by file path (its pragma only accepts `[\w-]+`), so the split happens here instead.
    projects: [
      {
        extends: true,
        test: {
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
          exclude: [
            ...configDefaults.exclude,
            ...HAPPY_DOM_NATIVE_RESPONSE_FILES,
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "happy-dom-native-response",
          include: HAPPY_DOM_NATIVE_RESPONSE_FILES,
          environment: "./vitest.env.happy-dom-native-response.ts",
        },
      },
    ],
  },
});
