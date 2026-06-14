import { isPlainObject } from "./classify";
import {
  defaults,
  resolveImgExcerptImport,
  type LogLevel,
  type Settings,
} from "./schema";

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
  /** When refreshing a note, rewrite existing annotation blocks (matched by block-id) instead of skipping them. Default: false. */
  updateAnnotBlock: boolean;
  /** When refreshing notes, overwrite content outside annotation blocks too (destructive). Default: false. */
  updateOverwrite: boolean;
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
  /** How PDF image-annotation excerpts are brought into the vault: "symlink" links to Zotero's cache, "copy" duplicates the file, false disables import. Default: "copy" on Windows, "symlink" elsewhere. */
  imgExcerptImport: false | "symlink" | "copy";
  /** Vault-relative folder where imported image excerpts are placed. Default: "ZtImgExcerpt". */
  imgExcerptPath: string;
}

/** v1's embedded default note-filename template, in the legacy `it.*` vocabulary. */
const V1_DEFAULT_FILENAME =
  "<%= it.citekey ?? it.DOI ?? it.title ?? it.key %>.md";

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

  if (isPlainObject(v0.template)) {
    if (typeof v0.template.folder === "string") {
      out["template.folder"] = v0.template.folder;
    }
    const templates = v0.template.templates;
    if (
      isPlainObject(templates) &&
      typeof templates.filename === "string" &&
      templates.filename !== V1_DEFAULT_FILENAME
    ) {
      // The v1 default used the `it.*` vocabulary, which the v2 default replaces
      // with `zt.*`. Drop the exact v1 default so the v2 default applies; carry
      // over any customized value untouched (a v1→v2 compat layer is deferred).
      out["template.filename"] = templates.filename;
    }
  }

  if (Array.isArray(v0.autoTrim) && v0.autoTrim.length === 2) {
    out["template.auto-trim-leading"] = v0.autoTrim[0];
    out["template.auto-trim-trailing"] = v0.autoTrim[1];
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
  ["updateAnnotBlock", "template.update-annot-block"],
  ["updateOverwrite", "template.update-overwrite"],
  ["autoPairEta", "template.auto-pair-eta"],
  ["autoRefresh", "zotero.auto-refresh"],
  ["citationLibrary", "zotero.citation-library"],
  ["imgExcerptImport", "img-excerpt.import"],
  ["imgExcerptPath", "img-excerpt.path"],
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

function dropLegacyDefaultValues(out: Record<string, unknown>): void {
  for (const key of Object.keys(out)) {
    const legacyDefault = getLegacyDefaultValue(key);
    if (legacyDefault === undefined) continue;
    if (Object.is(out[key], legacyDefault)) {
      delete out[key];
    }
  }
}

function getLegacyDefaultValue(key: string): unknown {
  if (key === "img-excerpt.import") return resolveImgExcerptImport(null);
  if (key === "log.level") return "info";
  if (!Object.hasOwn(defaults, key)) return undefined;
  return defaults[key as keyof Settings];
}
