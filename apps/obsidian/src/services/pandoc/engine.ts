// Bibliography and cited-document rendering, behind an interface that hides Pandoc.

import { sanitizeHTMLToDom } from "obsidian";

import { type CslItemData } from "@zotlit/db";

import { getLogger } from "@/lib/log";

import {
  createPandocRuntime,
  type PandocConvertResult,
  type PandocOptions,
  type PandocRuntime,
  type VirtualFiles,
} from "./runtime";

const logger = getLogger("pandoc");

interface SupersedableRequest {
  /**
   * Names the slot this request occupies. A later request naming the same slot
   * supersedes this one while it still waits behind a running conversion, and
   * the superseded call rejects with {@link CitationRequestSupersededError}.
   * A request without a slot always runs.
   */
  supersedes?: string;
}

export interface BibliographyRequest extends SupersedableRequest {
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

export interface DocumentRequest extends SupersedableRequest {
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
 * coordinating. A request that names a `supersedes` slot drops any request still
 * waiting in that slot, so a consumer that re-renders on every change keeps only
 * its newest request. Disposal waits for the running request and refuses later
 * ones.
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

/** A pending request dropped in favor of a newer one for the same slot. */
export class CitationRequestSupersededError extends Error {
  override name = "CitationRequestSupersededError";
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

/** One conversion as the queue carries it. */
interface ConversionRequest extends SupersedableRequest {
  options: PandocOptions;
  stdin: string;
  files: VirtualFiles;
}

class PandocCitationEngine implements CitationEngine {
  #runtime: PandocRuntime | undefined;
  /** Tail of the request queue; resolves once nothing is using the filesystem. */
  #queue: Promise<unknown> = Promise.resolve();
  /** Newest claim per slot; a claim leaves the map once its request starts. */
  readonly #claims = new Map<string, object>();

  constructor(runtime: PandocRuntime) {
    this.#runtime = runtime;
  }

  async renderBibliography({
    items,
    styleXml,
    supersedes,
  }: BibliographyRequest): Promise<BibliographyEntry[]> {
    const style = styleInput(styleXml);
    const { stdout } = await this.#convert({
      options: {
        from: "csljson",
        to: "html",
        standalone: false,
        filters: ["citeproc"],
        // Entry markup is stored and re-inserted as HTML, so single-line output
        // keeps it free of the line breaks Pandoc's wrapping would introduce.
        wrap: "none",
        ...style.options,
      },
      stdin: JSON.stringify(items),
      files: style.files,
      supersedes,
    });
    return parseBibliography(stdout);
  }

  async renderDocument({
    markdown,
    format,
    bibliography,
    styleXml,
    luaFilters = [],
    files = {},
    supersedes,
  }: DocumentRequest): Promise<Uint8Array> {
    const filterFiles = Object.fromEntries(
      luaFilters.map((source, index) => [`filter-${index}.lua`, source]),
    );
    const outputName = `output.${format}`;
    const style = styleInput(styleXml);
    const { outputFile } = await this.#convert({
      options: {
        from: MARKDOWN_READER,
        to: format,
        standalone: true,
        filters: [...Object.keys(filterFiles), "citeproc"],
        bibliography: [BIBLIOGRAPHY_FILE],
        "output-file": outputName,
        ...style.options,
      },
      stdin: markdown,
      files: {
        ...files,
        ...filterFiles,
        [BIBLIOGRAPHY_FILE]: JSON.stringify(bibliography),
        ...style.files,
      },
      supersedes,
    });
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
   * conversions ever share the runtime's virtual filesystem. A request holds its
   * slot only while it waits, so the conversion at the front of the queue always
   * runs to completion.
   *
   * @throws {CitationRequestSupersededError} when a later request claimed the
   * same slot first.
   */
  #convert({
    options,
    stdin,
    files,
    supersedes,
  }: ConversionRequest): Promise<PandocConvertResult> {
    const claim = {};
    if (supersedes !== undefined) this.#claims.set(supersedes, claim);

    const result = this.#queue.then(() => {
      if (supersedes !== undefined) {
        if (this.#claims.get(supersedes) !== claim)
          throw new CitationRequestSupersededError(
            "A newer request superseded this one",
          );
        this.#claims.delete(supersedes);
      }
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

/** The `csl` option and the file it names; both empty for the embedded style. */
function styleInput(styleXml: string | undefined): {
  options: PandocOptions;
  files: VirtualFiles;
} {
  return styleXml === undefined
    ? { options: {}, files: {} }
    : { options: { csl: STYLE_FILE }, files: { [STYLE_FILE]: styleXml } };
}

/** Pandoc prefixes every entry's `id` with this, over the CSL id of the item. */
const ENTRY_ID_PREFIX = "ref-";

/**
 * Pandoc wraps every bibliography entry in `<div id="ref-ID" class="csl-entry">`
 * inside one `<div id="refs">`. Entry markup nests further elements, and a CSL
 * id is a Zotero URI long enough for Pandoc to wrap the opening tag, so the
 * markup is read as a DOM rather than matched as text.
 *
 * Sanitizing here also means a style or an item field cannot carry active
 * markup into the entries the sidebar stores.
 */
function parseBibliography(html: string): BibliographyEntry[] {
  const entries: BibliographyEntry[] = [];
  for (const entry of sanitizeHTMLToDom(html).querySelectorAll(".csl-entry")) {
    if (!entry.id.startsWith(ENTRY_ID_PREFIX)) continue;
    entries.push({
      id: entry.id.slice(ENTRY_ID_PREFIX.length),
      html: entry.innerHTML,
    });
  }
  return entries;
}
