import { defineConfig } from "tsdown";

/** The browser-safe entries, each also published as its source. */
const SOURCE = {
  language: "./src/language/index.ts",
  completion: "./src/language/semantics.ts",
  document: "./src/document/index.ts",
  render: "./src/render/index.ts",
  explorer: "./src/explorer/index.ts",
  bridge: "./src/bridge/index.ts",
};

export default defineConfig({
  entry: [{ ...SOURCE, snapshot: "./src/snapshot/index.ts" }],
  tsconfig: "./tsconfig.lib.json",
  dts: true,
  exports: {
    // A host's dev server resolves the `development` condition, so it reads
    // the source and hot-updates an edit here without a rebuild; a production
    // build, Node, and the type checker keep the built `default` entry. The
    // Node-only `snapshot` entry stays as it is.
    customExports(exports) {
      for (const [name, file] of Object.entries(SOURCE)) {
        exports[`./${name}`] = {
          development: file,
          default: `./dist/${name}.mjs`,
        };
      }
      exports["./snapshot"] = {
        types: "./dist/snapshot.d.mts",
        node: "./dist/snapshot.mjs",
      };
      return exports;
    },
  },
  unbundle: true,
  target: "esnext",
});
