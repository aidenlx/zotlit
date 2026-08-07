// The formatted text of one document's Citations, held for every surface that shows them.

import { type App, type TFile } from "obsidian";

import {
  getItemsByKey,
  getZoteroIdentity,
  isChildItemFields,
  itemToCsl,
  resolveIndexedKeyLibrary,
  type CslItemData,
} from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

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
import { type NoteIndex } from "@/services/note-index/service";
import { type BibliographyRenderCache } from "@/services/pandoc/render-cache";
import { Service } from "@/services/service-base";

import { type DocumentCitations } from "./present";

export { type DocumentCitations } from "./present";

const logger = getLogger("citation-text");

/**
 * Documents whose citations are held at once. A reading view renders one
 * section at a time and each asks the same document again, and an editor asks
 * for its own document on every rebuild, so the bound only keeps a session that
 * visits many documents from growing without end.
 */
const HELD_DOCUMENTS = 8;

const NO_CITATIONS: DocumentCitations = {
  formatted: new Map(),
  summaries: new Map(),
};

/** One document's citations, and what the read that produced them answered. */
interface HeldCitations {
  promise: Promise<DocumentCitations>;
  /** What the read produced, once it has; null while it is still running. */
  text: DocumentCitations | null;
}

interface CitationTextEvents {
  /** What is held for one document changed — a fresh read, or a stale drop. */
  changed: (path: string) => void;
  /** Every document's citation text went stale; a surface showing it asks again. */
  invalidated: () => void;
}

export interface CitationTextDeps {
  app: App;
  db: Pick<DatabaseService, "state" | "client">;
  citationIndex: Pick<CitationIndex, "getCitations" | "on">;
  /** What a citekey resolves to, which decides what a Citation can say. */
  noteIndex: Pick<NoteIndex, "on" | "whenIndexed">;
  /** The plugin-wide render cache, which owns the References Style and the engine. */
  bibliographyRender: Pick<BibliographyRenderCache, "renderCitations" | "on">;
}

/**
 * Formats every Citation one document writes, and hands the same answer to
 * every surface that shows that document — the reading view's post-processor
 * and the editor's cluster widgets alike, so both read the same text.
 *
 * Text comes from the plugin-wide bibliography render cache, which is also the
 * References Sidebar's source, so all three surfaces agree on the References
 * Style and go stale together. With no engine installed there is no formatted
 * text and each surface falls back to the shared `Creators (Year)` item
 * summaries held beside it.
 *
 * Nothing is read eagerly: a surface asks for a document, and asks again when
 * {@link CitationTextEvents} says what it holds no longer stands.
 */
export class CitationText extends Service<void> {
  readonly #app;
  readonly #db;
  readonly #citationIndex;
  readonly #noteIndex;
  readonly #bibliographyRender;
  readonly #emitter = createNanoEvents<CitationTextEvents>();
  readonly #documents = new BoundedCache<HeldCitations>(HELD_DOCUMENTS);

  ready: Promise<void>;

  constructor(deps: CitationTextDeps) {
    super();
    this.#app = deps.app;
    this.#db = deps.db;
    this.#citationIndex = deps.citationIndex;
    this.#noteIndex = deps.noteIndex;
    this.#bibliographyRender = deps.bibliographyRender;
    this.ready = this.#load();
  }

  on<K extends keyof CitationTextEvents>(
    event: K,
    cb: CitationTextEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  /**
   * The citations held for one document, for a caller that cannot wait — the
   * editor builds its decorations synchronously.
   *
   * @returns null while nothing is held yet, which is the caller's cue to
   *   {@link load} and show the raw source until the read settles.
   */
  peek(path: string): DocumentCitations | null {
    return this.#documents.peek(path)?.text ?? null;
  }

  /** Reads and holds one document's citations, so {@link peek} can answer for it. */
  load(file: TFile): Promise<DocumentCitations> {
    return this.#documents.hold(file.path, () => this.#begin(file)).promise;
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();

    // A document's own citekeys decide what its citations say.
    stack.defer(this.#citationIndex.on("changed", (path) => this.#drop(path)));
    // So does everything else the document writes around them: a locator or a
    // prefix is part of the source a render is keyed by, and editing one leaves
    // the citekey occurrences the Citation Index tracks untouched. The drop
    // reaches that one document, so an edit anywhere else leaves the rest held.
    stack.use(
      registerEvent(
        this.#app.metadataCache.on("changed", (file) => this.#drop(file.path)),
      ),
    );
    // Resolution is the one cross-document input: the Citation Key Property of
    // any Literature Note decides what a citekey here reaches. Only `changed`
    // is listened for, and it reports just the edits that move a mapping. Its
    // `rebuilt` counterpart rides Obsidian's `resolved` event, which fires
    // after every batch of edits in the vault, and dropping there would put
    // back the wholesale flush this holds text to avoid; a rescan that finds a
    // moved mapping in steady state has already emitted `changed` for it.
    stack.defer(this.#noteIndex.on("changed", () => this.#dropAll()));
    // What the render cache holds is what these surfaces show, so its wholesale
    // drop makes every document's text stale at once.
    stack.defer(
      this.#bibliographyRender.on("invalidated", () => this.#dropAll()),
    );
    stack.defer(() => this.#documents.clear());

    this.commit(stack.move());
  }

  /** One document's text no longer stands. */
  #drop(path: string): void {
    if (this.#documents.peek(path) === undefined) return;
    this.#documents.delete(path);
    this.#emitter.emit("changed", path);
  }

  /** Every document's text no longer stands. */
  #dropAll(): void {
    if (this.#documents.size === 0) return;
    logger.debug("Dropped the citation text", {
      documents: this.#documents.size,
    });
    this.#documents.clear();
    this.#emitter.emit("invalidated");
  }

  /** Starts one document's read and holds it while it runs. */
  #begin(file: TFile): HeldCitations {
    const held: HeldCitations = {
      text: null,
      promise: this.#readDocument(file)
        .catch((error: unknown) => {
          logger.warn("Cannot read the citations of a document", {
            path: file.path,
            error,
          });
          return null;
        })
        .then((text) => {
          // A drop while the read ran leaves this answer superseded, and
          // whatever took its place is not this record's to touch.
          if (this.#documents.peek(file.path) !== held) {
            return text ?? NO_CITATIONS;
          }
          if (text === null) {
            // A failed read is not an answer to hold: the next ask tries again.
            this.#documents.delete(file.path);
            return NO_CITATIONS;
          }
          held.text = text;
          this.#emitter.emit("changed", file.path);
          return text;
        }),
    };
    return held;
  }

  /**
   * A style that numbers counts citations across the whole document, so every
   * citation the document writes goes to the render — not only the ones one
   * surface holds. A citation naming a key that reaches no Zotero Item stays
   * out: citeproc has nothing to format it from, and it falls back to what the
   * author wrote.
   *
   * The read waits for the Note Index to finish its first scan, so a document
   * opened during startup is never answered against an index that still
   * resolves nothing. That wait is what lets the drops below listen for moved
   * mappings alone rather than for every rescan.
   */
  async #readDocument(file: TFile): Promise<DocumentCitations> {
    await this.#noteIndex.whenIndexed();
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
   * The cited works, read straight from the database so the surfaces keep
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
}
