// The built-in export: one document's Citations resolved in-process, its
// bibliography pulled live from Zotero, and both handed to the engine.
//
// All-or-nothing, like the CLI path: an unresolved Citation or an incomplete
// bibliography stops the export before Pandoc runs, so an exported document
// never carries a silently incomplete bibliography.

import type { CslItemData } from "@zotlit/db";

import type {
  BibliographyFailure,
  BibliographyItemRef,
  BibliographyResult,
  BibliographySource,
} from "./bibliography";
import type { CitationEngine, DocumentFormat } from "./engine";
import { PANDOC_RESOLVE_MAP_FILENAME, pandocSandboxFilter } from "./filter";
import { collectCitationLinks } from "./resolve";
import type { CitationLink, ResolveDocument } from "./resolve";

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
  engine: Pick<CitationEngine, "renderDocument">;
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
  /** Cited Literature Notes no Zotero Item answers for. */
  | { kind: "items-missing"; linkpaths: string[] }
  /** Cited Literature Notes Better BibTeX holds no citation key for. */
  | { kind: "citation-keys-missing"; linkpaths: string[] }
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
 * Every Literature Note wikilink cites the CSL `id` its Item carries — the
 * native citation key when populated, the item URI otherwise — so wikilink
 * Citations need no citation-key setup. That linkpath-to-`id` map reaches the
 * sandbox filter as a virtual file, which is how the WASM engine resolves
 * Citations with no system command of its own. Literal `@citation-key` text
 * resolves against the same bibliography, so it needs a populated key.
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

  const cited = await citeItems(links, ports);
  if ("error" in cited) return cited;

  const citations: Record<string, string> = {};
  for (const { linkpath, indexedKey } of links) {
    // The source chain answers for every Item it was asked about, or fails.
    citations[linkpath] = cited.items.get(indexedKey)!.id;
  }

  try {
    const output = await ports.engine.renderDocument({
      markdown: request.markdown,
      format: request.format,
      bibliography: [...cited.items.values()],
      styleXml: request.styleXml,
      locale: request.locale,
      luaFilters: [pandocSandboxFilter],
      files: {
        [PANDOC_RESOLVE_MAP_FILENAME]: JSON.stringify({ citations }),
      },
    });
    return { output };
  } catch (error) {
    return { error: { kind: "engine", detail: describeError(error) } };
  }
}

/**
 * The cited Items as CSL-JSON, keyed by Indexed Key. The database places each
 * Indexed Key in its Zotero library, which is the address Better BibTeX reads;
 * Zotero itself supplies the data.
 */
async function citeItems(
  links: readonly CitationLink[],
  ports: ExportPorts,
): Promise<
  { items: ReadonlyMap<string, CslItemData> } | { error: ExportFailure }
> {
  if (links.length === 0) return { items: new Map() };

  const placed = await ports.readItemRefs(links.map((link) => link.indexedKey));
  if (!placed) {
    return {
      error: { kind: "database-unavailable", dataDir: ports.dataDir() },
    };
  }

  const unplaced: string[] = [];
  const refs: BibliographyItemRef[] = [];
  for (const { linkpath, indexedKey } of links) {
    const ref = placed.get(indexedKey);
    if (ref) refs.push(ref);
    else unplaced.push(linkpath);
  }
  if (unplaced.length > 0) {
    return { error: { kind: "items-missing", linkpaths: unplaced } };
  }

  const bibliography = await ports.fetchBibliography(refs);
  return "error" in bibliography
    ? { error: toExportFailure(bibliography.error, links) }
    : { items: bibliography.items };
}

/** Restates a source-chain failure in the export's own terms. */
function toExportFailure(
  failure: BibliographyFailure,
  links: readonly CitationLink[],
): ExportFailure {
  switch (failure.code) {
    case "items-missing":
      return {
        kind: "items-missing",
        linkpaths: named(failure.indexedKeys, links),
      };
    case "citation-key-missing":
      return {
        kind: "citation-keys-missing",
        linkpaths: named(failure.indexedKeys, links),
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

/** Indexed Keys back as the linkpaths the user wrote. */
function named(
  indexedKeys: readonly string[],
  links: readonly CitationLink[],
): string[] {
  const wanted = new Set(indexedKeys);
  return links
    .filter((link) => wanted.has(link.indexedKey))
    .map((link) => link.linkpath);
}

/** The `detail` every failure arm carries, from whatever was thrown. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
