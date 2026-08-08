import { isPlainObject } from "./classify";
import { defaults } from "./schema";
import type { LogLevel, Settings } from "./schema";

const DEFAULT_CITEKEY_FIELD = {
  key: "citekey",
  expr: "zt.citationKey",
  merge: "replace",
  language: "liquid",
} as const;

/**
 * Log4js severity levels
 */
type V0LogLevel =
  | "ALL"
  | "TRACE"
  | "DEBUG"
  | "INFO"
  | "WARN"
  | "ERROR"
  | "FATAL"
  | "MARK"
  | "OFF";

/**
 * Eta `autoTrim` mode for one side of a template tag.
 * `"nl"` strips a single newline, `"slurp"` strips all whitespace, `false` keeps it.
 * Source: `eta-prf/dist/types/config.d.ts`.
 */
type V0TrimConfig = "nl" | "slurp" | false;

/**
 * Embedded template keys (templates whose source is inlined rather than read
 * from disk). v1 had a single embedded template: the literature-note filename
 * pattern.
 * Source: `zotlit-v1/app/obsidian/src/services/template/eta/preset.ts` →
 * `Template.Embeded`.
 */
type V0EmbededTplType = "filename";

/**
 * Flat settings shape carried over from v1 (`apps/obsidian/src/settings/`).
 * Each key is sourced from a per-feature `defaultSettings*` object that v1
 * merged together in `settings/service.ts`.
 */
export interface ZotLitSettingsV0 {
  // --- Log (v1: log.ts) ---
  /** Log4js log level for the main thread and database worker; v1 mirrored this to localStorage under "log4js_loglevel". Default: "INFO". */
  logLevel: V0LogLevel;

  // --- Citation suggester (v1: note-feature/citation-suggest/settings.ts) ---
  /** Enable the in-editor `@`-trigger suggester that inserts Zotero citations while typing. Default: true. */
  citationEditorSuggester: boolean;
  /** Show each item's citekey alongside its title in the suggester dropdown. Default: false. */
  showCitekeyInSuggester: boolean;

  // --- Note index (v1: services/note-index/settings.ts) ---
  /** Vault-relative folder where literature notes are created and indexed. Default: "LiteratureNotes". */
  literatureNoteFolder: string;

  // --- Local HTTP server (v1: services/server/settings.ts) ---
  /** Run the built-in HTTP server that Zotero's browser/desktop connectors POST to (e.g. "Cite in Obsidian"). Default: false. */
  enableServer: boolean;
  /** TCP port the local server binds to. Default: 9091. */
  serverPort: number;
  /** Hostname/IP the local server binds to; keep on loopback unless intentionally exposing. Default: "127.0.0.1". */
  serverHostname: string;

  // --- Templates (v1: services/template/settings.ts) ---
  /** Eta template config: `folder` is the vault path holding template files; `templates` maps each embedded template type to its inline source. */
  template: { folder: string; templates: Record<V0EmbededTplType, string> };
  /** Auto-close Eta tag pairs (`<% %>`, `<%= %>`, …) while editing template files. Default: false. */
  autoPairEta: boolean;
  /** Eta `autoTrim` setting — tuple of [leading, trailing] whitespace trim modes applied to template output. Default: [false, false]. */
  autoTrim: [V0TrimConfig, V0TrimConfig];

  // --- Auto-refresh watcher (v1: services/zotero-db/auto-refresh/settings.ts) ---
  /** Watch Zotero's SQLite files and auto-refresh the in-memory database when Zotero writes changes. Default: true. */
  autoRefresh: boolean;

  // --- Zotero database connection (v1: services/zotero-db/connector/settings.ts) ---
  /** Zotero library id used as the citation source (1 = personal "My Library"; >1 = group libraries). Default: 1. */
  citationLibrary: number;

  // --- Image excerpt importer (v1: services/zotero-db/img-import/settings.ts) ---
  /** How PDF image-annotation excerpts are brought into the vault: "symlink" links to Zotero's cache, "copy" duplicates the file, false disables import. */
  imgExcerptImport: false | "symlink" | "copy";
  /** Vault-relative folder where imported image excerpts are placed. Default: "ZtImgExcerpt". */
  imgExcerptPath: string;
}

/**
 * Convert a v0 (pre-`__VERSION__`) ZotLit `data.json` into v1's flat
 * dotted-key shape. Returns sparse overrides — only non-default keys present
 * (and shaped plausibly) in the input — and lets `SettingsService`'s per-key
 * cleanup drop anything that fails the v1 schema.
 *
 * @returns a v1 overrides object; an empty object when the input is not a
 * plain v0 record.
 */
export function migrateLegacyV0(raw: unknown): Partial<Settings> {
  if (!isPlainObject(raw)) return {};
  const v0 = raw as Partial<Record<keyof ZotLitSettingsV0, unknown>>;
  const out: Record<string, unknown> = {};

  for (const [fromKey, toKey] of V0_KEY_MAP) {
    if (v0[fromKey] !== undefined) out[toKey] = v0[fromKey];
  }

  const logLevel = mapLogLevel(v0.logLevel);
  if (logLevel !== undefined) out["log.level"] = logLevel;

  // v1 embedded template sources are never migrated — they use the `it.*`
  // vocabulary while v2's upstream eta engine uses `zt.*`, and there's no
  // compat layer. v2 reads templates, including the `filename` Template,
  // from vault files instead.
  if (isPlainObject(v0.template) && typeof v0.template.folder === "string") {
    out["template.folder"] = v0.template.folder;
  }

  if (Array.isArray(v0.autoTrim) && v0.autoTrim.length === 2) {
    out["template.auto-trim-leading"] = v0.autoTrim[0];
    out["template.auto-trim-trailing"] = v0.autoTrim[1];
  }

  if (v0.imgExcerptImport !== undefined) {
    out["attachment.import"] = v0.imgExcerptImport !== false;
  }

  dropLegacyDefaultValues(out);
  return out as Partial<Settings>;
}

/**
 * Simple v0-key → v1-key renames. Keys whose v0 value is structured (logLevel,
 * template, autoTrim) are handled inline in `migrateLegacyV0` instead.
 */
const V0_KEY_MAP: ReadonlyArray<
  readonly [keyof ZotLitSettingsV0, keyof Settings]
> = [
  ["citationEditorSuggester", "citation.editor-suggester"],
  ["showCitekeyInSuggester", "citation.show-citekey-in-suggester"],
  ["literatureNoteFolder", "note.literature-folder"],
  ["enableServer", "server.enabled"],
  ["serverPort", "server.port"],
  ["serverHostname", "server.hostname"],
  ["autoPairEta", "template.auto-pair-eta"],
  ["autoRefresh", "zotero.auto-refresh"],
  ["citationLibrary", "zotero.citation-library"],
  ["imgExcerptPath", "attachment.folder-path"],
];

/**
 * Map log4js severity levels to logtape's set. OFF maps to `null` so the
 * disabled state is preserved; MARK returns `undefined` because there is no
 * LogTape equivalent, so the migration drops it and the v1 default applies.
 */
function mapLogLevel(value: unknown): LogLevel | undefined {
  if (typeof value !== "string") return undefined;
  switch (value as V0LogLevel) {
    case "ALL":
    case "TRACE":
      return "trace";
    case "DEBUG":
      return "debug";
    case "INFO":
      return "info";
    case "WARN":
      return "warning";
    case "ERROR":
      return "error";
    case "FATAL":
      return "fatal";
    case "OFF":
      return null;
    default:
      return undefined;
  }
}

/** v0 folder paths are always carried over so upgraded users keep their layout. */
const PRESERVED_V0_FOLDER_KEYS = new Set([
  "note.literature-folder",
  "template.folder",
]);

function dropLegacyDefaultValues(out: Record<string, unknown>): void {
  for (const key of Object.keys(out)) {
    if (PRESERVED_V0_FOLDER_KEYS.has(key)) continue;
    const legacyDefault = getLegacyDefaultValue(key);
    if (legacyDefault === undefined) continue;
    if (Object.is(out[key], legacyDefault)) {
      delete out[key];
    }
  }
}

function getLegacyDefaultValue(key: string): unknown {
  if (key === "attachment.import") return true;
  if (key === "attachment.folder-path") return "ZtImgExcerpt";
  if (key === "log.level") return "info";
  if (!Object.hasOwn(defaults, key)) return undefined;
  return defaults[key as keyof Settings];
}

/**
 * v1 `note.frontmatter-fields` items had no `language` key; every field
 * implicitly ran as JavaScript. These are the three byte-exact v1
 * `DEFAULT_FRONTMATTER_FIELDS` exprs (`zotlit-v1`-derived JS defaults), frozen
 * here on purpose — a near-miss expr (different quotes, whitespace, etc.) is
 * left stamped `"javascript"` rather than guessed at.
 */
const V1_DEFAULT_JS_TO_V2_LIQUID: ReadonlyMap<string, string> = new Map([
  ["zt.title", "zt.title"],
  [
    "zt.relatedItems.map((i) => i.noteLink() ?? `zt-error:${i.indexedKey}`)",
    "zt.relatedItems | note_links",
  ],
  [
    'zt.collections.map((c) => c.path.join("/"))',
    "zt.collections | collection_paths",
  ],
]);

/**
 * Convert a v1 `data.json` (no `note.frontmatter-fields[].language`) into
 * v2's shape, which requires `language` on every frontmatter field. Returns
 * everything else untouched — shape-plausible transform only, letting
 * `SettingsService`'s per-key cleanup drop anything schema-invalid.
 *
 * @returns the migrated object; an empty object when the input is not a
 * plain record.
 */
export function migrateV1ToV2(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};

  const out: Record<string, unknown> = { ...raw };
  const fields = out["note.frontmatter-fields"];
  if (Array.isArray(fields)) {
    out["note.frontmatter-fields"] = fields.map(migrateFrontmatterFieldV1ToV2);
  }
  return out;
}

function migrateFrontmatterFieldV1ToV2(item: unknown): unknown {
  if (!isPlainObject(item)) return item;

  const expr = item.expr;
  const liquidExpr =
    typeof expr === "string" ? V1_DEFAULT_JS_TO_V2_LIQUID.get(expr) : undefined;

  if (liquidExpr !== undefined) {
    return { ...item, expr: liquidExpr, language: "liquid" };
  }
  return { ...item, language: "javascript" };
}

/**
 * Preserve Citation Key Links for existing users while moving `citekey` into
 * the ordinary Managed Frontmatter field list.
 */
export function migrateV2ToV3(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};

  const out: Record<string, unknown> = {
    ...raw,
    "citation.key-links": true,
    "citation.key-links-frontmatter-key": "citekey",
  };
  const fields = out["note.frontmatter-fields"];
  if (
    Array.isArray(fields) &&
    !fields.some((field) => isPlainObject(field) && field.key === "citekey")
  ) {
    out["note.frontmatter-fields"] = [...fields, DEFAULT_CITEKEY_FIELD];
  }
  return out;
}

/**
 * Absorb Citation Key Links into the citekey editor treatment. The stored value
 * carries over verbatim — an absent key meant the v3 default, off — so an
 * upgrade never changes whether citekeys are clickable, while the new default
 * governs fresh installs only.
 */
export function migrateV3ToV4(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};

  const { "citation.key-links": keyLinks, ...rest } = raw;
  return { ...rest, "citation.citekey-editor": keyLinks === true };
}

/**
 * Retire the Citation Key Property. Citekeys resolve against Zotero's native
 * citation keys, so no frontmatter property participates; the managed
 * `citekey` field stays as template output and is left untouched.
 */
export function migrateV4ToV5(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  const { "citation.key-links-frontmatter-key": _retired, ...rest } = raw;
  return rest;
}
