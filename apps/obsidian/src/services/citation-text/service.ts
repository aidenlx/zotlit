import { abortable } from "@std/async/abortable";
import { QueryObserver } from "@tanstack/query-core";
import type { TFile } from "obsidian";

// The formatted text of one document's Citations, held for every surface that shows them.
import type { CslItemData } from "@zotlit/db";
import {
  formatPandocCitation,
  scanPandocCitations,
} from "@zotlit/templates/pandoc-citation";
import type { ScannedPandocCitation } from "@zotlit/templates/pandoc-citation";

import {
  Cause,
  Context,
  Effect,
  Layer,
  PubSub,
  Scope,
  Stream,
  SubscriptionRef,
} from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import { obsidianEvents } from "@/lib/effect-obsidian-events";
import { acquireDisposable } from "@/lib/effect-scope";
import { changesUntil, forkEach } from "@/lib/effect-stream";
import { mapsEqual } from "@/lib/maps-equal";
import { ObsidianApp } from "@/lib/obsidian-app";
import { workspaceOpenDocuments } from "@/lib/open-documents";
import type { OpenDocuments } from "@/lib/open-documents";
import {
  citationOfRun,
  citationRuns,
  wikilinkCitation,
} from "@/lib/wikilink-citation";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import { renderParsedCitation } from "@/services/citation-index/parsed-note";
import { plainCitationIndex } from "@/services/citation-index/plain";
import type { NoteScanRecord } from "@/services/citation-index/scan-note";
import { CitationIndex } from "@/services/citation-index/service";
import type {
  Citation,
  CitationOccurrence,
  DocumentCitationSet,
} from "@/services/citation-index/service";
import { plainNoteIndex } from "@/services/note-index/plain";
import { NoteIndex } from "@/services/note-index/service";
import {
  documentCitationPresentation,
  documentPresentation,
} from "@/services/pandoc/document-presentation";
import { holdsNote } from "@/services/pandoc/inline-content";
import type { RenderPresentation } from "@/services/pandoc/render-cache";
import { BibliographyRender } from "@/services/pandoc/render-cache";
import { plainBibliographyRender } from "@/services/pandoc/render-cache/plain";
import { plainProfile } from "@/services/profile/plain";
import { Profile } from "@/services/profile/service";
import { plainQueryClients } from "@/services/query-client/plain";
import { QueryClients } from "@/services/query-client/service";
import type { Held } from "@/services/query-client/service";

import { citationKey, presentedCitationEqual } from "./present";
import type {
  CitationSource,
  DocumentCitations,
  FormattedOccurrence,
} from "./present";

export { type DocumentCitations } from "./present";

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

export type CitationTextEvent =
  /** What is held for one document changed or went stale. */
  | { readonly type: "changed"; readonly path: string }
  /** One document read committed, including an equal or failed read. */
  | {
      readonly type: "settled";
      readonly path: string;
      readonly held: Held<DocumentCitations> | null;
    }
  /** Every document's citation text went stale; a surface showing it asks again. */
  | { readonly type: "invalidated" };

export interface CitationTextState {
  readonly startup: "ready" | "failed";
  readonly stopped: boolean;
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
 * {@link CitationTextEvent} says what it holds no longer stands.
 */
export class CitationText extends Context.Service<
  CitationText,
  {
    readonly current: Effect.Effect<CitationTextState>;
    readonly changes: Stream.Stream<CitationTextState>;
    readonly events: Stream.Stream<CitationTextEvent>;
    peek(path: string): Effect.Effect<Held<DocumentCitations> | null>;
    read(
      path: string,
      options?: { signal?: AbortSignal },
    ): Effect.Effect<DocumentCitations | null, unknown>;
  }
>()("zotlit/citation-text/CitationText") {}

export const layerCitationText = (open?: OpenDocuments) =>
  Layer.effect(
    CitationText,
    Effect.gen(function* () {
      const app = yield* ObsidianApp;
      const index = yield* CitationIndex;
      const lookup = yield* CitationLookup;
      const notes = yield* NoteIndex;
      const renders = yield* BibliographyRender;
      yield* Profile;
      const queryService = yield* QueryClients;
      const scope = yield* Scope.fork(yield* Scope.Scope);
      const context = yield* Effect.context<
        CitationIndex | NoteIndex | BibliographyRender | Profile | QueryClients
      >();
      const run = Effect.runSyncWith(context);
      const runner = {
        scope,
        runSync: run,
        runPromiseExit: Effect.runPromiseExitWith(context),
        runFork: <A, E>(
          effect: Effect.Effect<
            A,
            E,
            | CitationIndex
            | NoteIndex
            | BibliographyRender
            | Profile
            | QueryClients
          >,
        ) => run(Effect.forkIn(effect, scope, { startImmediately: true })),
      };
      const citationIndex = plainCitationIndex(runner);
      const noteIndex = plainNoteIndex(runner);
      const bibliographyRender = plainBibliographyRender(runner);
      const profile = plainProfile(runner);
      const queries = plainQueryClients(runner);
      const openDocuments = open ?? workspaceOpenDocuments(app);
      /** Releases for the pins that keep each open document's text held. */
      const pins = new Map<string, () => void>();
      let stopped = false;
      const lifetime = new AbortController();
      const state = yield* SubscriptionRef.make<CitationTextState>({
        startup: "ready",
        stopped: false,
      });
      const bus = yield* Effect.acquireRelease(
        PubSub.unbounded<CitationTextEvent>(),
        PubSub.shutdown,
      ).pipe(Scope.provide(scope));
      const emit = (event: CitationTextEvent) => {
        if (!stopped) PubSub.publishUnsafe(bus, event);
      };
      const log = (
        level: "debug" | "warn",
        message: string,
        fields: Record<string, unknown> = {},
      ) =>
        run(
          (level === "debug"
            ? Effect.logDebug(message)
            : Effect.logWarning(message)
          ).pipe(Effect.annotateLogs(fields), withLogCategory("citation-text")),
        );
      // Stop work before the child scope removes subscriptions and releases pins.
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          stopped = true;
          lifetime.abort();
          queries.client.removeQueries({ queryKey: [CITATION_TEXT] });
          run(
            SubscriptionRef.update(state, (value) => ({
              ...value,
              stopped: true,
            })),
          );
        }),
      );

      /**
       * The citations held for one document, for a caller that cannot wait — the
       * editor builds its decorations synchronously.
       *
       * The peek resolves the file and starts the first or replacement read. A
       * stale answer stays available while that read runs.
       *
       * @returns null while the first read is pending.
       */
      function peek(path: string): Held<DocumentCitations> | null {
        if (stopped) return null;
        if (app.vault.getFileByPath(path) === null) {
          drop(path);
          return null;
        }
        void queries.ask(documentKey(path), ({ signal }) =>
          readPath(path, signal),
        );
        return queries.peek<DocumentCitations>(documentKey(path));
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
      async function read(
        path: string,
        { signal }: { signal?: AbortSignal } = {},
      ): Promise<DocumentCitations | null> {
        if (stopped) return null;
        const text = await queries.read(
          documentKey(path),
          ({ signal }) => readPath(path, signal),
          signal,
        );
        // A file deleted while its read ran holds nothing: the path is resolved
        // again here, because the read may have started before the file went.
        if (stopped) return null;
        if (app.vault.getFileByPath(path) !== null) return text;
        drop(path);
        return null;
      }

      /**
       * Marks one document's text stale, or every document's where no path names
       * one, and announces the scope the drop reached.
       */
      function invalidate(path?: string): void {
        if (stopped) return;
        const queryKey =
          path === undefined ? [CITATION_TEXT] : documentKey(path);
        // A document nothing has read stays quiet: an edit anywhere else in the
        // vault reaches no surface that shows citation text.
        if (
          path !== undefined &&
          queries.client.getQueryState(queryKey) === undefined
        ) {
          return;
        }
        queries.invalidate(queryKey);
        if (path === undefined) emit({ type: "invalidated" });
        else emit({ type: "changed", path });
      }

      /** Releases what one vault path holds, which a file no longer there must. */
      function drop(path: string): void {
        // The pin observes the query the removal discards; an open document pins
        // its next query on the following workspace change.
        pins.get(path)?.();
        pins.delete(path);
        queries.client.removeQueries({ queryKey: documentKey(path) });
      }

      /**
       * Keeps each open document's text out of garbage collection and lets a
       * closed one expire. A pin is a disabled observer: it holds the query
       * without reading, and every read still starts from a surface's ask.
       */
      function pinOpenDocuments(): void {
        if (stopped) return;
        const open = openDocuments.paths();
        for (const [path, release] of pins) {
          if (open.has(path)) continue;
          release();
          pins.delete(path);
        }
        for (const path of open) {
          if (pins.has(path)) continue;
          const observer = new QueryObserver(queries.client, {
            queryKey: documentKey(path),
            enabled: false,
          });
          const unsubscribe = observer.subscribe(() => undefined);
          pins.set(path, () => {
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
      async function readPath(
        path: string,
        querySignal: AbortSignal,
      ): Promise<DocumentCitations> {
        const signal = AbortSignal.any([querySignal, lifetime.signal]);
        signal.throwIfAborted();
        const file = app.vault.getFileByPath(path);
        if (file === null) {
          throw new Error(`No document to read the citations of at ${path}`);
        }
        try {
          return await readDocument(file, signal);
        } catch (error) {
          if (!signal.aborted)
            log("warn", "Cannot read the citations of a document", {
              path,
              error,
            });
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
      async function readDocument(
        file: TFile,
        signal: AbortSignal,
      ): Promise<DocumentCitations> {
        await abortable(noteIndex.whenIndexed(), signal);
        signal.throwIfAborted();
        const { facts, set } = await citationIndex.getParsedDocument(
          file,
          signal,
        );
        signal.throwIfAborted();
        const { source: body, record } = facts;
        const wikilinks = wikilinkCitations(file, body, set);
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
          documentPresentation(app.metadataCache, file, profile),
          bibliographyRender.vaultPresentation,
          { citations: set.citations, works },
        );
        const presentation =
          presented.kind === "read" ? presented.presentation : null;
        const rendered =
          presentation === null
            ? null
            : await bibliographyRender.readCitations(sources, items, {
                presentation,
                signal,
              });
        signal.throwIfAborted();
        // A style whose citations are footnotes leaves a note in the rendered
        // content, which no surface can show. That output — not the style — is
        // what puts the whole document on Entry Serials.
        const entrySerials =
          rendered?.some(({ content }) => holdsNote(content)) ?? false;
        const serials =
          presented.kind === "read" && entrySerials
            ? await readSerials(presented.items, works, {
                presentation: presented.presentation,
                signal,
              })
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
            if (occurrences === undefined)
              formatted.set(identity, [occurrence]);
            else occurrences.push(occurrence);
          });
        }
        log("debug", "Document citations read", {
          path: file.path,
          citations: sources.length,
          wikilinks: wikilinks.length,
          items: items.length,
          entrySerials,
          formatted: [...formatted.values()].reduce(
            (count, occurrences) => count + occurrences.length,
            0,
          ),
        });
        return {
          ...(presented.kind === "unusable" && presented.property === "profile"
            ? { presentationFailure: presented }
            : {}),
          formatted,
          entrySerials,
          summaries: new Map(
            [...works].map(([indexedKey, { summary }]) => [
              indexedKey,
              summary,
            ]),
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
      async function readSerials(
        items: readonly CslItemData[],
        works: ReadonlyMap<string, CitedItem>,
        {
          presentation,
          signal,
        }: { presentation: RenderPresentation; signal: AbortSignal },
      ): Promise<ReadonlyMap<string, number>> {
        const serials = new Map<string, number>();
        const rendered = await bibliographyRender.readBibliography(items, {
          presentation,
          signal,
        });
        signal.throwIfAborted();
        if (rendered === null) {
          log("debug", "Cannot number the cited entries");
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
      function wikilinkCitations(
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
                  const note = app.metadataCache.getFirstLinkpathDest(
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
            body.slice(
              previous.position.end.offset,
              next.position.start.offset,
            ),
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
      yield* Effect.gen(function* () {
        queries.client.setQueryDefaults([CITATION_TEXT], {
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
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            for (const release of pins.values()) release();
            pins.clear();
          }),
        );
        const intake = yield* obsidianEvents<{
          changed: [TFile];
          deleted: [TFile];
          open: [];
        }>();
        yield* intake
          .consume((event) =>
            Effect.sync(() => {
              if (event.type === "changed") invalidate(event.args[0].path);
              else if (event.type === "deleted") drop(event.args[0].path);
              else pinOpenDocuments();
            }),
          )
          .pipe(Effect.forkScoped({ startImmediately: true }));
        // A locator or prefix can change without moving the indexed citekeys.
        // Metadata changes therefore invalidate this document's render too.
        yield* intake.on("changed", app.metadataCache, "changed");
        yield* intake.on("deleted", app.metadataCache, "deleted");
        yield* acquireDisposable(() =>
          openDocuments.subscribe(intake.callback("open")),
        );
        const initialSettlement = yield* queryService.current;
        yield* forkEach(
          Stream.dropWhile(
            queryService.changes,
            (next) => next === initialSettlement,
          ),
          (change) => {
            if (change.key[0] !== CITATION_TEXT) return;
            const path = pathOf(change.key);
            if (change.changed) emit({ type: "changed", path });
            emit({
              type: "settled",
              path,
              held: change.held as Held<DocumentCitations> | null,
            });
          },
        );
        yield* forkEach(index.events, (event) => {
          if (event.type === "membership-changed") invalidate();
          else if (event.type === "changed") invalidate(event.path);
        });
        // A moved Literature Note or the first Full Scan can change the Item
        // a wikilink resolves to across every document.
        const initialNotes = yield* notes.current;
        yield* forkEach(
          Stream.dropWhile(notes.changes, (next) => next === initialNotes),
          (event) => {
            if (event.type === "changed" || event.type === "indexed")
              invalidate();
          },
        );
        // A rebuilt lookup snapshot can change literal keys and the native
        // citation key carried by a wikilink's Literature Note.
        let revision = (yield* lookup.current).revision;
        yield* forkEach(lookup.changes, (next) => {
          if (revision === next.revision) return;
          revision = next.revision;
          invalidate();
        });
        yield* forkEach(renders.events, (event) => {
          if (event._tag === "invalidated") invalidate();
        });
        // Install every subscription before this fallible host read. A later
        // workspace event can retry the pins if the initial read fails.
        pinOpenDocuments();
      }).pipe(
        Scope.provide(scope),
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause)
            ? Effect.interrupt
            : Effect.gen(function* () {
                yield* SubscriptionRef.set(state, {
                  startup: "failed" as const,
                  stopped: false,
                });
                yield* Effect.logError(
                  "Could not start citation text",
                  cause,
                ).pipe(withLogCategory("citation-text"));
              }),
        ),
      );
      return {
        current: SubscriptionRef.get(state),
        // Terminal state ends the stream itself, so a late subscriber still
        // receives that snapshot after scope close.
        changes: changesUntil(state, Effect.never).pipe(
          Stream.takeUntil((value) => value.stopped),
        ),
        events: Stream.fromPubSub(bus),
        peek: Effect.fn("CitationText.peek")(function* (path: string) {
          return yield* Effect.sync(() => peek(path));
        }),
        read: Effect.fn("CitationText.read")(function* (
          path: string,
          options?: { signal?: AbortSignal },
        ) {
          return yield* Effect.tryPromise({
            try: () => read(path, options),
            catch: (error) => error,
          });
        }),
      };
    }),
  );

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
