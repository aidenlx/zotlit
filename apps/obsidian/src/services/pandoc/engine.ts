// Bibliography and cited-document rendering, behind an interface that hides Pandoc.

import type { CslItemData } from "@zotlit/db";

import { getLogger } from "@/lib/log";

import type {
  Blocks,
  CitationMode as AstCitationMode,
  Inline,
  Inlines,
  Pandoc,
} from "./ast";
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
  /**
   * Citation Locale to render in, which overrides the locale the style names.
   * Omitted leaves the style's own locale in charge.
   */
  locale?: string;
}

/** One rendered bibliography entry, as typed AST. */
export interface BibliographyEntry {
  /** CSL `id` of the item this entry renders. */
  readonly id: string;
  /**
   * The Entry Marker the style rendered ahead of the entry, without the space
   * that separates it from the entry text, or `undefined` for a style that
   * renders none.
   */
  readonly marker: Inlines | undefined;
  /** The formatted entry, without its wrapping element and without the marker. */
  readonly content: Inlines;
}

/** How a citation names one of the works it cites. */
export type CitationMode = "normal" | "author-in-text" | "suppress-author";

/** One work a rendered citation names, in the order the citation names it. */
export interface CitedWork {
  /**
   * The CSL id the source cites the work by. It is a citekey spelling, so it
   * repeats across citations and never identifies a citation on its own.
   */
  readonly id: string;
  readonly mode: CitationMode;
}

/** One rendered in-text citation, as typed AST. */
export interface RenderedCitation {
  /** The formatted citation wholesale, the style's own affixes included. */
  readonly content: Inlines;
  readonly citations: readonly CitedWork[];
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
  /**
   * Citation Locale to render in, which overrides the locale the style names.
   * Omitted leaves the style's own locale in charge.
   */
  locale?: string;
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
  /**
   * Citation Locale citeproc renders in, which overrides the locale the style
   * names. Omitted leaves the style's own locale in charge. It never becomes
   * the converted document's own language: a document that declares `lang`
   * keeps it, and one that declares none acquires none.
   */
  locale?: string;
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
  /**
   * The whole bibliography as typed AST, which a consumer holds and shares as a
   * value instead of copying it into place.
   */
  renderBibliography(
    request: BibliographyRequest,
  ): Promise<readonly BibliographyEntry[]>;
  /**
   * The citations as typed AST, each paired with the works it names.
   *
   * @returns one rendered citation per requested source, in the same order.
   */
  renderCitations(
    request: CitationRequest,
  ): Promise<readonly RenderedCitation[]>;
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

  async renderBibliography(
    request: BibliographyRequest,
  ): Promise<readonly BibliographyEntry[]> {
    return extractBibliography(
      parseAst(await this.#formatBibliography(request)),
    );
  }

  async renderCitations(
    request: CitationRequest,
  ): Promise<readonly RenderedCitation[]> {
    if (request.citations.length === 0) return [];
    return extractCitations(
      parseAst(await this.#formatCitations(request)),
      request.citations.length,
    );
  }

  /** @returns Pandoc's JSON output for the whole bibliography of `items`. */
  async #formatBibliography({
    items,
    styleXml,
    locale,
    supersedes,
  }: BibliographyRequest): Promise<string> {
    const style = styleInput(styleXml);
    const { stdout } = await this.#convert({
      options: {
        from: "csljson",
        to: "json",
        standalone: false,
        filters: ["citeproc"],
        ...(locale === undefined ? {} : { metadata: { lang: locale } }),
        ...style.options,
      },
      stdin: JSON.stringify(items),
      files: style.files,
      supersedes,
    });
    return stdout;
  }

  /** @returns Pandoc's JSON output for every citation the request names. */
  async #formatCitations({
    citations,
    items,
    styleXml,
    locale,
    supersedes,
  }: CitationRequest): Promise<string> {
    const style = styleInput(styleXml);
    const { stdout } = await this.#convert({
      options: {
        from: MARKDOWN_READER,
        to: "json",
        standalone: false,
        filters: ["citeproc"],
        bibliography: [BIBLIOGRAPHY_FILE],
        // The bibliography is the sidebar's job; this render wants the in-text
        // citations alone.
        metadata: {
          "suppress-bibliography": true,
          ...(locale === undefined ? {} : { lang: locale }),
        },
        ...style.options,
      },
      stdin: citations.join("\n\n"),
      files: {
        [BIBLIOGRAPHY_FILE]: JSON.stringify(items),
        ...style.files,
      },
      supersedes,
    });
    return stdout;
  }

  async renderDocument({
    markdown,
    format,
    bibliography,
    styleXml,
    locale,
    luaFilters = [],
    files = {},
    supersedes,
  }: DocumentRequest): Promise<Uint8Array> {
    const filterFiles = Object.fromEntries(
      luaFilters.map((source, index) => [`filter-${index}.lua`, source]),
    );
    const outputName = `output.${format}`;
    const style = styleInput(styleXml);
    const localePass = locale === undefined ? [] : [LOCALE_FILTER_FILE];
    const { outputFile } = await this.#convert({
      options: {
        from: MARKDOWN_READER,
        to: format,
        standalone: true,
        filters: [
          ...Object.keys(filterFiles),
          ...localePass,
          "citeproc",
          ...localePass,
        ],
        bibliography: [BIBLIOGRAPHY_FILE],
        "output-file": outputName,
        ...style.options,
      },
      stdin: markdown,
      files: {
        ...files,
        ...filterFiles,
        ...(locale === undefined
          ? {}
          : { [LOCALE_FILTER_FILE]: citationLocaleFilter(locale) }),
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

const LOCALE_FILTER_FILE = "citation-locale.lua";

/**
 * The Citation Locale, applied to citation processing alone. Pandoc reads a
 * locale from `lang`, which is also the document's own language, so this filter
 * runs on both sides of citeproc: it lends `lang` to a document that declares
 * none, and takes its own loan back once citeproc has read it. A document that
 * declares `lang` is left as it is, and citeproc renders in the locale it names.
 *
 * The marker travels through the metadata, which is the only state one filter
 * pass leaves for the next. Its name carries a token drawn for this conversion
 * alone, so it names a loan this filter made and nothing a document wrote: a
 * note that declares the plain key keeps its own `lang` and its own key.
 */
function citationLocaleFilter(locale: string): string {
  const marker = `zotlit-citation-locale-${crypto.randomUUID()}`;
  return `local MARKER = ${JSON.stringify(marker)}

function Meta(meta)
  if meta[MARKER] then
    meta.lang = nil
    meta[MARKER] = nil
  elseif not meta.lang then
    meta.lang = pandoc.MetaString(${JSON.stringify(locale)})
    meta[MARKER] = true
  end
  return meta
end
`;
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

/** The span a style's Entry Marker sits in, when the style renders one. */
const LEFT_MARGIN_CLASS = "csl-left-margin";

/**
 * The document envelope stops here: the engine hands over domain shapes, so no
 * consumer ever holds a {@link Pandoc}.
 */
function parseAst(stdout: string): Blocks {
  return (JSON.parse(stdout) as Pandoc).blocks;
}

const CITATION_MODES = {
  NormalCitation: "normal",
  AuthorInText: "author-in-text",
  SuppressAuthor: "suppress-author",
} as const satisfies Record<AstCitationMode["t"], CitationMode>;

/**
 * Each requested citation is fed as a paragraph of its own, so Pandoc answers
 * with one paragraph per citation in the order they were asked for. That
 * position is the join: a `citationId` is a citekey spelling, which repeats
 * across citations and names no one of them.
 *
 * @throws {CitationEngineError} when the output does not answer every citation,
 *   which would silently misalign the answers with what was asked.
 */
function extractCitations(
  blocks: Blocks,
  expected: number,
): RenderedCitation[] {
  const paragraphs = blocks.flatMap((block) =>
    block.t === "Para" || block.t === "Plain" ? [block.c] : [],
  );
  if (paragraphs.length !== expected) {
    throw new CitationEngineError(
      `Pandoc formatted ${paragraphs.length} of ${expected} citations`,
    );
  }
  return paragraphs.map((content) => ({
    content,
    citations: collectCitations(content, []),
  }));
}

/**
 * The prefix, suffix, note number, and hash a `Citation` carries are left
 * behind: the first two are already rendered into the citation's own content,
 * and the other two name Pandoc's bookkeeping rather than the cited work.
 */
function collectCitations(inlines: Inlines, into: CitedWork[]): CitedWork[] {
  for (const inline of inlines) {
    if (inline.t === "Cite") {
      for (const { citationId, citationMode } of inline.c[0]) {
        into.push({ id: citationId, mode: CITATION_MODES[citationMode.t] });
      }
    }
    collectCitations(nestedInlines(inline), into);
  }
  return into;
}

/** The inlines a constructor carries, so the walk reaches every citation. */
function nestedInlines(inline: Inline): Inlines {
  switch (inline.t) {
    case "Emph":
    case "Underline":
    case "Strong":
    case "Strikeout":
    case "Superscript":
    case "Subscript":
    case "SmallCaps":
      return inline.c;
    case "Quoted":
    case "Cite":
    case "Link":
    case "Image":
    case "Span":
      return inline.c[1];
    case "Note":
      return blockInlines(inline.c);
    default:
      return [];
  }
}

/**
 * Pandoc wraps every bibliography entry in a `Div` whose id is the CSL id of
 * the item behind {@link ENTRY_ID_PREFIX}, inside one `refs` Div, and reports
 * the entries in the style's own bibliography order. The outer Div's layout
 * attributes stay behind until a caller asks for them.
 */
function extractBibliography(blocks: Blocks): BibliographyEntry[] {
  return blocks.flatMap((block) => {
    if (block.t !== "Div") return [];
    const [[id], nested] = block.c;
    if (!id.startsWith(ENTRY_ID_PREFIX)) return extractBibliography(nested);
    return {
      id: id.slice(ENTRY_ID_PREFIX.length),
      ...splitEntry(blockInlines(nested)),
    };
  });
}

/**
 * Take the Entry Marker off the front of an entry. A flush layout opens the
 * entry with the left-margin span, which holds the marker and the space that
 * sets the second column off from it — the space is layout, not marker. Every
 * other `csl-*` span passes through, since how they lay an entry out is the
 * renderer's policy.
 */
function splitEntry(
  inlines: Inlines,
): Pick<BibliographyEntry, "marker" | "content"> {
  const [first, ...rest] = inlines;
  if (first?.t !== "Span" || !first.c[0][1].includes(LEFT_MARGIN_CLASS)) {
    return { marker: undefined, content: inlines };
  }
  const marker = dropTrailingSpace(first.c[1]);
  return { marker: marker.length > 0 ? marker : undefined, content: rest };
}

function dropTrailingSpace(inlines: Inlines): Inlines {
  return inlines.at(-1)?.t === "Space" ? inlines.slice(0, -1) : inlines;
}

/** Unwraps the block envelopes an entry is laid out in, so only inlines leave. */
function blockInlines(blocks: Blocks): Inlines {
  return blocks.flatMap((block) => {
    if (block.t === "Para" || block.t === "Plain") return block.c;
    logger.debug("Dropped a block the engine cannot unwrap", {
      block: block.t,
    });
    return [];
  });
}
