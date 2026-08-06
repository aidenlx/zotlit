// The reading-mode surface of the Citekey Editor Treatment: literal citekey citations show formatted in the reading view.

import {
  MarkdownView,
  type App,
  type MarkdownPostProcessorContext,
  type Plugin,
  type TFile,
} from "obsidian";

import {
  getItemsByKey,
  getZoteroIdentity,
  isChildItemFields,
  itemToCsl,
  resolveIndexedKeyLibrary,
  type CslItemData,
} from "@zotlit/db";

import { BoundedCache } from "@/lib/bounded-cache";
import { registerEvent } from "@/lib/disposables";
import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import {
  scanDocumentCitations,
  type Citation,
  type CitationIndex,
} from "@/services/citation-index/service";
import { type DatabaseService } from "@/services/database/service";
import { type BibliographyRenderCache } from "@/services/pandoc/render-cache";
import { Service } from "@/services/service-base";
import { type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";

import {
  citationElement,
  replaceCitations,
  sectionCitations,
  summarizeCitation,
} from "./render";

const logger = getLogger("citekey-reading");

/**
 * Documents whose citations are held at once. A reading view renders one
 * section at a time and each asks the same document again, so the bound only
 * keeps a session that visits many documents from growing without end.
 */
const HELD_DOCUMENTS = 8;

/** What one document's reading view needs to put text in its citations' place. */
interface DocumentCitations {
  /** The formatted citation of one source, for every source the engine rendered. */
  formatted: ReadonlyMap<string, DocumentFragment>;
  /** `Creators (Year)` by citekey, the text a citation falls back to. */
  summaries: ReadonlyMap<string, string>;
}

const NO_CITATIONS: DocumentCitations = {
  formatted: new Map(),
  summaries: new Map(),
};

export interface CitekeyReadingDeps {
  app: App;
  plugin: Pick<Plugin, "registerMarkdownPostProcessor">;
  db: Pick<DatabaseService, "state" | "client">;
  citationIndex: Pick<CitationIndex, "getCitations" | "on">;
  /** The plugin-wide render cache, which owns the References Style and the engine. */
  bibliographyRender: Pick<BibliographyRenderCache, "renderCitations" | "on">;
  settings: Pick<SettingsService, "ready" | "subscribe">;
}

/**
 * Renders literal citekey citations in reading mode, so a shared or published
 * view of a note shows formatted citations.
 *
 * A citation is formatted through the plugin-wide bibliography render cache,
 * which is also the sidebar's rendered-text source, so both surfaces agree on
 * the References Style and go stale together. With no engine installed the
 * citation keeps its own brackets, prefixes, and locators, and each key it
 * names shows the shared `Creators (Year)` item summary instead.
 *
 * A post-processor stays registered for the plugin's lifetime, so the toggles
 * are read per render rather than by adding and removing it.
 */
export class CitekeyReading extends Service<void> {
  readonly #app;
  readonly #plugin;
  readonly #db;
  readonly #citationIndex;
  readonly #bibliographyRender;
  readonly #settings;
  /** Citations by document path; every section of one document shares them. */
  readonly #documents = new BoundedCache<Promise<DocumentCitations>>(
    HELD_DOCUMENTS,
  );

  /** `undefined` until the first settings snapshot decides the treatment. */
  #enabled: boolean | undefined;

  ready: Promise<void>;

  constructor(deps: CitekeyReadingDeps) {
    super();
    this.#app = deps.app;
    this.#plugin = deps.plugin;
    this.#db = deps.db;
    this.#citationIndex = deps.citationIndex;
    this.#bibliographyRender = deps.bibliographyRender;
    this.#settings = deps.settings;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#settings.ready;

    this.#plugin.registerMarkdownPostProcessor((el, ctx) =>
      this.#process(el, ctx),
    );
    stack.defer(
      this.#settings.subscribe((settings) => {
        if (settings) this.#applySettings(settings);
      }),
    );
    // A document's own citekeys, and the frontmatter that resolves any of them
    // to a Literature Note, both decide what its citations say.
    stack.defer(
      this.#citationIndex.on("changed", (path) => this.#documents.delete(path)),
    );
    stack.use(
      registerEvent(
        this.#app.metadataCache.on("changed", () => this.#documents.clear()),
      ),
    );
    // What the cache holds is what the reading view shows, so its wholesale
    // drop is the one signal that makes formatted citations here stale.
    stack.defer(
      this.#bibliographyRender.on("invalidated", () => {
        this.#documents.clear();
        this.#rerenderReadingViews();
      }),
    );
    stack.defer(() => this.#documents.clear());

    this.commit(stack.move());
  }

  #applySettings(settings: Readonly<Settings>): void {
    // Citekey Indexing is the master switch for every literal-citekey surface,
    // so the treatment runs only while both it and the editor toggle are on.
    const enabled =
      settings["citation.citekey-indexing"] &&
      settings["citation.citekey-editor"];
    if (enabled === this.#enabled) return;
    const initial = this.#enabled === undefined;
    this.#enabled = enabled;
    logger.info(
      enabled ? "Citekey reading enabled" : "Citekey reading disabled",
    );
    if (initial) return;
    this.#documents.clear();
    this.#rerenderReadingViews();
  }

  /** Formats every citation of one rendered section. */
  async #process(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ): Promise<void> {
    if (this.#enabled !== true) return;
    const citations = sectionCitations(el);
    if (citations.length === 0) return;
    const file = this.#app.vault.getFileByPath(ctx.sourcePath);
    if (!file) return;

    const { formatted, summaries } = await this.#documentCitations(file);
    const doc = el.ownerDocument;
    replaceCitations(citations, (citation) => {
      const rendered = formatted.get(citation.source);
      if (rendered) return citationElement(doc, rendered.cloneNode(true));
      const summarized = summarizeCitation(citation, (citekey) =>
        summaries.get(citekey),
      );
      return summarized === null ? null : citationElement(doc, summarized);
    });
  }

  #documentCitations(file: TFile): Promise<DocumentCitations> {
    return this.#documents.hold(file.path, () =>
      this.#readDocument(file).catch((error: unknown) => {
        logger.warn("Cannot read the citations of a document", {
          path: file.path,
          error,
        });
        // A failed read is not an answer to hold: the next section tries again.
        this.#documents.delete(file.path);
        return NO_CITATIONS;
      }),
    );
  }

  /**
   * A style that numbers counts citations across the whole document, so every
   * citation the document writes goes to the render — not only the ones the
   * section being processed holds. A citation naming a key that reaches no
   * Zotero Item stays out: citeproc has nothing to format it from, and it falls
   * back to what the author wrote.
   */
  async #readDocument(file: TFile): Promise<DocumentCitations> {
    const cited = await this.#citationIndex.getCitations(file, {
      wikilinks: false,
    });
    const { items, summaries } = this.#readCited(cited);

    const body = await this.#app.vault.cachedRead(file);
    const sources = scanDocumentCitations(body)
      .filter((citation) =>
        citation.keys.every((key) => summaries.has(key.citekey)),
      )
      .map(({ start, end }) => body.slice(start, end));

    const rendered = await this.#bibliographyRender.renderCitations(
      sources,
      items,
    );
    const formatted = new Map<string, DocumentFragment>();
    // Identical sources render alike, so the first answer stands for them all.
    rendered?.forEach((fragment, index) => {
      const source = sources[index]!;
      if (!formatted.has(source)) formatted.set(source, fragment);
    });
    return { formatted, summaries };
  }

  /**
   * The cited works, read straight from the database so reading mode keeps
   * working while Zotero is closed.
   *
   * Citeproc matches a citation by the CSL `id`, so each work is handed over
   * under the citekey the document writes rather than under its item URI.
   */
  #readCited(cited: readonly Citation[]): {
    items: CslItemData[];
    summaries: Map<string, string>;
  } {
    const items: CslItemData[] = [];
    const summaries = new Map<string, string>();
    if (this.#db.state !== "ready" || cited.length === 0) {
      return { items, summaries };
    }

    try {
      const client = this.#db.client;
      const user = getZoteroIdentity(client);
      for (const { indexedKey, occurrences } of cited) {
        if (indexedKey === null) continue;
        const selector = resolveIndexedKeyLibrary(client, indexedKey);
        if (!selector) continue;
        const item = getItemsByKey(client, selector.libraryID, [
          selector.key,
        ])[0];
        if (!item) continue;
        const { fields } = item;
        if (isChildItemFields(fields)) continue;

        const { title, subtitle } = itemSummary(item, fields);
        const csl = itemToCsl(item, user);
        for (const { raw } of occurrences) {
          if (summaries.has(raw)) continue;
          summaries.set(raw, subtitle || title);
          items.push({ ...csl, id: raw });
        }
      }
    } catch (error) {
      logger.warn("Cannot read the cited items", { error });
    }
    return { items, summaries };
  }

  /** A reading view holds what a post-processor produced until it renders again. */
  #rerenderReadingViews(): void {
    for (const leaf of this.#app.workspace.getLeavesOfType("markdown")) {
      const { view } = leaf;
      if (view instanceof MarkdownView) view.previewMode.rerender(true);
    }
  }
}
