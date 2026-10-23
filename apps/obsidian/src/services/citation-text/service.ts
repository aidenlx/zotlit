import { QueryObserver } from "@tanstack/query-core";
import type { App, TFile } from "obsidian";

// The formatted text of one document's Citations, held for every surface that shows them.
import type { CslItemData } from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";
import {
  formatPandocCitation,
  scanPandocCitations,
} from "@zotlit/templates/pandoc-citation";
import type { ScannedPandocCitation } from "@zotlit/templates/pandoc-citation";

import { registerEvent } from "@/lib/disposables";
import { Effect, Stream } from "@/lib/effect";
import { openScope } from "@/lib/effect-scope";
import { subscribe } from "@/lib/effect-stream";
import { getLogger } from "@/lib/log";
import { mapsEqual } from "@/lib/maps-equal";
import type { OpenDocuments } from "@/lib/open-documents";
import {
  citationOfRun,
  citationRuns,
  wikilinkCitation,
} from "@/lib/wikilink-citation";
import { renderParsedCitation } from "@/services/citation-index/parsed-note";
import type { PlainCitationLookup } from "@/services/citation-index/plain";
import type { NoteScanRecord } from "@/services/citation-index/scan-note";
import type {
  Citation,
  CitationIndex,
  CitationOccurrence,
  DocumentCitationSet,
} from "@/services/citation-index/service";
import type { PlainNoteIndex } from "@/services/note-index/plain";
import {
  documentCitationPresentation,
  documentPresentation,
} from "@/services/pandoc/document-presentation";
import { holdsNote } from "@/services/pandoc/inline-content";
import type {
  BibliographyRenderCache,
  RenderPresentation,
} from "@/services/pandoc/render-cache";
import type { ProfileReader } from "@/services/profile/service";
import type { PlainQueryClients } from "@/services/query-client/plain";
import type { Held } from "@/services/query-client/service";
import { Service } from "@/services/service-base";

import { citationKey, presentedCitationEqual } from "./present";
import type {
  CitationSource,
  DocumentCitations,
  FormattedOccurrence,
} from "./present";

export { type DocumentCitations } from "./present";

const logger = getLogger("citation-text");

/**
 * The key prefix every document's citation text is held under; the vault path
 * of the document completes it.
 *
 * Text is retained while its document is open in a workspace leaf: a document
 * the author keeps open answers from what it holds however long the pause.
 * Any other document's text, an embed's included, expires {@link TEXT_GC_TIME}
 * after its last read, and the key is dropped at once
 * when the file it names is deleted. Each document's text carries its captured
 * Citation Lookup answer, so no answer outlives the documents shown.
 */
const CITATION_TEXT = "citation-text";

/** How long the text of a document no longer open stays held. */
const TEXT_GC_TIME = Temporal.Duration.from({ minutes: 5 }).total(
  "milliseconds",
);

/** What a citation shows in place of a note where no serial stands for one. */
const NO_SERIALS: readonly undefined[] = [];

interface CitationTextEvents {
  /** What is held for one document changed or went stale. */
  changed: (path: string) => void;
  /** One document read committed, including an equal or failed read. */
  settled: (path: string, held: Held<DocumentCitations> | null) => void;
  /** Every document's citation text went stale; a surface showing it asks again. */
  invalidated: () => void;
}

export interface CitationTextDeps {
  app: App;
  citationLookup: Pick<PlainCitationLookup, "changes">;
  citationIndex: Pick<
    CitationIndex,
    "getDocumentCitationSet" | "getParsedDocument" | "on"
  >;
  /** What a citekey resolves to, which decides what a Citation can say. */
  noteIndex: Pick<PlainNoteIndex, "on" | "whenIndexed">;
  profile: ProfileReader;
  /** The plugin-wide render cache, which owns the Citation and References Style and the engine. */
  bibliographyRender: Pick<
    BibliographyRenderCache,
    "readCitations" | "readBibliography" | "on" | "vaultPresentation"
  >;
  /** The plugin-wide query client every Held Read is realized on. */
  queryClient: Pick<
    PlainQueryClients,
    "client" | "ask" | "read" | "peek" | "invalidate" | "watch"
  >;
  /** The documents whose text stays held, for as long as each is open. */
  openDocuments: OpenDocuments;
}

/**
 * Formats literal and wikilink Citations in the context of the complete
 * Document Citation Set, and hands the same answer to every surface that
 * shows that document — the reading view's post-processors and the editor's widgets alike.
 *
 * Text is keyed by occurrence: under a position-dependent Citation and
 * References Style two occurrences of one source read differently, each showing
 * the text the engine produced for it. A surface holding no coordinate for the
 * occurrence it shows reads the source's first-occurrence text.
 *
 * A wikilink Citation is formatted from the Pandoc source the exporter would
 * write it as, which is the very source the equivalent Citation Cluster
 * carries; the two syntaxes therefore share one render.
 *
 * Text comes from the plugin-wide bibliography render cache, which is also the
 * References Sidebar's source, so all three surfaces agree on the References
 * Style and go stale together. With no engine installed there is no formatted
 * text, so every surface keeps native source presentation. Item summaries stay
 * available for navigation labels.
 *
 * Nothing is read eagerly: a surface asks for a document, and asks again when
 * {@link CitationTextEvents} says what it holds no longer stands.
 */
export class CitationText extends Service<void> {
  readonly #app;
  readonly #citationIndex;
  readonly #citationLookup;
  readonly #noteIndex;
  readonly #profile: ProfileReader;
  readonly #bibliographyRender;
  readonly #queries;
  readonly #openDocuments;
  readonly #emitter = createNanoEvents<CitationTextEvents>();
  /** Releases for the pins that keep each open document's text held. */
  readonly #pins = new Map<string, () => void>();

  ready: Promise<void>;

  constructor(deps: CitationTextDeps) {
    super();
    this.#app = deps.app;
    this.#citationIndex = deps.citationIndex;
    this.#citationLookup = deps.citationLookup;
    this.#noteIndex = deps.noteIndex;
    this.#profile = deps.profile;
    this.#bibliographyRender = deps.bibliographyRender;
    this.#queries = deps.queryClient;
    this.#openDocuments = deps.openDocuments;
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
   * The peek resolves the file and starts the first or replacement read. A
   * stale answer stays available while that read runs.
   *
   * @returns null while the first read is pending.
   */
  peek(path: string): Held<DocumentCitations> | null {
    if (this.#app.vault.getFileByPath(path) === null) {
      this.#drop(path);
      return null;
    }
    void this.#queries.ask(documentKey(path), () => this.#read(path));
    return this.#queries.peek<DocumentCitations>(documentKey(path));
  }

  /**
   * The citations of one document once the read behind them stands, for a
   * caller that can wait — the Citation Popover fills asynchronously and shows
   * the final answer rather than an intermediate one.
   *
   * @param signal ends the wait; the shared read runs on for every other
   *   surface that joined it.
   * @returns null where the document is gone or its read failed.
   */
  async read(
    path: string,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<DocumentCitations | null> {
    const text = await this.#queries.read(
      documentKey(path),
      () => this.#read(path),
      signal,
    );
    // A file deleted while its read ran holds nothing: the path is resolved
    // again here, because the read may have started before the file went.
    if (this.#app.vault.getFileByPath(path) !== null) return text;
    this.#drop(path);
    return null;
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    this.#queries.client.setQueryDefaults([CITATION_TEXT], {
      gcTime: TEXT_GC_TIME,
      // An equal re-read keeps the identity the surfaces hold, so nothing
      // repaints for text that reads the same.
      structuralSharing: (held, next) =>
        held !== undefined &&
        documentCitationsEqual(
          held as DocumentCitations,
          next as DocumentCitations,
        )
          ? held
          : next,
    });
    stack.defer(() => {
      for (const release of this.#pins.values()) release();
      this.#pins.clear();
    });
    stack.use(this.#openDocuments.subscribe(() => this.#pinOpenDocuments()));
    this.#pinOpenDocuments();
    stack.defer(
      this.#queries.watch<DocumentCitations>([CITATION_TEXT], {
        changed: (key) => this.#emitter.emit("changed", pathOf(key)),
        settled: (key, held) =>
          this.#emitter.emit("settled", pathOf(key), held),
      }),
    );
    stack.defer(
      this.#citationIndex.on("membership-changed", () => this.#invalidate()),
    );
    // A document's own citekeys decide what its citations say.
    stack.defer(
      this.#citationIndex.on("changed", (path) => this.#invalidate(path)),
    );
    // So does everything else the document writes around them: a locator or a
    // prefix is part of the source a render is keyed by, and editing one leaves
    // the citekey occurrences the Citation Index tracks untouched. The drop
    // reaches that one document, so an edit anywhere else leaves the rest held.
    stack.use(
      registerEvent(
        this.#app.metadataCache.on("changed", (file) =>
          this.#invalidate(file.path),
        ),
      ),
    );
    stack.use(
      registerEvent(
        this.#app.metadataCache.on("deleted", (file) => this.#drop(file.path)),
      ),
    );
    // Renaming or creating a Literature Note is a cross-document input: which
    // Literature Note a wikilink resolves to decides what a citekey here
    // reaches. The Note Index reports every moved mapping as `changed`, and
    // its one Full Scan per session as `indexed`, which a reader of the
    // index before the scan reads again.
    stack.defer(this.#noteIndex.on("changed", () => this.#invalidate()));
    stack.defer(this.#noteIndex.on("indexed", () => this.#invalidate()));
    // A citekey resolution snapshot rebuild is the other cross-document input:
    // it decides what a literal `@citekey` reaches, and whether a wikilink's
    // Literature Note carries a native citation key at all.
    const lookupScope = openScope();
    stack.defer(lookupScope.close);
    stack.defer(
      subscribe(
        { scope: lookupScope.scope, runFork: Effect.runFork },
        this.#citationLookup.changes.pipe(
          Stream.map((state) => state.revision),
          Stream.changes,
          Stream.drop(1),
        ),
        () => this.#invalidate(),
      ),
    );
    // What the render cache holds is what these surfaces show, so its wholesale
    // drop makes every document's text stale at once.
    stack.defer(
      this.#bibliographyRender.on("invalidated", () => this.#invalidate()),
    );

    this.commit(stack.move());
  }

  /**
   * Marks one document's text stale, or every document's where no path names
   * one, and announces the scope the drop reached.
   */
  #invalidate(path?: string): void {
    const queryKey = path === undefined ? [CITATION_TEXT] : documentKey(path);
    // A document nothing has read stays quiet: an edit anywhere else in the
    // vault reaches no surface that shows citation text.
    if (
      path !== undefined &&
      this.#queries.client.getQueryState(queryKey) === undefined
    ) {
      return;
    }
    this.#queries.invalidate(queryKey);
    if (path === undefined) this.#emitter.emit("invalidated");
    else this.#emitter.emit("changed", path);
  }

  /** Releases what one vault path holds, which a file no longer there must. */
  #drop(path: string): void {
    // The pin observes the query the removal discards; an open document pins
    // its next query on the following workspace change.
    this.#pins.get(path)?.();
    this.#pins.delete(path);
    this.#queries.client.removeQueries({ queryKey: documentKey(path) });
  }

  /**
   * Keeps each open document's text out of garbage collection and lets a
   * closed one expire. A pin is a disabled observer: it holds the query
   * without reading, and every read still starts from a surface's ask.
   */
  #pinOpenDocuments(): void {
    if (this.disposing) return;
    const open = this.#openDocuments.paths();
    for (const [path, release] of this.#pins) {
      if (open.has(path)) continue;
      release();
      this.#pins.delete(path);
    }
    for (const path of open) {
      if (this.#pins.has(path)) continue;
      const observer = new QueryObserver(this.#queries.client, {
        queryKey: documentKey(path),
        enabled: false,
      });
      const unsubscribe = observer.subscribe(() => undefined);
      this.#pins.set(path, () => {
        unsubscribe();
        observer.destroy();
      });
    }
  }

  /**
   * The document read, as the query behind one vault path runs it. The path is
   * resolved on every run, so a read asked again after a cancellation reads the
   * file the path names now — and reads nothing where it names none.
   */
  async #read(path: string): Promise<DocumentCitations> {
    const file = this.#app.vault.getFileByPath(path);
    if (file === null) {
      throw new Error(`No document to read the citations of at ${path}`);
    }
    try {
      return await this.#readDocument(file);
    } catch (error) {
      logger.warn("Cannot read the citations of a document", { path, error });
      throw error;
    }
  }

  /**
   * A style that numbers counts citations across the whole document, so every
   * citation the document writes goes to the render — not only the ones one
   * surface holds. A citation naming a key that reaches no Zotero Item stays
   * out: citeproc has nothing to format it from, and it falls back to what the
   * author wrote.
   *
   * The read waits for the Note Index to finish its first scan and for the
   * citekey resolution snapshot to complete a successful rebuild. A document
   * opened during startup is never answered against an index or snapshot that still
   * resolves nothing. That wait is what lets the drops below listen for moved
   * mappings alone rather than for every rescan.
   */
  async #readDocument(file: TFile): Promise<DocumentCitations> {
    await Promise.all([this.#noteIndex.whenIndexed(), this.#profile.ready]);
    const { facts, set } = await this.#citationIndex.getParsedDocument(file);
    const { source: body, record } = facts;
    const wikilinks = this.#wikilinkCitations(file, body, set);
    const literal = worksByCitekey(set.citations);
    if (set.database === "unreadable")
      throw new Error("The Zotero database cannot be read");
    const works = new Map(
      set.citations.flatMap(({ indexedKey }) => {
        const source =
          indexedKey === null ? undefined : set.sources.get(indexedKey);
        return source && indexedKey !== null
          ? [
              [
                indexedKey,
                { csl: source.csl, summary: source.citationSummary },
              ] as const,
            ]
          : [];
      }),
    );

    // Every admitted syntax contributes to the same document render context.
    const placed = [
      ...literalCitations({
        body,
        scanned: record.citations,
        occurrences: set.occurrences,
        works: literal,
      }),
      ...wikilinks,
    ];
    const citations = placed.flatMap((citation) => {
      const context = renderContextCitation(citation, works);
      return context === null ? [] : [context];
    });
    for (const { indexedKey, occurrences } of set.citations) {
      if (indexedKey === null || !works.has(indexedKey)) continue;
      for (const occurrence of occurrences) {
        if (occurrence.kind !== "annotation") continue;
        citations.push({
          identity: body.slice(
            occurrence.position.start.offset,
            occurrence.position.end.offset,
          ),
          start: occurrence.position.start.offset,
          renderSource: formatPandocCitation([
            {
              citationKey: indexedKey,
              prefix: null,
              suffix: null,
              suppressAuthor: false,
              locator:
                occurrence.pageLabel == null
                  ? null
                  : { label: "p.", value: occurrence.pageLabel },
            },
          ]),
          // Annotation link replacement belongs to #1678.
          complete: false,
        });
      }
    }
    citations.sort((a, b) => a.start - b.start);
    const sources = citations.map(({ renderSource }) => renderSource);
    // A citation source names each work by its Indexed Key, which is the one
    // CSL id a Pandoc citekey can spell; the bibliography addresses the same
    // work by the item identity its own render carries.
    const items = [...works].map(([indexedKey, { csl }]) => ({
      ...csl,
      id: indexedKey,
    }));

    // What this document renders under, whole — the style, the Citation
    // Locale, and the works it cites in the order it cites them — read through
    // the one boundary the References Sidebar and the Citation Popover read it
    // through, so the digits inline are the digits their lists show.
    //
    // A document whose own presentation property names nothing at all renders
    // nothing: its citations keep the source the author wrote, rather than
    // reading as though a vault selection were what the note declared.
    const presented = documentCitationPresentation(
      documentPresentation(this.#app.metadataCache, file, this.#profile),
      this.#bibliographyRender.vaultPresentation,
      { citations: set.citations, works },
    );
    const presentation =
      presented.kind === "read" ? presented.presentation : null;
    const rendered =
      presentation === null
        ? null
        : await this.#bibliographyRender.readCitations(sources, items, {
            presentation,
          });
    // A style whose citations are footnotes leaves a note in the rendered
    // content, which no surface can show. That output — not the style — is
    // what puts the whole document on Entry Serials.
    const entrySerials =
      rendered?.some(({ content }) => holdsNote(content)) ?? false;
    const serials =
      presented.kind === "read" && entrySerials
        ? await this.#readSerials(
            presented.items,
            works,
            presented.presentation,
          )
        : null;

    // Each occurrence keeps the text rendered for its own place in the
    // document, which is what a position-dependent style renders differently
    // from one occurrence of a source to the next. The render answers in the
    // document order the sources went out in, so every identity's occurrences
    // are collected in that order too.
    const formatted = new Map<string, FormattedOccurrence[]>();
    if (rendered?.length === citations.length) {
      rendered.forEach((text, index) => {
        const { identity, start, complete } = citations[index]!;
        if (!complete) return;
        // One slot per work the citation names, in the order it names them,
        // whichever mode it names each of them in.
        const occurrence: FormattedOccurrence = {
          start,
          text,
          serials:
            serials === null
              ? NO_SERIALS
              : text.citations.map(({ id }) => serials.get(id)),
        };
        const occurrences = formatted.get(identity);
        if (occurrences === undefined) formatted.set(identity, [occurrence]);
        else occurrences.push(occurrence);
      });
    }
    logger.debug("Document citations read", () => ({
      path: file.path,
      citations: sources.length,
      wikilinks: wikilinks.length,
      items: items.length,
      entrySerials,
      formatted: [...formatted.values()].reduce(
        (count, occurrences) => count + occurrences.length,
        0,
      ),
    }));
    return {
      ...(presented.kind === "unusable" && presented.property === "profile"
        ? { presentationFailure: presented }
        : {}),
      formatted,
      entrySerials,
      summaries: new Map(
        [...works].map(([indexedKey, { summary }]) => [indexedKey, summary]),
      ),
      literalWorks: literal,
      lookup: set.lookup,
    };
  }

  /**
   * The Entry Serial of each cited work, by the Indexed Key its citations name
   * it under.
   *
   * A serial is a work's place in the References Sidebar's list, so it is read
   * off the very bibliography that sidebar shows: the same works in the same
   * order, which the render cache answers for both surfaces from one render.
   *
   * @param items the document's ordered citation set, as the Citation
   *   Presentation boundary computed it.
   * @param works the cited works by Indexed Key, which is what each rendered
   *   entry's own item identity is read back as.
   * @returns the serials by Indexed Key; a work the bibliography rendered no
   *   entry for is absent, and every work is absent when no bibliography could
   *   be rendered at all, which shows the citation a ⚠ in each slot.
   */
  async #readSerials(
    items: readonly CslItemData[],
    works: ReadonlyMap<string, CitedItem>,
    presentation: RenderPresentation,
  ): Promise<ReadonlyMap<string, number>> {
    const serials = new Map<string, number>();
    const rendered = await this.#bibliographyRender.readBibliography(items, {
      presentation,
    });
    if (rendered === null) {
      logger.debug("Cannot number the cited entries");
      return serials;
    }
    const places = new Map(
      rendered.entries.map(({ id }, index) => [id, index + 1]),
    );
    for (const [indexedKey, { csl }] of works) {
      const serial = places.get(csl.id);
      if (serial !== undefined) serials.set(indexedKey, serial);
    }
    return serials;
  }

  /**
   * The Citations one document's Literature Note wikilinks write, each as the
   * Pandoc source the exporter would write it as.
   *
   * Membership and resolved works come from the Document Citation Set;
   * the body supplies the separators between admitted links.
   */
  #wikilinkCitations(
    file: TFile,
    body: string,
    { occurrences, lookup, citations: grouped }: DocumentCitationSet,
  ): PlacedCitation[] {
    const notes = new Map(
      grouped.flatMap((citation) =>
        citation.indexedKey === null
          ? []
          : citation.occurrences.flatMap((occurrence) => {
              if (occurrence.kind !== "wikilink") return [];
              const note = this.#app.metadataCache.getFirstLinkpathDest(
                occurrence.raw,
                file.path,
              );
              return note
                ? [
                    [
                      occurrence.raw,
                      {
                        path: note.path,
                        indexedKey: citation.indexedKey!,
                        citationKey: lookup.citekeyOf(citation.indexedKey!),
                      },
                    ] as const,
                  ]
                : [];
            }),
      ),
    );
    const context = {
      literatureNote: (linkpath: string) => notes.get(linkpath) ?? null,
      enabled: true,
    };

    const runs = citationRuns(
      occurrences.filter((occurrence) => occurrence.kind === "wikilink"),
      ({ raw, fragment }) =>
        wikilinkCitation(
          fragment === undefined ? raw : `${raw}#cite:${fragment}`,
          context,
        ),
      (previous, next) =>
        body.slice(previous.position.end.offset, next.position.start.offset),
    );

    const citations: PlacedCitation[] = [];
    for (const run of runs) {
      const citation = citationOfRun(run);
      citations.push({
        start: run[0]!.source.position.start.offset,
        ...citation,
        parsed: scanPandocCitations(citation.source)[0]!,
        identity: citationKey(citation),
      });
    }
    return citations;
  }
}

/** The key one document's citation text is held under. */
function documentKey(path: string): [string, string] {
  return [CITATION_TEXT, path];
}

/** The vault path a {@link documentKey} names. */
function pathOf(key: readonly unknown[]): string {
  return String(key[1]);
}

/** One cited work, as the render and the display surfaces read it. */
interface CitedItem {
  /** The work as the engine reads it, its `id` the item identity a bibliography entry carries. */
  csl: CslItemData;
  /** `Creators (Year)`, the navigation label of every citekey naming this work. */
  summary: string;
}

/** One Citation of a document, at the offset the document writes it. */
interface PlacedCitation extends CitationSource {
  parsed: ScannedPandocCitation;
  start: number;
  /** The Indexed Key each of `keys` names, or `null` for one naming no Item. */
  works: (string | null)[];
  /** {@link citationKey} of the Citation, as the surface showing it holds it. */
  identity: string;
}

/** One engine input and whether its output may replace the native source. */
interface RenderContextCitation {
  /** {@link PlacedCitation.identity} */
  identity: string;
  /** {@link PlacedCitation.start} */
  start: number;
  renderSource: string;
  complete: boolean;
}

/**
 * @param cited the document's Citations, across all admitted syntaxes.
 * @returns the Item each literal citekey names. One spelling names one Item —
 *   the citekey resolution snapshot decides which — so one entry answers for
 *   every occurrence of it.
 */
function worksByCitekey(cited: readonly Citation[]): Map<string, string> {
  const works = new Map<string, string>();
  for (const { indexedKey, occurrences } of cited) {
    if (indexedKey === null) continue;
    for (const { kind, raw } of occurrences) {
      if (kind === "citekey" && !works.has(raw)) works.set(raw, indexedKey);
    }
  }
  return works;
}

/**
 * The literal Citation Clusters of a document body, in document order.
 *
 * The work map names the Item each literal citekey resolves to.
 */
function literalCitations({
  body,
  scanned,
  occurrences,
  works,
}: {
  body: string;
  scanned: NoteScanRecord["citations"];
  occurrences: readonly CitationOccurrence[];
  works: ReadonlyMap<string, string>;
}): PlacedCitation[] {
  const members = new Set(
    occurrences
      .filter((occurrence) => occurrence.kind === "citekey")
      .map((occurrence) => occurrence.position.start.offset),
  );
  return scanned
    .filter(({ keys }) => keys.every((key) => members.has(key.start)))
    .map((parsed) => {
      const { start, end, keys } = parsed;
      const source = body.slice(start, end);
      return {
        start,
        source,
        parsed,
        // The works below say what this citation renders from; they stay out
        // of its identity, because one literal spelling names one Item.
        identity: citationKey({ source }),
        keys: keys.map((key) => ({
          citekey: key.citekey,
          start: key.start - start,
          end: key.end - start,
        })),
        works: keys.map((key) => works.get(key.citekey) ?? null),
      };
    });
}

/**
 * Keeps every resolved item in CSL's document context, naming each by the Item
 * it cites rather than by the citekey the source spells it with. A partial
 * Citation Cluster enters that context with only its resolved members, while
 * its output is discarded so the author still sees the complete native source.
 */
function renderContextCitation(
  citation: PlacedCitation,
  works: ReadonlyMap<string, CitedItem>,
): RenderContextCitation | null {
  const ids = citation.works.map((indexedKey) =>
    indexedKey !== null && works.has(indexedKey) ? indexedKey : null,
  );
  if (ids.every((id) => id === null)) return null;

  return {
    identity: citation.identity,
    start: citation.start,
    renderSource: renderParsedCitation(citation.parsed, ids),
    complete: ids.every((id) => id !== null),
  };
}

function documentCitationsEqual(
  prev: DocumentCitations,
  next: DocumentCitations,
): boolean {
  return (
    prev.lookup.revision === next.lookup.revision &&
    prev.entrySerials === next.entrySerials &&
    profilePresentationFailuresEqual(
      prev.presentationFailure,
      next.presentationFailure,
    ) &&
    mapsEqual(prev.summaries, next.summaries, Object.is) &&
    mapsEqual(prev.literalWorks, next.literalWorks, Object.is) &&
    mapsEqual(prev.formatted, next.formatted, occurrencesEqual)
  );
}

function profilePresentationFailuresEqual(
  prev: DocumentCitations["presentationFailure"],
  next: DocumentCitations["presentationFailure"],
): boolean {
  if (prev === undefined || next === undefined) return prev === next;
  return (
    prev.target === next.target &&
    prev.diagnostic.code === next.diagnostic.code &&
    prev.diagnostic.hint === next.diagnostic.hint &&
    prev.diagnostic.recovery.action === next.diagnostic.recovery.action &&
    prev.diagnostic.stamp === next.diagnostic.stamp &&
    prev.diagnostic.path === next.diagnostic.path &&
    prev.diagnostic.indexedKey === next.diagnostic.indexedKey
  );
}

function occurrencesEqual(
  prev: readonly FormattedOccurrence[],
  next: readonly FormattedOccurrence[],
): boolean {
  return (
    prev.length === next.length &&
    prev.every(
      (occurrence, index) =>
        occurrence.start === next[index]!.start &&
        presentedCitationEqual(occurrence, next[index]!),
    )
  );
}
