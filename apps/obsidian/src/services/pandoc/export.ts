// The built-in export: one document read once, its Citations resolved
// in-process, its bibliography pulled live from Zotero, and that same read
// document rendered.
//
// Pandoc reads the document before anything is resolved, so what the export
// cites is what Pandoc itself found — one parser, not a second one that has to
// agree with it. Both Citation Syntaxes arrive as Citations of that document:
// a Literature Note wikilink through the sandbox filter, a literal
// `@citation-key` through Pandoc's own reader.
//
// All-or-nothing, like the CLI path: an unresolved Citation or an incomplete
// bibliography stops the export before citeproc runs, so an exported document
// never carries a silently incomplete bibliography.

import type { CslItemData } from "@zotlit/db";

import type { CitekeyResolution } from "@/services/citation-index/snapshot";

import type {
  BibliographyFailure,
  BibliographyItemRef,
  BibliographyResult,
  BibliographySource,
} from "./bibliography";
import type {
  CitationEngine,
  DocumentFormat,
  PreparedDocument,
} from "./engine";
import { PANDOC_RESOLVE_MAP_FILENAME, pandocSandboxFilter } from "./filter";
import { collectCitationLinks } from "./resolve";
import type { ResolveDocument } from "./resolve";

/** Named by {@link ExportFailure}, so one import covers a failure's whole shape. */
export { type BibliographySource } from "./bibliography";

export interface ExportRequest {
  /** The document being exported, as Obsidian's caches see it. */
  document: ResolveDocument;
  /** Its Markdown source, exactly as Pandoc reads it. */
  markdown: string;
  format: DocumentFormat;
  /** CSL style XML; the engine's embedded default style when omitted. */
  styleXml?: string;
  /**
   * Citation Locale to render in, which overrides the locale the style names.
   * Omitted leaves the style's own locale in charge.
   */
  locale?: string;
}

export interface ExportPorts {
  /**
   * Indexed Key of the Literature Note `linkpath` names, resolved from
   * `sourcePath`; `null` for a missing target or an ordinary note.
   */
  resolveIndexedKey: (linkpath: string, sourcePath: string) => string | null;
  /**
   * What a literal `@citation-key` names in the current Library Scope, read
   * through the same resolution snapshot every in-app surface reads, so an
   * export cites what Live Preview shows. `null` means no snapshot, which only
   * an unreadable Zotero database leaves behind.
   */
  resolveCitekey: (citekey: string) => CitekeyResolution | null;
  /**
   * Zotero library addresses of the cited Indexed Keys, read under one lease.
   * A key the database cannot place is absent; `null` means no read lease.
   */
  readItemRefs: (
    indexedKeys: readonly string[],
  ) => Promise<ReadonlyMap<string, BibliographyItemRef> | null>;
  /** Zotero data directory, named in the database failure. */
  dataDir: () => string;
  /** The bibliography source chain over the cited Items. */
  fetchBibliography: (
    refs: readonly BibliographyItemRef[],
  ) => Promise<BibliographyResult>;
  engine: Pick<CitationEngine, "prepareDocument" | "renderPrepared">;
}

/**
 * Why an export stopped, in the terms the user acts on: a note they wrote, a
 * setting they can turn on, an application they can start. Every arm names one
 * situation and one fix, so the UI seam renders one message per arm.
 */
export type ExportFailure =
  /** Links whose `#cite:` fragment names no Literature Note. */
  | { kind: "citation-intent"; linkpaths: string[] }
  /** The Zotero database could not be read. */
  | { kind: "database-unavailable"; dataDir: string }
  /** Citations no Zotero Item answers for, as the document writes them. */
  | { kind: "items-missing"; sources: string[] }
  /** Citations Better BibTeX holds no citation key for, as the document writes them. */
  | { kind: "citation-keys-missing"; sources: string[] }
  /** Literal citation keys naming no live Zotero Item in the Library Scope. */
  | { kind: "citation-keys-unknown"; citekeys: string[] }
  /** Literal citation keys several Zotero Items answer to. */
  | { kind: "citation-keys-ambiguous"; citekeys: string[] }
  /** Zotero's profile requests an undiscoverable automatic HTTP port. */
  | { kind: "zotero-port-automatic"; pref: string }
  /** Nothing answered on the active profile's Zotero HTTP port. */
  | { kind: "zotero-unreachable"; port: number }
  /** Zotero runs with its local API pref off. */
  | { kind: "local-api-disabled"; pref: string }
  /** The bibliography source answered, and refused. */
  | { kind: "source-failed"; source: BibliographySource; detail: string }
  /** Pandoc refused the conversion. */
  | { kind: "engine"; detail: string };

export type ExportResult = { output: Uint8Array } | { error: ExportFailure };

/**
 * Render one Obsidian document as a cited `docx` or `html` file.
 *
 * Pandoc reads the document first, with the sandbox filter turning every
 * Literature Note wikilink into a Citation that names its Item by an Injected
 * Id, which no literal citation key can spell.
 * What comes back is the document's complete Citation set — wikilinks and
 * literal `@citation-key` text alike — and every one of them is resolved to a
 * Zotero Item before citeproc runs.
 *
 * Each cited Item then takes one canonical CSL id: the citation key the author
 * wrote, where a literal Citation named it, and otherwise the id its
 * bibliography source gave it. The document's ids are rewritten onto it, so an
 * Item cited both ways collects one bibliography entry rather than two, and no
 * Citation depends on which source answered for its data.
 */
export async function exportCitedDocument(
  request: ExportRequest,
  ports: ExportPorts,
): Promise<ExportResult> {
  const { links, errors } = collectCitationLinks(
    request.document,
    ports.resolveIndexedKey,
  );
  if (errors.length > 0) {
    return {
      error: {
        kind: "citation-intent",
        // The only error this collection reports names its own link.
        linkpaths: errors.map((error) => error.linkpath!),
      },
    };
  }

  /** The Injected Id the filter cites each Literature Note wikilink by. */
  const wikilinked = new Map(
    links.map(({ linkpath, indexedKey }) => [linkpath, injectedId(indexedKey)]),
  );

  let prepared: PreparedDocument;
  try {
    prepared = await ports.engine.prepareDocument({
      markdown: request.markdown,
      luaFilters: [pandocSandboxFilter],
      files: {
        [PANDOC_RESOLVE_MAP_FILENAME]: JSON.stringify({
          citations: Object.fromEntries(wikilinked),
        }),
      },
    });
  } catch (error) {
    return { error: { kind: "engine", detail: describeError(error) } };
  }

  const spelled = readCitations(prepared.citedIds, wikilinked, ports);
  if ("error" in spelled) return spelled;

  const cited = await citeItems(spelled.itemsByKey(), spelled.describe, ports);
  if ("error" in cited) return cited;

  const canonical = spelled.canonicalIds(cited.items);
  const bibliography = [...cited.items].map(([indexedKey, item]) => ({
    ...item,
    id: canonical.byIndexedKey.get(indexedKey)!,
  }));
  const document = prepared.withCitedIds(canonical.bySpelling);

  // Every Citation of the rendered document has bibliography data, checked
  // against the document itself rather than against what selected the data.
  // Nothing above can leave a Citation uncovered, which is what makes this an
  // invariant rather than a path: it fails only if that stops being true.
  const covered = new Set(bibliography.map((item) => item.id));
  const uncovered = document.citedIds.filter((id) => !covered.has(id));
  if (uncovered.length > 0) {
    return {
      error: {
        kind: "engine",
        detail: `The bibliography covers no data for ${uncovered.join(", ")}`,
      },
    };
  }

  try {
    const output = await ports.engine.renderPrepared({
      document,
      format: request.format,
      bibliography,
      styleXml: request.styleXml,
      locale: request.locale,
    });
    return { output };
  } catch (error) {
    return { error: { kind: "engine", detail: describeError(error) } };
  }
}

/** One document's Citations, each placed on the Zotero Item it names. */
interface SpelledCitations {
  /** Every cited Item, as Indexed Keys. */
  itemsByKey: () => string[];
  /** One Item as the document writes it, for a failure that must name it. */
  describe: (indexedKey: string) => string;
  /** The canonical CSL id of each cited Item, and of each id the source spells. */
  canonicalIds: (items: ReadonlyMap<string, CslItemData>) => {
    byIndexedKey: ReadonlyMap<string, string>;
    bySpelling: ReadonlyMap<string, string>;
  };
}

/**
 * What the sandbox filter cites a wikilinked Item by.
 *
 * A Pandoc citation key starts with a letter, a digit, or an underscore, so
 * this prefix puts every Injected Id outside the space a literal
 * `@citation-key` can reach. One Item's Indexed Key can therefore never be read
 * as another Item's citation key, whatever either of them spells.
 */
function injectedId(indexedKey: string): string {
  return `#${indexedKey}`;
}

/**
 * Place every id the prepared document spells on a Zotero Item: an Injected Id
 * names its Item already, and anything else is a literal citation key for the
 * resolution snapshot to answer.
 *
 * A citation key the snapshot cannot place stops the export. The alternative
 * is Pandoc's own undefined-citation output — a bold key and a missing entry —
 * inside a document the user is about to send somewhere.
 */
function readCitations(
  citedIds: readonly string[],
  wikilinked: ReadonlyMap<string, string>,
  ports: ExportPorts,
): SpelledCitations | { error: ExportFailure } {
  /** Injected Id → the Indexed Key it names. */
  const injected = new Map(
    [...wikilinked.values()].map((id) => [id, id.slice(1)]),
  );
  /** Literal citation key → the Indexed Key it names. */
  const literal = new Map<string, string>();
  /** Cited Indexed Keys, first appearance first. */
  const cited = new Set<string>();
  const unknown: string[] = [];
  const ambiguous: string[] = [];

  for (const id of citedIds) {
    const wikilinkedKey = injected.get(id);
    if (wikilinkedKey !== undefined) {
      cited.add(wikilinkedKey);
      continue;
    }
    const resolution = ports.resolveCitekey(id);
    if (!resolution) {
      return {
        error: { kind: "database-unavailable", dataDir: ports.dataDir() },
      };
    }
    switch (resolution.kind) {
      case "missing":
        unknown.push(id);
        break;
      case "ambiguous":
        ambiguous.push(id);
        break;
      case "unique":
        literal.set(id, resolution.item.indexedKey);
        cited.add(resolution.item.indexedKey);
        break;
    }
  }
  if (unknown.length > 0) {
    return { error: { kind: "citation-keys-unknown", citekeys: unknown } };
  }
  if (ambiguous.length > 0) {
    return { error: { kind: "citation-keys-ambiguous", citekeys: ambiguous } };
  }

  /** The first citation key each Item is literally cited by, where one is. */
  const citekeyOf = new Map<string, string>();
  for (const [citekey, indexedKey] of literal) {
    if (!citekeyOf.has(indexedKey)) citekeyOf.set(indexedKey, citekey);
  }
  const linkpathOf = new Map<string, string>();
  for (const [linkpath, id] of wikilinked) {
    const indexedKey = injected.get(id)!;
    if (!linkpathOf.has(indexedKey)) linkpathOf.set(indexedKey, linkpath);
  }

  return {
    itemsByKey: () => [...cited],
    describe: (indexedKey) => {
      const citekey = citekeyOf.get(indexedKey);
      return citekey === undefined
        ? (linkpathOf.get(indexedKey) ?? indexedKey)
        : `@${citekey}`;
    },
    canonicalIds: (items) => {
      const byIndexedKey = new Map<string, string>();
      for (const [indexedKey, item] of items) {
        byIndexedKey.set(indexedKey, citekeyOf.get(indexedKey) ?? item.id);
      }
      const bySpelling = new Map<string, string>();
      for (const [spelling, indexedKey] of injected) {
        const id = byIndexedKey.get(indexedKey);
        if (id !== undefined) bySpelling.set(spelling, id);
      }
      for (const [citekey, indexedKey] of literal) {
        const id = byIndexedKey.get(indexedKey);
        if (id !== undefined) bySpelling.set(citekey, id);
      }
      return { byIndexedKey, bySpelling };
    },
  };
}

/**
 * The cited Items as CSL-JSON, keyed by Indexed Key. The database places each
 * Indexed Key in its Zotero library, which is the address Better BibTeX reads;
 * Zotero itself supplies the data.
 */
async function citeItems(
  indexedKeys: readonly string[],
  describe: (indexedKey: string) => string,
  ports: ExportPorts,
): Promise<
  { items: ReadonlyMap<string, CslItemData> } | { error: ExportFailure }
> {
  if (indexedKeys.length === 0) return { items: new Map() };

  const placed = await ports.readItemRefs(indexedKeys);
  if (!placed) {
    return {
      error: { kind: "database-unavailable", dataDir: ports.dataDir() },
    };
  }

  const unplaced: string[] = [];
  const refs: BibliographyItemRef[] = [];
  for (const indexedKey of indexedKeys) {
    const ref = placed.get(indexedKey);
    if (ref) refs.push(ref);
    else unplaced.push(describe(indexedKey));
  }
  if (unplaced.length > 0) {
    return { error: { kind: "items-missing", sources: unplaced } };
  }

  const bibliography = await ports.fetchBibliography(refs);
  return "error" in bibliography
    ? { error: toExportFailure(bibliography.error, describe) }
    : { items: bibliography.items };
}

/** Restates a source-chain failure in the export's own terms. */
function toExportFailure(
  failure: BibliographyFailure,
  describe: (indexedKey: string) => string,
): ExportFailure {
  switch (failure.code) {
    case "items-missing":
      return {
        kind: "items-missing",
        sources: failure.indexedKeys.map(describe),
      };
    case "citation-key-missing":
      return {
        kind: "citation-keys-missing",
        sources: failure.indexedKeys.map(describe),
      };
    case "zotero-port-automatic":
      return { kind: "zotero-port-automatic", pref: failure.pref };
    case "zotero-unreachable":
      return { kind: "zotero-unreachable", port: failure.port };
    case "local-api-disabled":
      return { kind: "local-api-disabled", pref: failure.pref };
    case "source-failed":
      return {
        kind: "source-failed",
        source: failure.source,
        detail: failure.detail,
      };
  }
}

/** The `detail` every failure arm carries, from whatever was thrown. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
