// Builds the two files Obsidian loads, `main.js` and `styles.css`, at the
// root of this repository.
//
// The plugin's code comes from its bundle package, the one entry of
// `dependencies` in package.json. That package holds the plugin as one ES
// module, with ZotLit's own code and its third-party code already bundled, and
// the finished stylesheet. This build turns the module into the CommonJS file
// Obsidian requires and minifies it; it reads no environment variable.
//
// ZotLit's source repository (README.md links it) runs this same file for its
// own release build, so the two `main.js` files match byte for byte.
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

/** The modules Obsidian provides at runtime. The plugin requires them, so the build leaves them out. */
export const HOST_MODULES = [
  "obsidian",
  "electron",
  "@electron/remote",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
  ...[...builtinModules, "original-fs", "original-fs/promises"].flatMap(
    (name) => [name, `node:${name}`],
  ),
];

/**
 * Writes `main.js` and `styles.css` into `outDir`.
 *
 * @param {object} options
 * @param {string} options.entry the module whose default export is the plugin class.
 * @param {string} options.styles the bundle package's stylesheet.
 * @param {string} options.outDir the folder Obsidian loads the plugin from.
 * @param {Record<string, string>} [options.alias] module names to resolve to a file.
 */
export async function buildPlugin({ entry, styles, outDir, alias = {} }) {
  const result = await build({
    configFile: false,
    envDir: false,
    root: dirname(entry),
    mode: "production",
    logLevel: "warn",
    publicDir: false,
    resolve: { alias },
    build: {
      // The build hands back main.js, which is written below.
      write: false,
      copyPublicDir: false,
      reportCompressedSize: false,
      minify: true,
      sourcemap: false,
      target: "es2025",
      lib: { entry, formats: ["cjs"], fileName: () => "main.js" },
      rolldownOptions: {
        external: HOST_MODULES,
        // The bundle package already runs every module in source order;
        // the option keeps that order when the module becomes CommonJS.
        output: { strictExecutionOrder: true, codeSplitting: false },
      },
    },
  });
  const files = (Array.isArray(result) ? result : [result]).flatMap((output) =>
    "output" in output ? output.output : [],
  );
  const [main, ...others] = files;
  if (main?.type !== "chunk" || others.length > 0) {
    throw new Error("The build must produce one file, main.js.");
  }
  await writeFile(join(outDir, "main.js"), main.code);
  await copyFile(styles, join(outDir, "styles.css"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const [bundle, ...others] = Object.keys(manifest.dependencies ?? {});
  if (!bundle || others.length > 0) {
    throw new Error(
      "package.json must list one dependency: the plugin's bundle package.",
    );
  }
  await buildPlugin({
    entry: join(root, "src/main.ts"),
    styles: createRequire(manifestPath).resolve(`${bundle}/styles.css`),
    outDir: root,
  });
}
