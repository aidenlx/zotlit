// The formatted text of one document's Citations, held for every surface that shows them.

import type { App, TFile } from "obsidian";

import {
  getItemsByKey,
  getZoteroIdentity,
  isChildItemFields,
  itemToCsl,
  resolveIndexedKeyLibrary,
} from "@zotlit/db";
import type { CslItemData } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { BoundedCache } from "@/lib/bounded-cache";
import { isRenderableCitation } from "@/lib/citation-fragment";
import { registerEvent } from "@/lib/disposables";
import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import {
  citationRuns,
  runDisplay,
  wikilinkCitation,
} from "@/lib/wikilink-citation";
import { scanDocumentCitations } from "@/services/citation-index/service";
import type {
  Citation,
  CitationIndex,
  CitationOccurrence,
} from "@/services/citation-index/service";
import type { DatabaseService } from "@/services/database/service";
import { resolveLiteratureNote } from "@/services/note-index/service";
import type { NoteIndex } from "@/services/note-index/service";
import type { BibliographyRenderCache } from "@/services/pandoc/render-cache";
import { Service } from "@/services/service-base";

import type { CitationSource, DocumentCitations } from "./present";

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
  citationIndex: Pick<
    CitationIndex,
    "getDocumentCitationSet" | "citekeyOf" | "whenResolved" | "on"
  >;
  /** What a citekey resolves to, which decides what a Citation can say. */
  noteIndex: Pick<NoteIndex, "on" | "whenIndexed">;
  /** The plugin-wide render cache, which owns the References Style and the engine. */
  bibliographyRender: Pick<BibliographyRenderCache, "renderCitations" | "on">;
}

/**
 * Formats every Citation one document writes in either citing syntax, and hands
 * the same answer to every surface that shows that document — the reading
 * view's post-processors and the editor's widgets alike, so all of them read
 * the same text.
 *
 * A wikilink Citation is formatted from the Pandoc source the exporter would
 * write it as, which is the very source the equivalent Citation Cluster
 * carries; the two syntaxes therefore share one render and read alike.
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
    stack.defer(
      this.#citationIndex.on("membership-changed", () => this.#dropAll()),
    );
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
    // Renaming or creating a Literature Note is a cross-document input: which
    // Literature Note a wikilink resolves to decides what a citekey here
    // reaches. Only `changed` is listened for, and it reports just the edits
    // that move a mapping. Its `rebuilt` counterpart rides Obsidian's
    // `resolved` event, which fires after every batch of edits in the vault,
    // and dropping there would put back the wholesale flush this holds text to
    // avoid; a rescan that finds a moved mapping in steady state has already
    // emitted `changed` for it.
    stack.defer(this.#noteIndex.on("changed", () => this.#dropAll()));
    // A citekey resolution snapshot rebuild is the other cross-document input:
    // it decides what a literal `@citekey` reaches, and whether a wikilink's
    // Literature Note carries a native citation key at all.
    stack.defer(
      this.#citationIndex.on("resolution-changed", () => this.#dropAll()),
    );
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
   * The read waits for the Note Index to finish its first scan and for the
   * citekey resolution snapshot to run its first rebuild, so a document opened
   * during startup is never answered against an index or a snapshot that still
   * resolves nothing. That wait is what lets the drops below listen for moved
   * mappings alone rather than for every rescan.
   */
  async #readDocument(file: TFile): Promise<DocumentCitations> {
    await Promise.all([
      this.#noteIndex.whenIndexed(),
      this.#citationIndex.whenResolved(),
    ]);
    const body = await this.#app.vault.cachedRead(file);
    const set = await this.#citationIndex.getDocumentCitationSet(file);
    const wikilinks = this.#wikilinkCitations(file, body, set.occurrences);
    const cited = set.citations;
    const { items, summaries } = this.#readCited(
      citekeysByItem(cited, wikilinks.works),
    );

    // Both syntaxes go to one render in document order, so a numbering style
    // counts every citation of the document once and in the order it reads.
    const sources = [
      ...literalCitations(body, set.occurrences),
      ...wikilinks.citations,
    ]
      .sort((a, b) => a.start - b.start)
      .filter((citation) =>
        citation.keys.every((key) => summaries.has(key.citekey)),
      )
      .map(({ source }) => source);

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
      wikilinks: wikilinks.citations.length,
      items: items.length,
      formatted: formatted.size,
    });
    return { formatted, summaries };
  }

  /**
   * The Citations one document's Literature Note wikilinks write, each as the
   * Pandoc source the exporter would write it as.
   *
   * Link occurrences come from Obsidian's own metadata cache, which already
   * omits links inside code, and a Citation Run is read from the document text
   * that joins them. A Markdown-syntax link and an aliased one stay out, the
   * same two exclusions the display surfaces make.
   */
  #wikilinkCitations(
    file: TFile,
    body: string,
    occurrences: readonly CitationOccurrence[],
  ): DocumentWikilinks {
    const members = new Set(
      occurrences
        .filter((occurrence) => occurrence.kind === "wikilink")
        .map((occurrence) => occurrence.position.start.offset),
    );
    const context = {
      literatureNote: (linkpath: string) => {
        const note = resolveLiteratureNote(linkpath, file.path, {
          app: this.#app,
        });
        return (
          note && {
            ...note,
            citationKey: this.#citationIndex.citekeyOf(note.indexedKey),
          }
        );
      },
      enabled: true,
      fragmentlessDisplay: true,
    };

    const runs = citationRuns(
      (this.#app.metadataCache.getFileCache(file)?.links ?? []).filter((link) =>
        members.has(link.position.start.offset),
      ),
      (link) => wikilinkCitation(link.link, context),
      (previous, next) =>
        body.slice(previous.position.end.offset, next.position.start.offset),
    );

    const works = new Map<string, string>();
    const citations: PlacedCitation[] = [];
    for (const run of runs) {
      for (const { citation } of run) {
        works.set(citation.item.citekey, citation.indexedKey);
      }
      const { citation } = runDisplay(run);
      // A derivation the engine would read back as something else stays out of
      // the render, and the run shows its Citation Display Text instead.
      if (!isRenderableCitation(citation)) {
        logger.debug("Wikilink citation is not Pandoc source", {
          path: file.path,
          source: citation.source,
        });
        continue;
      }
      citations.push({
        start: run[0]!.source.position.start.offset,
        ...citation,
      });
    }
    return { citations, works };
  }

  /**
   * The cited works, read straight from the database so the surfaces keep
   * working while Zotero is closed.
   *
   * Citeproc matches a citation by the CSL `id`, so each work is handed over
   * under the citekey the document names it by — the key the author wrote, or
   * the native Zotero citation key a wikilink resolves to.
   *
   * @param cited the citekeys naming each Indexed Key the document cites.
   */
  #readCited(cited: ReadonlyMap<string, ReadonlySet<string>>): {
    items: CslItemData[];
    summaries: Map<string, string>;
  } {
    const items: CslItemData[] = [];
    const summaries = new Map<string, string>();
    if (this.#db.state !== "ready" || cited.size === 0) {
      return { items, summaries };
    }

    try {
      const client = this.#db.client;
      const user = getZoteroIdentity(client);
      for (const [indexedKey, citekeys] of cited) {
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
        for (const citekey of citekeys) {
          // One citekey names one work here: a document that reaches two
          // through it — a literal key and a wikilink whose Item carries the
          // same native citation key — keeps the first work read.
          if (summaries.has(citekey)) {
            logger.debug("Citekey names two works in one document", {
              citekey,
              dropped: indexedKey,
            });
            continue;
          }
          summaries.set(citekey, subtitle || title);
          items.push({ ...csl, id: citekey });
        }
      }
    } catch (error) {
      logger.warn("Cannot read the cited items", { error });
    }
    return { items, summaries };
  }
}

/** One Citation of a document, at the offset the document writes it. */
interface PlacedCitation extends CitationSource {
  start: number;
}

/** What one document's Literature Note wikilinks cite. */
interface DocumentWikilinks {
  /** The Citations they write, one per Citation Run, in document order. */
  citations: PlacedCitation[];
  /** The Indexed Key each derived citekey names. */
  works: Map<string, string>;
}

/** The literal Citation Clusters of a document body, in document order. */
function literalCitations(
  body: string,
  occurrences: readonly CitationOccurrence[],
): PlacedCitation[] {
  const members = new Set(
    occurrences
      .filter((occurrence) => occurrence.kind === "citekey")
      .map((occurrence) => occurrence.position.start.offset),
  );
  return scanDocumentCitations(body)
    .filter(({ keys }) => keys.every((key) => members.has(key.start)))
    .map(({ start, end, keys }) => ({
      start,
      source: body.slice(start, end),
      keys: keys.map((key) => ({
        citekey: key.citekey,
        start: key.start - start,
        end: key.end - start,
      })),
    }));
}

/**
 * The citekeys naming each Indexed Key the document cites, over both syntaxes —
 * one work cited as a citekey and as a wikilink reaches the database once and
 * answers under both names.
 */
function citekeysByItem(
  cited: readonly Citation[],
  works: ReadonlyMap<string, string>,
): Map<string, Set<string>> {
  const byItem = new Map<string, Set<string>>();
  const add = (indexedKey: string, citekey: string): void => {
    const citekeys = byItem.get(indexedKey);
    if (citekeys) citekeys.add(citekey);
    else byItem.set(indexedKey, new Set([citekey]));
  };
  for (const { indexedKey, occurrences } of cited) {
    if (indexedKey === null) continue;
    for (const { kind, raw } of occurrences) {
      if (kind === "citekey") add(indexedKey, raw);
    }
  }
  for (const [citekey, indexedKey] of works) add(indexedKey, citekey);
  return byItem;
}
