// Bibliography and cited-document rendering, behind an interface that hides Pandoc.

import { regex } from "arkregex";

import { type CslItemData } from "@zotlit/db";

import { getLogger } from "@/lib/log";

import {
  createPandocRuntime,
  type PandocConvertResult,
  type PandocRuntime,
  type VirtualFiles,
} from "./runtime";

const logger = getLogger("pandoc");

export interface BibliographyRequest {
  items: readonly CslItemData[];
  /** CSL style XML; the engine's embedded default style when omitted. */
  styleXml?: string;
}

export interface BibliographyEntry {
  /** CSL `id` of the item this entry renders. */
  id: string;
  /** The formatted entry as an HTML fragment, without its wrapping element. */
  html: string;
}

export type DocumentFormat = "docx" | "html";

export interface DocumentRequest {
  /** Obsidian-flavored Markdown of the document to convert. */
  markdown: string;
  format: DocumentFormat;
  /** CSL-JSON the citations in `markdown` resolve against. */
  bibliography: readonly CslItemData[];
  /** CSL style XML; the engine's embedded default style when omitted. */
  styleXml?: string;
  /** Lua filter sources, run in listed order before citation processing. */
  luaFilters?: readonly string[];
  /** Further files the filters read, such as a resolve map. */
  files?: VirtualFiles;
}

/**
 * Renders CSL bibliographies and cited documents.
 *
 * Requests on one engine run one at a time, so callers share an engine without
 * coordinating. Disposal waits for the running request and refuses later ones.
 */
export interface CitationEngine extends AsyncDisposable {
  renderBibliography(
    request: BibliographyRequest,
  ): Promise<BibliographyEntry[]>;
  renderDocument(request: DocumentRequest): Promise<Uint8Array>;
}

/** A conversion the engine could not complete. `message` is Pandoc's own text. */
export class CitationEngineError extends Error {
  override name = "CitationEngineError";
}

/**
 * Wikilinks reach the Lua filter as Links only under this reader extension,
 * which is also what the bundled `zotlit.yaml` selects for the native CLI.
 */
const MARKDOWN_READER = "markdown+wikilinks_title_after_pipe";

const STYLE_FILE = "style.csl";
const BIBLIOGRAPHY_FILE = "bibliography.json";

/**
 * Instantiate one engine over the Pandoc WASM binary.
 *
 * @param wasmBinary the verified `pandoc.wasm` bytes.
 */
export async function createCitationEngine(
  wasmBinary: BufferSource,
): Promise<CitationEngine> {
  return new PandocCitationEngine(await createPandocRuntime(wasmBinary));
}

class PandocCitationEngine implements CitationEngine {
  #runtime: PandocRuntime | undefined;
  /** Tail of the request queue; resolves once nothing is using the filesystem. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(runtime: PandocRuntime) {
    this.#runtime = runtime;
  }

  async renderBibliography({
    items,
    styleXml,
  }: BibliographyRequest): Promise<BibliographyEntry[]> {
    const { stdout } = await this.#convert(
      {
        from: "csljson",
        to: "html",
        standalone: false,
        filters: ["citeproc"],
        ...styleOption(styleXml),
      },
      JSON.stringify(items),
      styleFile(styleXml),
    );
    return parseBibliography(stdout);
  }

  async renderDocument({
    markdown,
    format,
    bibliography,
    styleXml,
    luaFilters = [],
    files = {},
  }: DocumentRequest): Promise<Uint8Array> {
    const filterFiles = Object.fromEntries(
      luaFilters.map((source, index) => [`filter-${index}.lua`, source]),
    );
    const outputName = `output.${format}`;
    const { outputFile } = await this.#convert(
      {
        from: MARKDOWN_READER,
        to: format,
        standalone: true,
        filters: [...Object.keys(filterFiles), "citeproc"],
        bibliography: [BIBLIOGRAPHY_FILE],
        "output-file": outputName,
        ...styleOption(styleXml),
      },
      markdown,
      {
        ...files,
        ...filterFiles,
        [BIBLIOGRAPHY_FILE]: JSON.stringify(bibliography),
        ...styleFile(styleXml),
      },
    );
    if (!outputFile) {
      throw new CitationEngineError(`Pandoc wrote no ${format} output`);
    }
    return outputFile;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#runtime = undefined;
    await this.#queue;
  }

  /**
   * Run one conversion once the queue ahead of it has drained, so no two
   * conversions ever share the runtime's virtual filesystem.
   */
  #convert(
    options: Record<string, unknown>,
    stdin: string,
    files: VirtualFiles,
  ): Promise<PandocConvertResult> {
    const result = this.#queue.then(() => {
      const runtime = this.#runtime;
      if (!runtime) throw new CitationEngineError("The engine is disposed");

      const converted = runtime.convert(options, stdin, files);
      if (converted.stderr)
        throw new CitationEngineError(converted.stderr.trim());
      logger.debug("Pandoc conversion finished", {
        messages: converted.messages,
      });
      return converted;
    });
    this.#queue = result.catch(() => undefined);
    return result;
  }
}

function styleOption(styleXml: string | undefined): Record<string, unknown> {
  return styleXml === undefined ? {} : { csl: STYLE_FILE };
}

function styleFile(styleXml: string | undefined): VirtualFiles {
  return styleXml === undefined ? {} : { [STYLE_FILE]: styleXml };
}

/**
 * Pandoc wraps every bibliography entry in `<div id="ref-ID" class="csl-entry">`
 * inside one `<div id="refs">`. Entry markup can nest further divs, so an entry
 * runs to the next entry's opening tag — or, for the last one, to the closing
 * tag of the wrapper — rather than to the next `</div>`.
 */
function parseBibliography(html: string): BibliographyEntry[] {
  const entryOpen = regex(
    `<div id="ref-(?<id>[^"]*)" class="csl-entry"[^>]*>`,
    "g",
  );
  const entries: BibliographyEntry[] = [];

  let open = entryOpen.exec(html);
  while (open !== null) {
    const { id } = open.groups;
    const start = open.index + open[0].length;
    open = entryOpen.exec(html);
    const end = open?.index ?? html.lastIndexOf("</div>");
    entries.push({ id, html: closeEntry(html.slice(start, end)) });
  }
  return entries;
}

function closeEntry(entry: string): string {
  const trimmed = entry.trim();
  return trimmed.endsWith("</div>")
    ? trimmed.slice(0, -"</div>".length).trim()
    : trimmed;
}
