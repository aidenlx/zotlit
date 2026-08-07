// The reading-mode surface of the Citekey Editor Treatment: literal citekey citations show formatted in the reading view, and navigate like links.

import {
  MarkdownView,
  Menu,
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
import { type CitekeyEditor } from "@/services/citekey-editor/service";
import {
  mouseGesture,
  navigationIntent,
  triggerCitekeyHover,
} from "@/services/citekey-navigation";
import { type DatabaseService } from "@/services/database/service";
import { type BibliographyRenderCache } from "@/services/pandoc/render-cache";
import { Service } from "@/services/service-base";
import { type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";

import {
  citationElement,
  citationTarget,
  citedWorks,
  replaceCitations,
  sectionCitations,
  summarizeCitation,
  type CitedWork,
} from "./render";
import "./style.css";

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

/** One citation as the reading view now holds it, for its handlers to read. */
interface RenderedCitation {
  element: HTMLElement;
  works: readonly CitedWork[];
  /** The path of the note the citation is written in. */
  sourcePath: string;
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
  /** The open-or-create flow and the hover resolution every citekey surface shares. */
  citekeyEditor: Pick<CitekeyEditor, "openCitekey" | "hoverNotePath">;
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
 * A rendered citation is also a click target carrying Citekey Navigation: the
 * one work it names opens on click, several works open a menu at the cursor,
 * and hover previews the Literature Note of a single resolved key. A citation
 * none of whose keys reaches a Zotero Item stays raw source text and inert.
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
  readonly #citekeyEditor;
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
    this.#citekeyEditor = deps.citekeyEditor;
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
    // A rendered citation carries this service's own click and hover handlers,
    // so the reading views render again without it once it is gone. The flag
    // goes first: the post-processor may still be registered while this runs.
    stack.defer(() => {
      this.#enabled = false;
      this.#documents.clear();
      this.#rerenderReadingViews();
    });

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

  /** Formats every citation of one rendered section and makes it navigate. */
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
    const summaryOf = (citekey: string): string | undefined =>
      summaries.get(citekey);
    const doc = el.ownerDocument;
    replaceCitations(citations, (citation) => {
      const rendered = formatted.get(citation.source);
      const content =
        rendered?.cloneNode(true) ?? summarizeCitation(citation, summaryOf);
      // A citation none of whose keys reaches a Zotero Item has nothing to
      // show and nothing to open: its source stays as written, and inert.
      if (content === null) return null;
      const element = citationElement(doc, content);
      this.#makeInteractive({
        element,
        works: citedWorks(citation, summaryOf),
        sourcePath: ctx.sourcePath,
      });
      return element;
    });
  }

  /**
   * Gives one rendered citation the click and hover of an internal link.
   *
   * The listeners sit on the citation's own element, so they go with it when
   * the reading view renders that section again.
   */
  #makeInteractive(citation: RenderedCitation): void {
    const { element, works } = citation;
    element.addEventListener("click", (event) => {
      if (event.button === 0) this.#navigate(event, works);
    });
    // Obsidian reads middle-click off `mousedown`; `click` never fires for it.
    element.addEventListener("mousedown", (event) => {
      if (event.button === 1) this.#navigate(event, works);
    });
    element.addEventListener("mouseover", (event) => {
      this.#preview(event, citation);
    });
  }

  /**
   * Opens the work a rendered citation names, or asks which when it names
   * several. Every branch runs the citekey editor's open-or-create flow, so a
   * missing Literature Note is handled the way it is everywhere else.
   */
  #navigate(event: MouseEvent, works: readonly CitedWork[]): void {
    const intent = navigationIntent(
      mouseGesture(event, "click", { surface: "reading" }),
      citationTarget(works),
    );
    if (intent.kind === "open") {
      event.preventDefault();
      logger.debug("Rendered citation opens note", {
        citekey: intent.citekey,
        pane: intent.pane,
      });
      void this.#citekeyEditor.openCitekey(intent.citekey, intent.pane);
      return;
    }
    if (intent.kind !== "show-citation-menu") {
      logger.debug("Rendered citation click not followed", {
        works: works.length,
        intent: intent.kind,
      });
      return;
    }
    event.preventDefault();

    logger.debug("Rendered citation offers its works", {
      works: works.length,
      pane: intent.pane,
    });
    const menu = new Menu();
    for (const work of works) {
      menu.addItem((item) =>
        item.setTitle(work.label).onClick(() => {
          void this.#citekeyEditor.openCitekey(work.citekey, intent.pane);
        }),
      );
    }
    menu.showAtMouseEvent(event);
  }

  /**
   * Previews the Literature Note a rendered citation names.
   *
   * A citation naming several works reaches the intent module as an unavailable
   * target and previews nothing, so no popover path can create a file.
   */
  #preview(event: MouseEvent, citation: RenderedCitation): void {
    const { element, works, sourcePath } = citation;
    // The same re-entry guard Obsidian runs before its own `hover-link`, so
    // moving within one citation fires a single hover.
    const { relatedTarget } = event;
    if (relatedTarget instanceof Node && element.contains(relatedTarget))
      return;

    const single = works.length === 1 ? works[0]!.citekey : null;
    const notePath =
      single === null ? null : this.#citekeyEditor.hoverNotePath(single);
    const intent = navigationIntent(
      mouseGesture(event, "hover", { surface: "reading" }),
      notePath === null || single === null
        ? { resolution: "unavailable" }
        : { resolution: "direct", citekey: single },
    );
    // The second test repeats the target's own input so TypeScript sees the
    // path a `direct` resolution always carries.
    if (intent.kind !== "hover" || notePath === null) {
      logger.trace("Rendered citation hover suppressed", {
        works: works.length,
      });
      return;
    }

    const hoverParent = this.#viewOf(element);
    if (!hoverParent) {
      logger.trace("Rendered citation belongs to no markdown view", {
        citekey: intent.citekey,
      });
      return;
    }
    logger.trace("Rendered citation previews note", {
      citekey: intent.citekey,
      path: notePath,
    });
    triggerCitekeyHover(this.#app.workspace, {
      event,
      hoverParent,
      targetEl: element,
      linktext: notePath,
      sourcePath,
    });
  }

  /**
   * The Markdown view a rendered citation sits in, which Obsidian hangs the
   * popover off. Markdown rendered outside such a view — an export, a popover
   * of its own — belongs to none, and hover stays silent there.
   */
  #viewOf(element: HTMLElement): MarkdownView | null {
    for (const leaf of this.#app.workspace.getLeavesOfType("markdown")) {
      const { view } = leaf;
      if (view instanceof MarkdownView && view.containerEl.contains(element)) {
        return view;
      }
    }
    return null;
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
    logger.debug("Document citations read", {
      path: file.path,
      citations: sources.length,
      items: items.length,
      formatted: formatted.size,
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
    const leaves = this.#app.workspace.getLeavesOfType("markdown");
    logger.debug("Rerendering reading views", { count: leaves.length });
    for (const leaf of leaves) {
      const { view } = leaf;
      if (view instanceof MarkdownView) view.previewMode.rerender(true);
    }
  }
}
