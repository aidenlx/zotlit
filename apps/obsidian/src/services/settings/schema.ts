import { getLogLevels } from "@logtape/logtape";
import { homedir } from "node:os";
import { join } from "node:path";
import { Platform } from "obsidian";
import * as v from "valibot";

/** JSON-safe primitives that settings values may take. */
type SettingsPrimitive = string | number | boolean | null;

/** JSON-safe finite number that settings values may take. */
export const settingsNumber = v.pipe(v.number(), v.finite());

/**
 * LogTape severity levels. `null` means logging is disabled, matching legacy
 * log4js `OFF`; legacy `MARK` is dropped during migration because there is no
 * LogTape equivalent.
 */
const logLevel = v.nullable(v.picklist(getLogLevels()));
export type LogLevel = v.InferOutput<typeof logLevel>;

/**
 * Eta `autoTrim` mode for one side of a template tag. `"nl"` strips a single
 * newline, `"slurp"` strips all whitespace, `false` keeps it.
 */
const autoTrim = v.union([
  v.literal(false),
  v.literal("nl"),
  v.literal("slurp"),
]);
export type AutoTrim = v.InferOutput<typeof autoTrim>;

/**
 * How PDF image-annotation excerpts are brought into the vault: `"symlink"`
 * links to Zotero's cache, `"copy"` duplicates the file, `false` disables.
 */
const imgExcerptImport = v.union([
  v.literal(false),
  v.literal("symlink"),
  v.literal("copy"),
]);
export type ImgExcerptImport = v.InferOutput<typeof imgExcerptImport>;

const serverPort = v.pipe(
  settingsNumber,
  v.integer(),
  v.minValue(0),
  v.maxValue(65535),
);

export const schema = v.object({
  "log.level": logLevel,
  "log.to-file": v.boolean(),

  "citation.editor-suggester": v.boolean(),
  "citation.show-citekey-in-suggester": v.boolean(),

  "note.literature-folder": v.string(),

  "server.enabled": v.boolean(),
  "server.port": serverPort,
  "server.hostname": v.string(),

  "template.folder": v.string(),
  "template.filename": v.string(),
  "template.update-annot-block": v.boolean(),
  "template.update-overwrite": v.boolean(),
  "template.auto-pair-eta": v.boolean(),
  "template.auto-trim-leading": autoTrim,
  "template.auto-trim-trailing": autoTrim,

  "zotero.auto-refresh": v.boolean(),
  "zotero.data-dir": v.nullable(v.string()),
  "zotero.citation-library": settingsNumber,

  "img-excerpt.import": v.nullable(imgExcerptImport),
  "img-excerpt.path": v.string(),
}) satisfies v.GenericSchema<unknown, Record<string, SettingsPrimitive>>;

export type Settings = v.InferOutput<typeof schema>;

/**
 * v1 defaults. Host-dependent legacy defaults are represented as `null` and
 * resolved by the helpers below, so their effective values still match legacy
 * `getDefaultSettings()` without persisting machine-specific values.
 */
export const defaults: Readonly<Settings> = Object.freeze({
  "log.level": __DEV__ ? "trace" : "info",
  "log.to-file": false,
  "citation.editor-suggester": true,
  "citation.show-citekey-in-suggester": false,
  "note.literature-folder": "LiteratureNotes",
  "server.enabled": false,
  "server.port": 9091,
  "server.hostname": "127.0.0.1",
  "template.folder": "ZtTemplates",
  "template.filename": "<%= it.citekey ?? it.DOI ?? it.title ?? it.key %>.md",
  "template.update-annot-block": false,
  "template.update-overwrite": false,
  "template.auto-pair-eta": false,
  "template.auto-trim-leading": false,
  "template.auto-trim-trailing": false,
  "zotero.auto-refresh": true,
  "zotero.data-dir": null,
  "zotero.citation-library": 1,
  "img-excerpt.import": null,
  "img-excerpt.path": "ZtImgExcerpt",
} satisfies Settings);

/**
 * Resolve `zotero.data-dir`: returns the user-set string when non-null,
 * otherwise `$HOME/Zotero` computed at call time so tests can mock `homedir`.
 */
export function resolveZoteroDataDir(value: string | null): string {
  return value ?? join(homedir(), "Zotero");
}

/**
 * Resolve `img-excerpt.import`: returns the user-set value when non-null
 * (`false` is a legitimate explicit "disabled"), otherwise the platform
 * default — `"copy"` on Windows (symlinks need elevated permissions),
 * `"symlink"` elsewhere.
 */
export function resolveImgExcerptImport(
  value: ImgExcerptImport | null,
): ImgExcerptImport {
  return value ?? (Platform.isWin ? "copy" : "symlink");
}
