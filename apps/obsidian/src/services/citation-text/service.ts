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

import { isRenderableCitation } from "@/lib/citation-fragment";
import type { CitationKey } from "@/lib/citation-fragment";
import type { TextSpan } from "@/lib/citation-grammar";
import { registerEvent } from "@/lib/disposables";
import { HeldReads } from "@/lib/held-reads";
import type { Held } from "@/lib/held-reads";
import { itemSummary } from "@/lib/item-summary";
import { getLogger } from "@/lib/log";
import { mapsEqual } from "@/lib/maps-equal";
import {
  citationOfRun,
  citationRuns,
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
import {
  documentCitationPresentation,
  documentPresentation,
} from "@/services/pandoc/document-presentation";
import { holdsNote } from "@/services/pandoc/inline-content";
import type {
  BibliographyRenderCache,
  HeldRenderOutcome,
  RenderPresentation,
} from "@/services/pandoc/render-cache";
import { Service } from "@/services/service-base";

import { citationKey } from "./present";
import type {
  CitationSource,
  DocumentCitations,
  FormattedOccurrence,
} from "./present";

export { type DocumentCitations } from "./present";

const logger = getLogger("citation-text");

/**
 * Documents whose citations are held at once. A reading view renders one
 * section at a time and each asks the same document again, and an editor asks
 * for its own document on every rebuild, so the bound only keeps a session that
 * visits many documents from growing without end.
 */
const HELD_DOCUMENTS = 8;

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
  db: Pick<DatabaseService, "state" | "client">;
  citationIndex: Pick<
    CitationIndex,
    "getDocumentCitationSet" | "citekeyOf" | "whenResolved" | "on"
  >;
  /** What a citekey resolves to, which decides what a Citation can say. */
  noteIndex: Pick<NoteIndex, "on" | "whenIndexed">;
  /** The plugin-wide render cache, which owns the Citation and References Style and the engine. */
  bibliographyRender: Pick<
    BibliographyRenderCache,
    "renderCitations" | "render" | "on" | "vaultPresentation"
  >;
}

/**
 * Formats every Citation Occurrence one document writes in either citing
 * syntax, and hands the same answer to every surface that shows that document —
 * the reading view's post-processors and the editor's widgets alike.
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
  readonly #db;
  readonly #citationIndex;
  readonly #noteIndex;
  readonly #bibliographyRender;
  readonly #documents = new HeldReads<DocumentCitations>({
    limit: HELD_DOCUMENTS,
    same: documentCitationsEqual,
  });

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
    return this.#documents.on(event, cb);
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
    const file = this.#app.vault.getFileByPath(path);
    if (file === null) {
      this.#documents.delete(path);
      return null;
    }
    void this.#documents.read(path, () =>
      this.#readDocument(file).catch((error: unknown) => {
        logger.warn("Cannot read the citations of a document", {
          path: file.path,
          error,
        });
        return null;
      }),
    );
    return this.#documents.peek(path);
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(
      this.#citationIndex.on("membership-changed", () =>
        this.#documents.invalidate(),
      ),
    );
    // A document's own citekeys decide what its citations say.
    stack.defer(
      this.#citationIndex.on("changed", (path) =>
        this.#documents.invalidate(path),
      ),
    );
    // So does everything else the document writes around them: a locator or a
    // prefix is part of the source a render is keyed by, and editing one leaves
    // the citekey occurrences the Citation Index tracks untouched. The drop
    // reaches that one document, so an edit anywhere else leaves the rest held.
    stack.use(
      registerEvent(
        this.#app.metadataCache.on("changed", (file) =>
          this.#documents.invalidate(file.path),
        ),
      ),
    );
    stack.use(
      registerEvent(
        this.#app.metadataCache.on("deleted", (file) =>
          this.#documents.delete(file.path),
        ),
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
    stack.defer(
      this.#noteIndex.on("changed", () => this.#documents.invalidate()),
    );
    // A citekey resolution snapshot rebuild is the other cross-document input:
    // it decides what a literal `@citekey` reaches, and whether a wikilink's
    // Literature Note carries a native citation key at all.
    stack.defer(
      this.#citationIndex.on("resolution-changed", () =>
        this.#documents.invalidate(),
      ),
    );
    // What the render cache holds is what these surfaces show, so its wholesale
    // drop makes every document's text stale at once.
    stack.defer(
      this.#bibliographyRender.on("invalidated", () =>
        this.#documents.invalidate(),
      ),
    );
    stack.use(this.#documents);

    this.commit(stack.move());
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
    const literal = worksByCitekey(set.citations);
    const works = this.#readCited([...literal.values(), ...wikilinks.cited]);

    // Both syntaxes go to one render in document order, so a numbering style
    // counts every citation of the document once and in the order it reads.
    const placed = [
      ...literalCitations(body, set.occurrences, literal),
      ...wikilinks.citations,
    ].sort((a, b) => a.start - b.start);
    const citations = placed.flatMap((citation) => {
      const context = renderContextCitation(citation, works);
      return context === null ? [] : [context];
    });
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
      documentPresentation(this.#app.metadataCache, file),
      this.#bibliographyRender.vaultPresentation,
      { citations: set.citations, works },
    );
    const presentation =
      presented.kind === "read" ? presented.presentation : null;
    const rendered =
      presentation === null
        ? null
        : await this.#settledRender(() =>
            this.#bibliographyRender.renderCitations(
              sources,
              items,
              presentation,
            ),
          );
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
      wikilinks: wikilinks.citations.length,
      items: items.length,
      entrySerials,
      formatted: [...formatted.values()].reduce(
        (count, occurrences) => count + occurrences.length,
        0,
      ),
    }));
    return {
      formatted,
      entrySerials,
      summaries: new Map(
        [...works].map(([indexedKey, { summary }]) => [indexedKey, summary]),
      ),
      literalWorks: literal,
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
    const rendered = await this.#settledRender(() =>
      this.#bibliographyRender.render(items, presentation),
    );
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

  /** Waits through a stale render and reads the record that replaced it. */
  async #settledRender<T>(
    read: () => Promise<HeldRenderOutcome<T>>,
  ): Promise<T | null> {
    let outcome = await read();
    while (
      outcome.kind === "held" &&
      outcome.record.status === "revalidating"
    ) {
      await outcome.record.settled;
      outcome = await read();
    }
    return outcome.kind === "held" ? outcome.record.value : null;
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
    };

    const runs = citationRuns(
      (this.#app.metadataCache.getFileCache(file)?.links ?? []).filter((link) =>
        members.has(link.position.start.offset),
      ),
      (link) => wikilinkCitation(link.link, context),
      (previous, next) =>
        body.slice(previous.position.end.offset, next.position.start.offset),
    );

    const cited: string[] = [];
    const citations: PlacedCitation[] = [];
    for (const run of runs) {
      for (const { citation } of run) {
        cited.push(citation.indexedKey);
      }
      const citation = citationOfRun(run);
      // A derivation the engine would read back as something else stays out of
      // the render and keeps its native wikilink presentation.
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
        identity: citationKey(citation),
      });
    }
    return { citations, cited };
  }

  /**
   * The cited works, read straight from the database so the surfaces keep
   * working while Zotero is closed.
   *
   * Citeproc matches a citation by the CSL `id`, and the identity a citation
   * names is its Item, so each work is handed over under its Indexed Key and
   * every render source names it by that key. Two Literature Notes for one
   * keyless Item, or a literal citekey beside a wikilink reaching the same
   * Item, therefore reach one entry — which is what lets a numbering style
   * count one physical source once.
   *
   * @see HeldCitation — why a citekey spelling identifies no Item.
   *
   * @param cited the Indexed Key of each work the document cites, in the order
   *   the document cites them; repeats are read once.
   * @returns the readable works by Indexed Key, in first-cited order.
   */
  #readCited(cited: readonly string[]): Map<string, CitedItem> {
    const works = new Map<string, CitedItem>();
    if (this.#db.state !== "ready" || cited.length === 0) return works;

    try {
      const client = this.#db.client;
      const user = getZoteroIdentity(client);
      for (const indexedKey of cited) {
        if (works.has(indexedKey)) continue;
        const selector = resolveIndexedKeyLibrary(client, indexedKey);
        if (!selector) continue;
        const item = getItemsByKey(client, selector.libraryID, [
          selector.key,
        ])[0];
        if (!item) continue;
        const { fields } = item;
        if (isChildItemFields(fields)) continue;

        const { title, subtitle } = itemSummary(item, fields);
        works.set(indexedKey, {
          csl: itemToCsl(item, user),
          summary: subtitle || title,
        });
      }
    } catch (error) {
      logger.warn("Cannot read the cited items", { error });
    }
    return works;
  }
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

/** What one document's Literature Note wikilinks cite. */
interface DocumentWikilinks {
  /** The Citations they write, one per Citation Run, in document order. */
  citations: PlacedCitation[];
  /**
   * The Indexed Key of every Item they cite, in document order — the two Items
   * of a shared spelling included, and a Citation no Pandoc source can name
   * included too, because its work still carries the summary a surface shows.
   */
  cited: string[];
}

/**
 * @param cited the document's Citations, over both syntaxes.
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
 * @param works the Item each literal citekey of the document names.
 */
function literalCitations(
  body: string,
  occurrences: readonly CitationOccurrence[],
  works: ReadonlyMap<string, string>,
): PlacedCitation[] {
  const members = new Set(
    occurrences
      .filter((occurrence) => occurrence.kind === "citekey")
      .map((occurrence) => occurrence.position.start.offset),
  );
  return scanDocumentCitations(body)
    .filter(({ keys }) => keys.every((key) => members.has(key.start)))
    .map(({ start, end, keys }) => {
      const source = body.slice(start, end);
      return {
        start,
        source,
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

  const named = namedByWork(citation.source, citation.keys, ids);
  if (ids.every((id) => id !== null)) {
    return {
      identity: citation.identity,
      start: citation.start,
      renderSource: named.source,
      complete: true,
    };
  }
  const members = resolvedMembers(named.source, named.keys, ids);
  if (members === null) return null;
  return {
    identity: citation.identity,
    start: citation.start,
    renderSource: members,
    complete: false,
  };
}

/**
 * `source` with every resolved key token rewritten to the Indexed Key of the
 * work it cites, which is the CSL `id` that work is handed to the engine under.
 *
 * A key span covers the complete citation token, the author-suppression `-`
 * included, so the marker is read off the source and written back. An Indexed
 * Key is letters and digits alone, so the rewritten token is always a Pandoc
 * key even where the spelling it replaces was not.
 *
 * @returns the rewritten source and the key spans relocated in it.
 */
function namedByWork(
  source: string,
  keys: readonly CitationKey[],
  ids: readonly (string | null)[],
): { source: string; keys: TextSpan[] } {
  const spans: TextSpan[] = [];
  let named = "";
  let read = 0;
  for (const [index, key] of keys.entries()) {
    const id = ids[index]!;
    named += source.slice(read, key.start);
    const start = named.length;
    named +=
      id === null
        ? source.slice(key.start, key.end)
        : `${source[key.start] === "-" ? "-" : ""}@${id}`;
    spans.push({ start, end: named.length });
    read = key.end;
  }
  return { source: named + source.slice(read), keys: spans };
}

/**
 * The cluster of `source` with its unresolved members cut out, so the resolved
 * ones still enter the document's render context.
 *
 * @returns null when `source` is no cluster the members can be cut out of.
 */
function resolvedMembers(
  source: string,
  keys: readonly TextSpan[],
  ids: readonly (string | null)[],
): string | null {
  if (!source.startsWith("[") || !source.endsWith("]")) return null;
  const separators: number[] = [];
  for (let index = 0; index < keys.length - 1; index += 1) {
    const separator = source.indexOf(";", keys[index]!.end);
    if (separator === -1 || separator >= keys[index + 1]!.start) return null;
    separators.push(separator);
  }
  const members: string[] = [];
  for (const [index, id] of ids.entries()) {
    if (id === null) continue;
    const from = index === 0 ? 1 : separators[index - 1]! + 1;
    const to =
      index === keys.length - 1 ? source.length - 1 : separators[index]!;
    members.push(source.slice(from, to).trim());
  }
  return `[${members.join("; ")}]`;
}

function documentCitationsEqual(
  prev: DocumentCitations,
  next: DocumentCitations,
): boolean {
  return (
    prev.entrySerials === next.entrySerials &&
    mapsEqual(prev.summaries, next.summaries, Object.is) &&
    mapsEqual(prev.literalWorks, next.literalWorks, Object.is) &&
    mapsEqual(prev.formatted, next.formatted, occurrencesEqual)
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
        JSON.stringify(occurrence.text) === JSON.stringify(next[index]!.text) &&
        occurrence.serials.length === next[index]!.serials.length &&
        occurrence.serials.every(
          (serial, at) => serial === next[index]!.serials[at],
        ),
    )
  );
}
