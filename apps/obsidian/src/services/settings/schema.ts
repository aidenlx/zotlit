import { getLogLevels } from "@logtape/logtape";
import * as v from "valibot";

import {
  autoTrimSchema,
  DEFAULT_AUTO_TRIM,
  frontmatterFieldSchema,
} from "@zotlit/templates/constants";
import type { AutoTrim } from "@zotlit/templates/constants";

import {
  DEFAULT_LIBRARY_SCOPE,
  libraryScopeSchema,
} from "@/services/library-scope/scope";
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

const defaultLiteratureNoteProfileSchema = v.pipe(
  v.object({
    bindings: v.pipe(
      v.object({
        "note.literature-folder": v.string(),
        "citation.references-style": v.nullable(v.string()),
        "note.import-folder": v.string(),
        "note.import-colored-highlights": v.boolean(),
        "note.import-annotations-as-template": v.boolean(),
      }),
      v.readonly(),
    ),
  }),
  v.readonly(),
);

export type DefaultLiteratureNoteProfile = v.InferOutput<
  typeof defaultLiteratureNoteProfileSchema
>;

/** The built-in Profile is the total inheritance root for vault-local bindings. */
export const DEFAULT_LITERATURE_NOTE_PROFILE = Object.freeze({
  bindings: Object.freeze({
    "note.literature-folder": "literatures",
    "citation.references-style": null,
    "note.import-folder": "zotero_notes",
    "note.import-colored-highlights": false,
    "note.import-annotations-as-template": false,
  }),
}) satisfies DefaultLiteratureNoteProfile;

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

/**
 * What hovering a recognized citation or Literature Note link shows. One hover
 * result at a time: the Citation Popover and the page preview are never both
 * reachable, and `off` leaves hover entirely to Obsidian.
 */
const hoverAction = v.picklist(["off", "popover", "page-preview"]);
export type HoverAction = v.InferOutput<typeof hoverAction>;

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
  /**
   * Navigate to the Literature Note when a Citation is clicked, on both Pandoc
   * Citations and Literature Note wikilinks rendered as Citations.
   */
  "citation.open-as-links": v.boolean(),
  /**
   * Citation Locale as a BCP 47 tag; `null` or empty leaves the selected CSL
   * style's own default locale in charge.
   */
  "citation.locale": v.nullable(v.string()),
  /** What hovering a Citation shows, on every surface that carries one. */
  "citation.hover-action": hoverAction,
  /** Whether the Citation Popover needs a held Mod, per editing mode. */
  "citation.hover-require-mod-source": v.boolean(),
  "citation.hover-require-mod-live-preview": v.boolean(),
  "citation.hover-require-mod-reading": v.boolean(),

  "note.default-profile": defaultLiteratureNoteProfileSchema,
  "note.template-conversion-pending": v.boolean(),
  "note.frontmatter-fields": frontmatterFieldsSchema,

  "server.enabled": v.boolean(),
  "server.port": serverPort,
  "server.hostname": v.string(),

  "template.folder": v.string(),
  "template.auto-pair-eta": v.boolean(),
  "template.auto-trim-leading": autoTrimSchema,
  "template.auto-trim-trailing": autoTrimSchema,

  "zotero.auto-refresh": v.boolean(),
  "zotero.read-mode": zoteroReadMode,
  /**
   * Libraries used for item search, citation key resolution, and library-wide
   * commands. Strict by design — an out-of-order or empty selection is broken
   * input, not something to normalize; see `services/library-scope/scope.ts`.
   */
  "zotero.library-scope": libraryScopeSchema,

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
  "citation.open-as-links": false,
  "citation.locale": null,
  "citation.hover-action": "popover",
  // Source mode keeps the modifier so plain-text editing is never interrupted,
  // while the two rendered modes answer to bare hover.
  "citation.hover-require-mod-source": true,
  "citation.hover-require-mod-live-preview": false,
  "citation.hover-require-mod-reading": false,
  "note.default-profile": DEFAULT_LITERATURE_NOTE_PROFILE,
  "note.template-conversion-pending": false,
  "note.frontmatter-fields": DEFAULT_FRONTMATTER_FIELDS,
  "server.enabled": false,
  "server.port": 9091,
  "server.hostname": "127.0.0.1",
  "template.folder": "templates",
  "template.auto-pair-eta": false,
  "template.auto-trim-leading": DEFAULT_AUTO_TRIM.leading,
  "template.auto-trim-trailing": DEFAULT_AUTO_TRIM.trailing,
  "zotero.auto-refresh": true,
  "zotero.read-mode": "auto",
  "zotero.library-scope": DEFAULT_LIBRARY_SCOPE,
  "attachment.folder-path": null,
  "attachment.import": true,
  // Absent until the release check records a launch; see the release service.
  "release.previous-version": null,
  "release.notices-enabled": true,
  "release.migration-pending": false,
} satisfies Settings);
