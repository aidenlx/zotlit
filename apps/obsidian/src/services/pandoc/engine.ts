// Bibliography and cited-document rendering, behind an interface that hides Pandoc.

import { sanitizeHTMLToDom } from "obsidian";

import type { CslItemData } from "@zotlit/db";

import { getLogger } from "@/lib/log";

import { createPandocRuntime } from "./runtime";
import type {
  PandocConvertResult,
  PandocOptions,
  PandocRuntime,
  VirtualFiles,
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
  /**
   * The Entry Marker the style rendered ahead of the entry — a citation number
   * in the style's own affixes — or `undefined` for a style that renders none.
   */
  marker: string | undefined;
  /**
   * The formatted entry text, without its wrapping element and without the
   * marker. Already sanitized and parsed, so a consumer inserts a clone instead
   * of re-parsing markup.
   */
  content: DocumentFragment;
}

export interface CitationRequest extends SupersedableRequest {
  /**
   * The citations to format, each as the source writes it — a bracketed
   * cluster or a bare author-in-text key, one line apiece. A style that numbers
   * counts them in this order, so a document hands over all of its own.
   */
  citations: readonly string[];
  /**
   * CSL-JSON the citekeys resolve against. Each `id` is the citekey the source
   * writes, which is what citeproc matches a citation by.
   */
  items: readonly CslItemData[];
  /** CSL style XML; the engine's embedded default style when omitted. */
  styleXml?: string;
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
  /** @returns one formatted citation per requested source, in the same order. */
  renderCitations(request: CitationRequest): Promise<DocumentFragment[]>;
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

  async renderCitations({
    citations,
    items,
    styleXml,
    supersedes,
  }: CitationRequest): Promise<DocumentFragment[]> {
    if (citations.length === 0) return [];
    const style = styleInput(styleXml);
    const { stdout } = await this.#convert({
      options: {
        from: MARKDOWN_READER,
        to: "html",
        standalone: false,
        filters: ["citeproc"],
        bibliography: [BIBLIOGRAPHY_FILE],
        // The bibliography is the sidebar's job; this render wants the in-text
        // citations alone.
        metadata: { "suppress-bibliography": true },
        wrap: "none",
        ...style.options,
      },
      stdin: citations.join("\n\n"),
      files: {
        [BIBLIOGRAPHY_FILE]: JSON.stringify(items),
        ...style.files,
      },
      supersedes,
    });
    return parseCitations(stdout, citations.length);
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
    if (supersedes !== undefined) {
      if (this.#claims.has(supersedes)) {
        logger.trace("Pandoc request superseded", { slot: supersedes });
      }
      this.#claims.set(supersedes, claim);
    }

    const result = this.#queue.then(() => {
      if (supersedes !== undefined) {
        if (this.#claims.get(supersedes) !== claim) {
          logger.trace("Pandoc request dropped", { slot: supersedes });
          throw new CitationRequestSupersededError(
            "A newer request superseded this one",
          );
        }
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

/**
 * Each requested citation is fed as a paragraph of its own, so Pandoc writes
 * one `<p>` per citation in the order they were asked for. The paragraph's own
 * children are the formatted citation — the style's affixes included — and they
 * are sanitized once here, so neither the style nor an item field can carry
 * active markup into the reading view.
 *
 * @throws {CitationEngineError} when the output does not answer every citation,
 *   which would silently misalign the answers with what was asked.
 */
function parseCitations(html: string, expected: number): DocumentFragment[] {
  const paragraphs = sanitizeHTMLToDom(html).querySelectorAll("p");
  if (paragraphs.length !== expected) {
    throw new CitationEngineError(
      `Pandoc formatted ${paragraphs.length} of ${expected} citations`,
    );
  }
  return [...paragraphs].map((paragraph) => {
    const content = createFragment();
    content.append(...paragraph.childNodes);
    return content;
  });
}

/** Pandoc prefixes every entry's `id` with this, over the CSL id of the item. */
const ENTRY_ID_PREFIX = "ref-";

/** The block a style's Entry Marker sits in, when the style renders one. */
const LEFT_MARGIN_CLASS = "csl-left-margin";

/**
 * The blocks a style lays the rest of an entry out in: the second column of a
 * flush layout, and the two `display` blocks a layout can wrap a part in.
 */
const ENTRY_BLOCK_CLASSES = ["csl-right-inline", "csl-block", "csl-indent"];

/**
 * Pandoc wraps every bibliography entry in `<div id="ref-ID" class="csl-entry">`
 * inside one `<div id="refs">`, and reports the entries in the style's own
 * bibliography order. Entry markup nests further elements, and a CSL id is a
 * Zotero URI long enough for Pandoc to wrap the opening tag, so the markup is
 * read as a DOM rather than matched as text.
 *
 * The entry keeps that parsed form: it is sanitized once here, so a style or an
 * item field cannot carry active markup into the sidebar, and the view inserts
 * it without a serialize-and-re-parse round trip.
 */
function parseBibliography(html: string): BibliographyEntry[] {
  const entries: BibliographyEntry[] = [];
  for (const entry of sanitizeHTMLToDom(html).querySelectorAll(".csl-entry")) {
    if (!entry.id.startsWith(ENTRY_ID_PREFIX)) continue;
    entries.push({
      id: entry.id.slice(ENTRY_ID_PREFIX.length),
      ...splitEntry(entry),
    });
  }
  return entries;
}

/**
 * Take the Entry Marker out of an entry and flatten what is left into one
 * inline flow.
 *
 * A style lays an entry out in blocks, and a block break would push whatever
 * the sidebar puts after the entry — its occurrence counter — onto its own
 * line. Each block hands its own children over instead, separated by one space
 * where the break used to be. A flush layout nests its blocks inside the column
 * beside the marker, so a block hands over what its own blocks hold. Line
 * breaks the markup itself carries between blocks are layout rather than text,
 * so they make that same single space.
 */
function splitEntry(
  entry: Element,
): Pick<BibliographyEntry, "marker" | "content"> {
  const content = createFragment();
  let marker: string | undefined;

  /** Moves one level of children over, and recurses through the blocks. */
  function flatten(parent: Node): void {
    /** A separator stands between what was emitted and whatever comes next. */
    let gap = false;
    // A copy, since appending a node to the flow takes it out of `parent` and
    // the live child list would shift the ones still to be read.
    const children = [...parent.childNodes];
    for (const node of children) {
      if (isWhitespace(node)) {
        gap = true;
        continue;
      }
      if (hasClass(node, LEFT_MARGIN_CLASS)) {
        marker ??= node.textContent?.trim() || undefined;
        gap = false;
        continue;
      }
      const block = ENTRY_BLOCK_CLASSES.some((name) => hasClass(node, name));
      if (content.hasChildNodes() && (gap || block)) content.append(" ");
      if (block) flatten(node);
      else content.append(node);
      gap = block;
    }
  }

  flatten(entry);
  return { marker, content };
}

function hasClass(node: Node, name: string): boolean {
  return node instanceof Element && node.classList.contains(name);
}

/** Text that carries no content of its own, so it reads as a separator. */
function isWhitespace(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && !node.textContent?.trim();
}
