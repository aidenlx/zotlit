import { getLogLevels } from "@logtape/logtape";
import * as v from "valibot";

import { USER_LIBRARY_ID } from "@zotlit/db";
import {
  autoTrimSchema,
  DEFAULT_AUTO_TRIM,
  frontmatterFieldSchema,
} from "@zotlit/templates/constants";
import type { AutoTrim } from "@zotlit/templates/constants";

import { DEFAULT_FRONTMATTER_FIELDS } from "@/services/template/defaults";

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
  "citation.at-trigger": v.boolean(),
  "citation.show-citekey-in-suggester": v.boolean(),
  /** Include Pandoc citation syntax in the shared document citation set. */
  "citation.pandoc-citations": v.boolean(),
  /** Treat Literature Note wikilinks as Citations in the index-backed UI. */
  "citation.wikilink-citations": v.boolean(),
  /** Show recognized Citations with the selected CSL style. */
  "citation.show-formatted": v.boolean(),
  /** Mark and click literal `@citekey` text in the editor. */
  "citation.citekey-editor": v.boolean(),
  /** CSL style ID; `null` renders with the citation engine's embedded style. */
  "citation.references-style": v.nullable(v.string()),

  "note.literature-folder": v.string(),
  "note.frontmatter-fields": frontmatterFieldsSchema,
  "note.import-folder": v.string(),
  "note.import-annotations-as-template": v.boolean(),

  "server.enabled": v.boolean(),
  "server.port": serverPort,
  "server.hostname": v.string(),

  "template.folder": v.string(),
  "template.auto-pair-eta": v.boolean(),
  "template.auto-trim-leading": autoTrimSchema,
  "template.auto-trim-trailing": autoTrimSchema,

  "zotero.auto-refresh": v.boolean(),
  "zotero.read-mode": zoteroReadMode,
  "zotero.citation-library": settingsNumber,

  "attachment.folder-path": v.nullable(v.string()),
  "attachment.import": v.boolean(),

  "release.previous-version": v.nullable(v.string()),
  "release.notices-enabled": v.boolean(),
  "release.migration-pending": v.boolean(),
}) satisfies v.GenericSchema<unknown, Record<string, SettingsValue>>;

export type Settings = v.InferOutput<typeof schema>;

/**
 * Current defaults. Host-dependent legacy defaults are represented as `null` and
 * resolved by the helpers below, so their effective values still match legacy
 * `getDefaultSettings()` without persisting machine-specific values.
 */
export const defaults: Readonly<Settings> = Object.freeze({
  "log.level": __DEV__ ? "trace" : "info",
  "log.to-file": false,
  "citation.editor-suggester": true,
  "citation.at-trigger": false,
  "citation.show-citekey-in-suggester": false,
  "citation.pandoc-citations": true,
  "citation.wikilink-citations": false,
  "citation.show-formatted": true,
  "citation.citekey-editor": true,
  "citation.references-style": null,
  "note.literature-folder": "literatures",
  "note.frontmatter-fields": DEFAULT_FRONTMATTER_FIELDS,
  "note.import-folder": "zotero_notes",
  "note.import-annotations-as-template": false,
  "server.enabled": false,
  "server.port": 9091,
  "server.hostname": "127.0.0.1",
  "template.folder": "templates",
  "template.auto-pair-eta": false,
  "template.auto-trim-leading": DEFAULT_AUTO_TRIM.leading,
  "template.auto-trim-trailing": DEFAULT_AUTO_TRIM.trailing,
  "zotero.auto-refresh": true,
  "zotero.read-mode": "auto",
  "zotero.citation-library": USER_LIBRARY_ID,
  "attachment.folder-path": null,
  "attachment.import": true,
  // Absent until the release check records a launch; see the release service.
  "release.previous-version": null,
  "release.notices-enabled": true,
  "release.migration-pending": false,
} satisfies Settings);
