import { getLogLevels } from "@logtape/logtape";
import * as v from "valibot";

import { USER_LIBRARY_ID } from "@zotlit/db";
import {
  autoTrimSchema,
  frontmatterFieldSchema,
  type AutoTrim,
} from "@zotlit/templates/constants";

import {
  DEFAULT_FRONTMATTER_FIELDS,
  DEFAULT_NOTE_FILENAME,
} from "@/services/template/defaults";

/**
 * JSON-safe values a setting may take. Recursive so structured settings (e.g.
 * `note.frontmatter-fields`) round-trip through `data.json`. The array / index
 * branches are `readonly` so `v.readonly()`-typed settings stay assignable to
 * this guard.
 */
type SettingsValue =
  | string
  | number
  | boolean
  | null
  | readonly SettingsValue[]
  | { readonly [key: string]: SettingsValue };

const frontmatterFieldsSchema = v.pipe(
  v.array(frontmatterFieldSchema),
  v.checkItems(
    (item, index, array) =>
      array.findIndex((field) => field.key === item.key) === index,
    "Duplicate frontmatter key",
  ),
  v.readonly(),
);

/** JSON-safe finite number that settings values may take. */
export const settingsNumber = v.pipe(v.number(), v.finite());

/**
 * LogTape severity levels. `null` means logging is disabled, matching legacy
 * log4js `OFF`; legacy `MARK` is dropped during migration because there is no
 * LogTape equivalent.
 */
const logLevel = v.nullable(v.picklist(getLogLevels()));
export type LogLevel = v.InferOutput<typeof logLevel>;

export type { AutoTrim };

const zoteroReadMode = v.picklist(["auto", "reflink", "copy", "immutable"]);
export type ZoteroReadMode = v.InferOutput<typeof zoteroReadMode>;

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
  "note.frontmatter-fields": frontmatterFieldsSchema,

  "server.enabled": v.boolean(),
  "server.port": serverPort,
  "server.hostname": v.string(),

  "template.folder": v.string(),
  "template.filename": v.string(),
  "template.auto-pair-eta": v.boolean(),
  "template.auto-trim-leading": autoTrimSchema,
  "template.auto-trim-trailing": autoTrimSchema,

  "zotero.auto-refresh": v.boolean(),
  "zotero.read-mode": zoteroReadMode,
  "zotero.profile-dir": v.nullable(v.string()),
  "zotero.data-dir": v.nullable(v.string()),
  "zotero.citation-library": settingsNumber,

  "attachment.folder-path": v.nullable(v.string()),
  "attachment.import": v.boolean(),
}) satisfies v.GenericSchema<unknown, Record<string, SettingsValue>>;

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
  "note.literature-folder": "literatures",
  "note.frontmatter-fields": DEFAULT_FRONTMATTER_FIELDS,
  "server.enabled": false,
  "server.port": 9091,
  "server.hostname": "127.0.0.1",
  "template.folder": "templates",
  "template.filename": DEFAULT_NOTE_FILENAME,
  "template.auto-pair-eta": false,
  "template.auto-trim-leading": false,
  "template.auto-trim-trailing": false,
  "zotero.auto-refresh": true,
  "zotero.read-mode": "auto",
  "zotero.profile-dir": null,
  "zotero.data-dir": null,
  "zotero.citation-library": USER_LIBRARY_ID,
  "attachment.folder-path": null,
  "attachment.import": true,
} satisfies Settings);
