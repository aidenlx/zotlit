import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { glob } from "tinyglobby";
import type { Plugin } from "vite";

import {
  formatCompilerWarnings,
  loadMessageData,
} from "@zotlit/obsidian-i18n/compiler";

import { emitFluent } from "./inlang-fluent.js";
import type { FluentEmitOptions, FluentEmitResult } from "./inlang-fluent.js";
import type { ZoteroBuildEnv } from "./vite-zotero-plugin.js";

export interface FluentPluginOpts extends FluentEmitOptions {
  root: string;
  env: ZoteroBuildEnv;
  /** Absolute path of the inlang project directory. */
  project: string;
  /** Filename Zotero resolves via `new Localization([ftlFileName])`. */
  ftlFileName: string;
  /** Addon-staging source dir; every `.xhtml` underneath is scanned for `data-l10n-id` refs. */
  addonDir: string;
  /** Codegen output path for the `FluentMessages` map, relative to `root`. */
  typesOutput: string;
}

const DATA_L10N_RE = /\bdata-l10n-id="([^"]+)"/g;

function extractDataL10nIds(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DATA_L10N_RE)) out.push(m[1]!);
  return out;
}

export function fluentPlugin({
  root,
  env,
  project,
  namespace,
  prefix,
  localeAliases,
  ftlFileName,
  addonDir,
  typesOutput,
}: FluentPluginOpts): Plugin {
  const absAddonDir = resolve(root, addonDir);
  const absTypesOutput = resolve(root, typesOutput);
  const absStaging = resolve(root, env.addonStaging);

  let emitted: FluentEmitResult | undefined;

  return {
    name: "zotero-fluent",
    async buildStart() {
      const data = await loadMessageData({
        root,
        project,
        includeMessagePrefixes: [namespace],
      });
      for (const path of data.watchPaths) this.addWatchFile(path);
      // A locale may leave a message untranslated; the base locale may not
      // lack one, and no locale may use an input the base never declares.
      const failing = formatCompilerWarnings({
        untranslated: [],
        undeclaredInputs: data.undeclaredInputs,
        missingBaseLocale: data.missingBaseLocale,
      });
      if (failing !== undefined) {
        this.error(`[fluent] validation failed:\n${failing}`);
      }
      if (data.warnings.length > 0) this.warn(data.warnings.join("\n"));

      emitted = emitFluent(data, { namespace, prefix, localeAliases });

      const errors: string[] = [];
      const xhtmlPaths = await glob("**/*.xhtml", {
        cwd: absAddonDir,
        absolute: true,
      });
      for (const xhtmlPath of xhtmlPaths) {
        const text = await readFile(xhtmlPath, "utf-8");
        for (const ref of extractDataL10nIds(text)) {
          if (!emitted.ids.has(ref)) {
            errors.push(
              `  ${relative(root, xhtmlPath)}: data-l10n-id="${ref}" is not a message under "${namespace}" in the inlang project`,
            );
          }
        }
      }
      if (errors.length > 0) {
        this.error(`[fluent] validation failed:\n${errors.join("\n")}`);
      }

      let onDiskTypes: string | null = null;
      try {
        onDiskTypes = await readFile(absTypesOutput, "utf-8");
      } catch {
        // file missing — write below
      }
      if (onDiskTypes !== emitted.types) {
        await mkdir(dirname(absTypesOutput), { recursive: true });
        await writeFile(absTypesOutput, emitted.types);
        if (!this.meta.watchMode) {
          this.error(
            `[fluent] ${typesOutput} was out of sync with the inlang project — regenerated. ` +
              `Commit the change and rerun the build.`,
          );
        }
      }

      this.addWatchFile(absAddonDir);
      for (const p of xhtmlPaths) this.addWatchFile(p);
    },
    async writeBundle() {
      for (const [locale, text] of emitted?.files ?? []) {
        const outDir = join(absStaging, "locale", locale);
        await mkdir(outDir, { recursive: true });
        await writeFile(join(outDir, ftlFileName), text);
      }
    },
  };
}
