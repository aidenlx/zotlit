import { it } from "@effect/vitest";
import { abortable } from "@std/async/abortable";
import { Context } from "effect";
import { Effect, Stream } from "effect";
import { TestClock } from "effect/testing";
import { TFile } from "obsidian";
import type { EventRef, LinkCache } from "obsidian";
import { describe, expect, vi } from "vitest";

import { testEvent } from "@/lib/__fixtures__/event-stream";
import type { HostSources } from "@/lib/__fixtures__/obsidian-host-app";
import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { OpenDocumentsStub } from "@/lib/__fixtures__/open-documents";
import { stubService } from "@/lib/__fixtures__/service-stub";
import {
  FIELD_LITERATURE_NOTE_PROFILE,
  FIELD_ZOTERO_NOTE_KEY,
} from "@/lib/constants";
import { subscribe } from "@/lib/effect-stream";
import type { MetadataCacheSource } from "@/lib/obsidian-metadata-cache";
import { annotationRows } from "@/services/citation-index/__fixtures__/annotations";
import { lookupAnswer } from "@/services/citation-index/__fixtures__/lookup";
// @vitest-environment happy-dom
import { ParsedNote } from "@/services/citation-index/parsed-note";
import { scanNote } from "@/services/citation-index/scan-note";
import type {
  Citation,
  CitationOccurrence,
  DocumentCitationSet,
} from "@/services/citation-index/service";
import { readReferenceSources } from "@/services/citation-index/sources";
import {
  createCitationIndexHarness,
  DatabaseStub,
  GROUP_LIBRARY_ID,
  MY_LIBRARY_ID,
} from "@/services/citation-index/test-harness";
import { inProcessParseClient } from "@/services/citation-parse/in-process";
import type { ManagedBinaryApi } from "@/services/managed-binary/service";
import type {
  BibliographyRequest,
  CitationEngine,
  RenderedCitation,
} from "@/services/pandoc/engine";
import { bibliographyRenderFixture } from "@/services/pandoc/render-cache/__fixtures__";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import {
  queryClientsFixture,
  queryClientsOf,
} from "@/services/query-client/__fixtures__";
import type { PlainQueryClients } from "@/services/query-client/plain";
import type { Held } from "@/services/query-client/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import {
  citedWorkSeed,
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import {
  ALPHA_KEY,
  citation,
  firstText,
  literalOccurrences,
  noted,
  occurrenceTexts,
  rendered,
} from "./__fixtures__";
import { citationTextFixture } from "./__fixtures__";
import type {
  CitationTextFixture as CitationText,
  CitationTextFixtureDeps as CitationTextDeps,
} from "./__fixtures__";
import { citationKey, literalSummaryOf } from "./present";
import type { DocumentCitations, FormattedOccurrence } from "./present";

const NOTE = Object.assign(new TFile(), { path: "note.md" });

/**
 * The Indexed Key a Literature Note stand-in carries. It names an Item of its
 * own, so a wikilink and a literal citekey are told apart by what they reach.
 */
const LIT_KEY = "BETA5678";

interface Harness {
  service: CitationText;
  citationRequests: { citations: readonly string[] }[];
  /** The CSL ids of every bibliography render the read asked for, in order. */
  bibliographyRequests: string[][];
  /** Fires the Citation Index's own event for one document. */
  indexChanged: (path: string) => void;
  /** Fires the render cache's wholesale drop. */
  rendersInvalidated: () => void;
  /** Fires the Note Index's report that a Literature Note moved. */
  resolutionChanged: () => void;
  /** Fires the Citation Index's report that the resolution snapshot rebuilt. */
  citekeyResolutionChanged: () => void;
  /** Fires Obsidian's own metadata event for one file. */
  metadataChanged: (path: string) => void;
  /** Deletes the document, as Obsidian reports a file the vault no longer has. */
  deleteNote: () => void;
  /** The client the text is held on, for reading what one path holds. */
  queryClient: PlainQueryClients & AsyncDisposable;
  /** How many cited-item reads the database answered or failed. */
  readonly itemReads: number;
  /** Fails the next cited-item read, as a locked database would. */
  failNextItemRead: () => void;
  dispose: () => Promise<void>;
}

async function makeHarness({
  body,
  cited = [citation("alpha", ALPHA_KEY)],
  formats = true,
  formatCitations,
  bibliography,
  links = [],
  notes = {},
  frontmatter = {},
  settings = {},
  documentCitationSet,
  bibliographyRender,
  queryClient = queryClientsFixture(),
  workspace,
  openDocuments = workspace ? undefined : new OpenDocumentsStub(),
  context = Context.empty(),
}: {
  body: string;
  cited?: Citation[];
  /** Whether an engine is installed, which is what the cache answers for. */
  formats?: boolean;
  /** A render-cache answer used when a test needs generation control. */
  formatCitations?: (
    citations: readonly string[],
    signal?: AbortSignal,
  ) => Promise<readonly RenderedCitation[] | null>;
  /**
   * The works the bibliography renders an entry for, in bibliography order,
   * out of the works it was asked for. Defaults to all of them in that same
   * order; `null` for a render that cannot answer at all.
   */
  bibliography?: (ids: readonly string[]) => readonly string[] | null;
  /** The wikilinks Obsidian's metadata cache reports for the document. */
  links?: LinkCache[];
  /** The Literature Note each linkpath names, by linkpath. */
  notes?: Record<string, { citekey: string | undefined }>;
  /** The document properties read by its Citation Presentation. */
  frontmatter?: Record<string, unknown>;
  settings?: Partial<Settings>;
  documentCitationSet?: Pick<
    DocumentCitationSet,
    "occurrences" | "citations" | "errors"
  >;
  bibliographyRender?: CitationTextDeps["bibliographyRender"];
  queryClient?: PlainQueryClients & AsyncDisposable;
  /** The workspace whose Markdown leaves are the open documents, in place of `openDocuments`. */
  workspace?: MemoryWorkspace;
  openDocuments?: OpenDocumentsStub;
  context?: Context.Context<never>;
}): Promise<Harness> {
  const citationRequests: { citations: readonly string[] }[] = [];
  const bibliographyRequests: string[][] = [];
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const native = new Map<string, ReturnType<typeof testEvent<unknown>>>();
  const stream = <A>(key: string): Stream.Stream<A> => {
    const source = native.get(key) ?? testEvent<unknown>();
    native.set(key, source);
    return source.stream as Stream.Stream<A>;
  };
  const fire = (key: string, payload?: unknown): void => {
    listeners.get(key)?.(payload);
    native.get(key)?.emit(payload);
  };
  const wikilinkOccurrences: CitationOccurrence[] =
    settings["citation.wikilink-citations"] === true
      ? scanNote(body).wikilinks
      : [];
  const set = documentCitationSet ?? {
    occurrences: [...literalOccurrences(body), ...wikilinkOccurrences].sort(
      (a, b) => a.position.start.offset - b.position.start.offset,
    ),
    citations: [
      ...cited,
      ...(wikilinkOccurrences.length > 0
        ? [
            {
              indexedKey: LIT_KEY,
              linkpath: wikilinkOccurrences[0]!.raw,
              refNumber: cited.length + 1,
              occurrences: wikilinkOccurrences.filter((occurrence) =>
                Object.hasOwn(notes, occurrence.raw),
              ),
            },
          ]
        : []),
    ],
    errors: [],
  };
  const metadataCache: MetadataCacheSource = {
    getFileCache: (file) =>
      file.path === NOTE.path
        ? { links, frontmatter }
        : { frontmatter: { "zotero-key": LIT_KEY } },
    getFirstLinkpathDest: (linkpath) =>
      Object.hasOwn(notes, linkpath)
        ? Object.assign(new TFile(), { path: `${linkpath}.md` })
        : null,
    onCleanCache: (callback) => callback(),
    on: (name, callback) => {
      listeners.set(`metadata:${name}`, (...args) =>
        Reflect.apply(callback, undefined, args),
      );
      return stubService<EventRef>("EventRef", {});
    },
    offref: () => {},
  };
  const vault = MemoryVault.with({
    cachedRead: () => Promise.resolve(body),
    getFileByPath: (path: string) =>
      present && path === NOTE.path ? NOTE : null,
  });
  const host: HostSources = { metadataCache, vault, workspace };

  let present = true;
  let itemReads = 0;
  let failNextItemRead = false;
  // The cited work and the Literature Note stand-in are two copies of one work.
  const reads = inProcessReadsService(
    memoryOpener(() => citedWorkSeed([ALPHA_KEY, LIT_KEY])).open,
    {
      wrap: (client) =>
        new Proxy(client, {
          get(target, key, receiver) {
            if (key !== "ItemsByIndexedKeys")
              return Reflect.get(target, key, receiver);
            return (
              ...args: Parameters<ZoteroReadsClient["ItemsByIndexedKeys"]>
            ) =>
              Effect.suspend(() => {
                itemReads += 1;
                if (!failNextItemRead)
                  return target.ItemsByIndexedKeys(...args);
                failNextItemRead = false;
                return Effect.fail(
                  new DbUnavailable({ message: "database is locked" }),
                );
              });
          },
        }),
    },
  );
  const service = citationTextFixture(
    {
      openDocuments,
      citationLookup: {
        changed: stream("lookup:changed"),
      },
      host,
      citationIndex: {
        getParsedDocument: async () => ({
          facts: new ParsedNote(
            body,
            (
              await Effect.runPromise(
                inProcessParseClient.parse({
                  path: NOTE.path,
                  generation: 0,
                  text: body,
                }),
              )
            ).record,
          ),
          set: {
            ...set,
            ...(await readReferenceSources(reads, set.citations)),
            syntaxes: {
              citekey: "included" as const,
              wikilink: "excluded" as const,
              annotation: "included" as const,
            },
            omittedSyntaxes: [],
            coverage: "complete" as const,
            lookup: lookupAnswer(
              {},
              { [LIT_KEY]: Object.values(notes)[0]?.citekey ?? null },
            ),
          },
        }),
        changed: stream("index:changed"),
        "membership-changed": stream("index:membership-changed"),
      },
      noteIndex: {
        changed: stream("notes:changed"),
        indexed: stream("notes:indexed"),
        whenIndexed: () => Promise.resolve(),
      },
      bibliographyRender: bibliographyRender ?? {
        vaultPresentation: { styleId: null, locale: null },
        readCitations: async (
          citations: readonly string[],
          _items: unknown,
          options?: { signal?: AbortSignal },
        ) => {
          citationRequests.push({ citations });
          return formatCitations
            ? await formatCitations(citations, options?.signal)
            : formats
              ? citations.map((source) => rendered(`«${source}»`))
              : null;
        },
        readBibliography: (items: readonly { id: string }[]) => {
          const ids = items.map(({ id }) => id);
          bibliographyRequests.push(ids);
          const entries = bibliography ? bibliography(ids) : ids;
          return Promise.resolve(
            entries === null
              ? null
              : {
                  entries: entries.map((id) => ({
                    id,
                    marker: undefined,
                    content: [],
                  })),
                  hasEntryMarkers: false,
                },
          );
        },
        invalidated: stream("render:invalidated"),
      },
      profile: profileReader({ ...defaults, ...settings }, metadataCache),
      queryClient,
    },
    context,
  );

  return {
    service,
    citationRequests,
    bibliographyRequests,
    indexChanged: (path) => fire("index:changed", path),
    rendersInvalidated: () => fire("render:invalidated"),
    resolutionChanged: () => fire("notes:changed"),
    citekeyResolutionChanged: () => fire("lookup:changed"),
    metadataChanged: (path) => fire("metadata:changed", { path }),
    deleteNote: () => {
      present = false;
      fire("metadata:deleted", NOTE);
    },
    queryClient,
    get itemReads() {
      return itemReads;
    },
    failNextItemRead: () => {
      failNextItemRead = true;
    },
    dispose: async () => {
      await service[Symbol.asyncDispose]();
      await queryClient[Symbol.asyncDispose]();
      await reads[Symbol.asyncDispose]();
    },
  };
}

async function readText(service: CitationText): Promise<DocumentCitations> {
  let held = service.peek(NOTE.path);
  if (held === null) {
    await new Promise<void>((resolve) => {
      const unsubscribe = subscribe(
        service.runtime,
        service.settled,
        ({ path }) => {
          if (path !== NOTE.path) return;
          unsubscribe();
          resolve();
        },
      );
    });
    held = service.peek(NOTE.path);
  }
  if (held === null) throw new Error("citation text missing");
  await held.settled;
  return service.peek(NOTE.path)?.value ?? held.value;
}

describe("CitationText", () => {
  it.effect(
    "exposes settled startup state to a subscriber after acquisition (#1705)",
    () =>
      Effect.promise(async () => {
        const h = await makeHarness({ body: "[@alpha]" });
        try {
          const state = await h.service.runtime.runPromise(
            Stream.runCollect(h.service.changes.pipe(Stream.take(1))),
          );
          expect(state).toEqual([{ startup: "ready", stopped: false }]);
          expect(h.citationRequests).toEqual([]);
          expect(h.service.peek(NOTE.path)).toBeNull();
          expect((await h.service.read(NOTE.path))?.formatted.size).toBe(1);
        } finally {
          await h.dispose();
        }
      }),
  );
  it.effect("renders a citation after a currency opener (#1694)", () =>
    Effect.promise(async () => {
      const occurrence: CitationOccurrence = {
        kind: "citekey",
        raw: "alpha",
        position: {
          start: { line: 0, col: 4, offset: 4 },
          end: { line: 0, col: 10, offset: 10 },
        },
      };
      const h = await makeHarness({
        body: "$5 [@alpha] x$",
        documentCitationSet: {
          occurrences: [occurrence],
          citations: [{ ...citation("alpha"), occurrences: [occurrence] }],
          errors: [],
        },
      });
      try {
        const held = await h.service.read(NOTE.path);
        expect(firstText(held?.formatted.get("[@alpha]"))).toBe(
          "«[@ALPHA234]»",
        );
      } finally {
        await h.dispose();
      }
    }),
  );

  it.effect(
    "retries a failed resolution snapshot through a document read after the cooldown",
    () =>
      Effect.promise(async () => {
        await using cleanup = new AsyncDisposableStack();
        const db = new DatabaseStub({ readyImmediately: false });
        const h = cleanup.use(
          await createCitationIndexHarness(
            { "draft.md": "@doe2024" },
            { db, notes: false },
          ),
        );
        h.citekeys.error = new Error("snapshot database locked");
        db.settle();
        await h.lookup.whenResolved();
        await expect(h.index.getDocumentCitationSet(h.draft)).rejects.toThrow(
          "snapshot database locked",
        );
        const service = cleanup.use(
          citationTextFixture({
            openDocuments: new OpenDocumentsStub(),
            host: h.host,
            citationIndex: h.index,
            citationLookup: h.lookup,
            noteIndex: h.noteIndex,
            profile: profileReader(),
            queryClient: h.queryClient,
            bibliographyRender: {
              vaultPresentation: { styleId: null, locale: null },
              readCitations: async (sources: readonly string[]) =>
                sources.map((source) => rendered(source)),
              readBibliography: async () => ({
                entries: [],
                hasEntryMarkers: false,
              }),
              invalidated: Stream.empty,
            } satisfies CitationTextDeps["bibliographyRender"],
          }),
        );

        expect(await service.read(h.draft.path)).toBeNull();
        const reads = h.citekeys.calls.length;
        h.citekeys.error = null;
        expect(await service.read(h.draft.path)).toBeNull();
        expect(h.citekeys.calls).toHaveLength(reads);
        h.passCooldown();

        expect((await service.read(h.draft.path))?.formatted.size).toBe(1);
        expect(service.peek(h.draft.path)?.status).toBe("fresh");
        // The retry reads each Library in the scope once.
        expect(h.citekeys.calls.slice(reads)).toEqual([
          MY_LIBRARY_ID,
          GROUP_LIBRARY_ID,
        ]);
      }),
  );

  it.effect.each(["first read", "replacement"] as const)(
    "retries a failed item read after the cooldown for a %s",
    (kind) =>
      Effect.gen(function* () {
        const queryClient = yield* queryClientsOf();
        const context = yield* Effect.context<never>();
        return yield* Effect.promise(async () => {
          await using cleanup = new AsyncDisposableStack();
          const h = cleanup.adopt(
            await makeHarness({ body: "@alpha", queryClient, context }),
            (h) => h.dispose(),
          );
          const first =
            kind === "replacement" ? await h.service.read(NOTE.path) : null;
          h.failNextItemRead();
          if (kind === "replacement") h.metadataChanged(NOTE.path);

          expect(await h.service.read(NOTE.path)).toBe(first);
          expect(h.service.peek(NOTE.path)?.status ?? null).toBe(
            kind === "replacement" ? "failed" : null,
          );
          await h.service.read(NOTE.path);
          expect(h.itemReads).toBe(kind === "replacement" ? 2 : 1);
          await queryClient.passCooldown();

          expect((await h.service.read(NOTE.path))?.formatted.size).toBe(1);
          expect(h.service.peek(NOTE.path)?.status).toBe("fresh");
          expect(h.itemReads).toBe(kind === "replacement" ? 3 : 2);
        });
      }),
  );

  it.effect.each([
    { kind: "first read", format: "citation" },
    { kind: "replacement", format: "citation" },
    { kind: "first read", format: "bibliography" },
    { kind: "replacement", format: "bibliography" },
  ] as const)(
    "retries a failed $format render after the cooldown for a $kind",
    ({ kind, format }) =>
      Effect.gen(function* () {
        const queryClient = yield* queryClientsOf();
        const context = yield* Effect.context<never>();
        return yield* Effect.promise(async () => {
          await using cleanup = new AsyncDisposableStack();
          let fails = kind === "first read";
          const renderCitations = vi.fn(async () => {
            if (fails && format === "citation")
              throw new Error("temporary render failure");
            return [
              format === "citation"
                ? rendered("Recovered citation")
                : noted(`@${ALPHA_KEY}`),
            ];
          });
          const renderBibliography = vi.fn(
            async ({ items }: BibliographyRequest) => {
              if (fails && format === "bibliography")
                throw new Error("temporary render failure");
              return items.map(({ id }) => ({
                id,
                marker: undefined,
                content: [],
              }));
            },
          );
          const failedRender =
            format === "citation" ? renderCitations : renderBibliography;
          const bibliographyRender = cleanup.use(
            await bibliographyRenderFixture(
              {
                queryClient,
                profile: { changed: Stream.empty },
                db: {
                  changed: Stream.empty,
                  degraded: Stream.empty,
                  "refresh-failed": Stream.empty,
                  refreshing: Stream.empty,
                  "db-file-missing": Stream.empty,
                  "refresh-requested": Stream.empty,
                },
                zoteroPref: {
                  dataDir: "/unused",
                  changed: Stream.empty,
                  "data-dir-changed": Stream.empty,
                  "resolved-changed": Stream.empty,
                },
                settings: {
                  current: Effect.succeed(defaults),
                  changes: Stream.empty,
                },
                pandocEngine: {
                  binary: stubService<ManagedBinaryApi<CitationEngine>>(
                    "PandocEngine",
                    {
                      getStatus: Effect.succeed({
                        kind: "installed",
                        version: "3.10",
                        binary: {
                          directory: "pandoc-engine",
                          name: "pandoc.wasm",
                        },
                      }),
                      changes: Stream.empty,
                      getEngine: Effect.succeed(
                        stubService<CitationEngine>("CitationEngine", {
                          renderCitations,
                          renderBibliography,
                        }),
                      ),
                    },
                  ),
                },
              },
              context,
            ),
          );
          const h = cleanup.adopt(
            await makeHarness({
              body: "@alpha",
              bibliographyRender,
              queryClient,
              context,
            }),
            (h) => h.dispose(),
          );
          const first =
            kind === "replacement" ? await h.service.read(NOTE.path) : null;
          if (kind === "replacement") {
            fails = true;
            queryClient.invalidate(["citation-render"]);
            queryClient.invalidate(["bibliography-render"]);
            h.metadataChanged(NOTE.path);
          }

          expect(await h.service.read(NOTE.path)).toBe(first);
          expect(h.service.peek(NOTE.path)?.status ?? null).toBe(
            kind === "replacement" ? "failed" : null,
          );
          fails = false;
          await h.service.read(NOTE.path);
          expect(failedRender).toHaveBeenCalledTimes(
            kind === "replacement" ? 2 : 1,
          );
          await queryClient.passCooldown();

          const recovered = await h.service.read(NOTE.path);
          expect(recovered?.formatted.size).toBe(1);
          expect(recovered?.entrySerials).toBe(format === "bibliography");
          expect(h.service.peek(NOTE.path)?.status).toBe("fresh");
          expect(failedRender).toHaveBeenCalledTimes(
            kind === "replacement" ? 3 : 2,
          );
        });
      }),
  );

  it.effect(
    "hands the settled read to the surfaces, text and status alike",
    () =>
      Effect.promise(async () => {
        const { service, dispose } = await makeHarness({
          body: "Blah [@alpha].",
        });
        const settlements: (Held<DocumentCitations> | null)[] = [];
        subscribe(service.runtime, service.settled, ({ path, held }) => {
          if (path === NOTE.path) settlements.push(held);
        });

        await readText(service);

        expect(settlements).toHaveLength(1);
        expect(settlements[0]).toMatchObject({ status: "fresh" });
        expect(firstText(settlements[0]!.value.formatted.get("[@alpha]"))).toBe(
          `«[@${ALPHA_KEY}]»`,
        );
        await dispose();
      }),
  );

  it.effect("reads one document once, however many surfaces ask", () =>
    Effect.promise(async () => {
      const { service, citationRequests, dispose } = await makeHarness({
        body: "One [@alpha].\n\nTwo [@alpha].",
      });

      await readText(service);
      await readText(service);

      expect(citationRequests).toHaveLength(1);
      await dispose();
    }),
  );

  it.effect("names each cited work by its summary", () =>
    Effect.promise(async () => {
      const { service, dispose } = await makeHarness({
        body: "Blah [@alpha].",
        formats: false,
      });

      const text = await readText(service);

      expect(literalSummaryOf(text)("alpha")).toBe("Zeta (2020)");
      expect(text.formatted.size).toBe(0);
      await dispose();
    }),
  );

  it.effect(
    "keeps a citation whose key reaches no item out of the render",
    () =>
      Effect.promise(async () => {
        const { service, citationRequests, dispose } = await makeHarness({
          body: "@ghost and [@ghost; @alpha].",
          cited: [citation("ghost", null)],
        });

        await readText(service);

        expect(citationRequests).toEqual([{ citations: [] }]);
        await dispose();
      }),
  );

  it.effect(
    "holds every occurrence of one source at the place the document writes it",
    () =>
      Effect.promise(async () => {
        const body = "First [@alpha]. Then [@alpha].";
        const { service, dispose } = await makeHarness({
          body,
          // Stands in for a position-dependent style, which renders the second
          // occurrence of a source as the subsequent form.
          formatCitations: (sources) =>
            Promise.resolve(
              sources.map((source, index) =>
                rendered(index === 0 ? `«${source}»` : "ibid."),
              ),
            ),
        });

        const { formatted } = await readText(service);

        expect(formatted.get("[@alpha]")?.map(({ start }) => start)).toEqual([
          body.indexOf("[@alpha]"),
          body.lastIndexOf("[@alpha]"),
        ]);
        expect(occurrenceTexts(formatted.get("[@alpha]"))).toEqual([
          `«[@${ALPHA_KEY}]»`,
          "ibid.",
        ]);
        await dispose();
      }),
  );

  it.effect("withholds a generation whose render result is incomplete", () =>
    Effect.promise(async () => {
      const { service, dispose } = await makeHarness({
        body: "First [@alpha], then [see @alpha, p. 3].",
        formatCitations: async ([first]) => [rendered(`«${first}»`)],
      });

      const { formatted } = await readText(service);

      expect(formatted.size).toBe(0);
      await dispose();
    }),
  );
});

describe("CitationText over wikilink Citations", () => {
  /** The Literature Note the wikilink suites cite, and its citekey. */
  const LIT = "literatures/alpha";
  const notes: Record<string, { citekey: string | undefined }> = {
    [LIT]: { citekey: "alpha" },
  };
  /** Wikilink Citations, which a fragment-less link needs to be a Citation. */
  const WIKILINK_CITATIONS = { "citation.wikilink-citations": true } as const;

  /** One `[[…]]` of the document, as Obsidian's metadata cache reports it. */
  function link(target: string, start: number, original?: string): LinkCache {
    const raw = original ?? `[[${target}]]`;
    return {
      link: target,
      original: raw,
      position: {
        start: { line: 0, col: start, offset: start },
        end: { line: 0, col: start + raw.length, offset: start + raw.length },
      },
    };
  }

  it.effect.each([
    { target: LIT, citekey: "alpha", spelling: "alpha" },
    {
      target: "literatures/Doe.v.Roe",
      citekey: undefined,
      spelling: "Doe.v.Roe",
    },
  ])(
    "renders a fragment-carrying wikilink to $target as the citekey cluster it equals",
    ({ target, citekey, spelling }) =>
      Effect.promise(async () => {
        const body = `Claim [[${target}#cite:locator=4]].`;
        const { service, citationRequests, dispose } = await makeHarness({
          body,
          cited: [],
          links: [link(`${target}#cite:locator=4`, body.indexOf("[["))],
          notes: { [target]: { citekey } },
          settings: WIKILINK_CITATIONS,
        });

        const { formatted } = await readText(service);

        expect(citationRequests).toEqual([
          { citations: [`[@${LIT_KEY}, {p. 4}]`] },
        ]);
        expect(
          firstText(
            formatted.get(
              citationKey({
                source: `[@${spelling}, {p. 4}]`,
                works: [LIT_KEY],
              }),
            ),
          ),
        ).toBe(`«[@${LIT_KEY}, {p. 4}]»`);
        await dispose();
      }),
  );

  it.effect("renders a Citation Run as one grouped citation", () =>
    Effect.promise(async () => {
      const body = `Both [[${LIT}#cite:locator=4]]; [[${LIT}]].`;
      const first = body.indexOf("[[");
      const { service, citationRequests, dispose } = await makeHarness({
        body,
        cited: [],
        links: [
          link(`${LIT}#cite:locator=4`, first),
          link(LIT, body.lastIndexOf("[[")),
        ],
        notes,
        settings: WIKILINK_CITATIONS,
      });

      await readText(service);

      expect(citationRequests).toEqual([
        { citations: [`[@${LIT_KEY}, {p. 4}; @${LIT_KEY}]`] },
      ]);
      await dispose();
    }),
  );

  it.effect(
    "keeps a fragment-less member in the render context while presentation is off",
    () =>
      Effect.promise(async () => {
        const body = `Claim [[${LIT}]].`;
        const { service, citationRequests, dispose } = await makeHarness({
          body,
          cited: [],
          links: [link(LIT, body.indexOf("[["))],
          notes,
          settings: {
            "citation.wikilink-citations": true,
            "citation.show-formatted": false,
          },
        });

        await readText(service);

        expect(citationRequests).toEqual([{ citations: [`[@${LIT_KEY}]`] }]);
        await dispose();
      }),
  );

  it.effect("renders both syntaxes in one batch, in document order", () =>
    Effect.promise(async () => {
      const body = `Wikilink [[${LIT}#cite:locator=5]] then citekey [@alpha, p. 6].`;
      const { service, citationRequests, dispose } = await makeHarness({
        body,
        links: [link(`${LIT}#cite:locator=5`, body.indexOf("[["))],
        notes,
        settings: WIKILINK_CITATIONS,
      });

      await readText(service);

      expect(citationRequests).toEqual([
        { citations: [`[@${LIT_KEY}, {p. 5}]`, `[@${ALPHA_KEY}, p. 6]`] },
      ]);
      await dispose();
    }),
  );

  // An Item with no native citation key falls back to its note's filename,
  // and no Pandoc key carries the space in one.
  it.effect(
    "keeps a Citation no Pandoc source can name out of the render",
    () =>
      Effect.promise(async () => {
        const SPACED = "literatures/Doe 2020";
        const body = `Claim [[${SPACED}]].`;
        const { service, citationRequests, dispose } = await makeHarness({
          body,
          cited: [],
          links: [link(SPACED, body.indexOf("[["))],
          notes: { [SPACED]: { citekey: undefined } },
          settings: WIKILINK_CITATIONS,
        });

        await readText(service);

        expect(citationRequests).toEqual([{ citations: [] }]);
        await dispose();
      }),
  );

  it.effect("summarizes a wikilink-cited work under the Item it names", () =>
    Effect.promise(async () => {
      const body = `Claim [[${LIT}]].`;
      const { service, dispose } = await makeHarness({
        body,
        cited: [],
        links: [link(LIT, body.indexOf("[["))],
        notes,
        settings: WIKILINK_CITATIONS,
        formats: false,
      });

      const { summaries } = await readText(service);

      expect(summaries.get(LIT_KEY)).toBe("Zeta (2020)");
      await dispose();
    }),
  );

  // A wikilink names its own works, so its citekey must not answer for a
  // literal key of the same spelling that reaches no Item at all.
  it.effect("keeps a derived citekey out of the literal join", () =>
    Effect.promise(async () => {
      const body = `Claim [[${LIT}]], and @alpha reaches nothing.`;
      const { service, dispose } = await makeHarness({
        body,
        cited: [citation("alpha", null)],
        links: [link(LIT, body.indexOf("[["))],
        notes,
        settings: WIKILINK_CITATIONS,
        formats: false,
      });

      const text = await readText(service);

      expect(text.summaries.get(LIT_KEY)).toBe("Zeta (2020)");
      expect(literalSummaryOf(text)("alpha")).toBeUndefined();
      await dispose();
    }),
  );
});

describe("CitationText staleness", () => {
  it.effect(
    "does not publish a generation superseded while its render was running",
    () =>
      Effect.promise(async () => {
        let finishFirst:
          | ((value: readonly RenderedCitation[]) => void)
          | undefined;
        let generation = 0;
        const { service, citationRequests, indexChanged, dispose } =
          await makeHarness({
            body: "Blah [@alpha].",
            formatCitations: async () => {
              generation += 1;
              if (generation === 1) {
                return new Promise((resolve) => {
                  finishFirst = resolve;
                });
              }
              return [rendered("fresh")];
            },
          });

        service.peek(NOTE.path);
        await vi.waitFor(() => expect(citationRequests).toHaveLength(1));
        indexChanged(NOTE.path);
        service.peek(NOTE.path);
        await vi.waitFor(() => expect(citationRequests).toHaveLength(2));
        finishFirst?.([rendered("stale")]);

        await vi.waitFor(() =>
          expect(
            firstText(service.peek(NOTE.path)?.value.formatted.get("[@alpha]")),
          ).toBe("fresh"),
        );
        await dispose();
      }),
  );

  it.effect("answers a synchronous caller only once the read settled", () =>
    Effect.promise(async () => {
      const { service, dispose } = await makeHarness({
        body: "Blah [@alpha].",
      });

      service.peek(NOTE.path);
      expect(service.peek(NOTE.path)).toBeNull();
      await readText(service);

      expect(
        service.peek(NOTE.path)?.value.formatted.get("[@alpha]"),
      ).toBeDefined();
      await dispose();
    }),
  );

  it.effect(
    "keeps a document's text when its own citations changed, and says so",
    () =>
      Effect.promise(async () => {
        const { service, citationRequests, indexChanged, dispose } =
          await makeHarness({ body: "Blah [@alpha]." });
        await readText(service);
        const changed: string[] = [];
        subscribe(service.runtime, service.changed, (path) =>
          changed.push(path),
        );

        indexChanged(NOTE.path);

        expect(changed).toEqual([NOTE.path]);
        // The peek that serves the stale text is also what starts the fresh read.
        expect(
          service.peek(NOTE.path)?.value.formatted.get("[@alpha]"),
        ).toBeDefined();
        await vi.waitFor(() => expect(citationRequests).toHaveLength(2));
        await vi.waitFor(() => expect(changed).toEqual([NOTE.path]));
        await dispose();
      }),
  );

  it.effect(
    "keeps every document's text when the renders go stale, and says so",
    () =>
      Effect.promise(async () => {
        const { service, rendersInvalidated, dispose } = await makeHarness({
          body: "Blah [@alpha].",
        });
        await readText(service);
        let invalidated = 0;
        subscribe(
          service.runtime,
          service.invalidated,
          () => (invalidated += 1),
        );

        rendersInvalidated();

        expect(
          service.peek(NOTE.path)?.value.formatted.get("[@alpha]"),
        ).toBeDefined();
        expect(invalidated).toBe(1);
        await dispose();
      }),
  );

  it.effect("serves the stale text until the fresh read lands", () =>
    Effect.promise(async () => {
      let generation = 0;
      let finishFresh:
        | ((value: readonly RenderedCitation[]) => void)
        | undefined;
      const { service, rendersInvalidated, dispose } = await makeHarness({
        body: "Blah [@alpha].",
        formatCitations: () => {
          generation += 1;
          if (generation === 1) return Promise.resolve([rendered("stale")]);
          return new Promise((resolve) => {
            finishFresh = resolve;
          });
        },
      });
      await readText(service);
      const changed: string[] = [];
      subscribe(service.runtime, service.changed, (path) => changed.push(path));

      rendersInvalidated();
      // The peek that serves the stale text is also what starts the fresh read.
      expect(
        firstText(service.peek(NOTE.path)?.value.formatted.get("[@alpha]")),
      ).toBe("stale");
      await vi.waitFor(() => expect(finishFresh).toBeDefined());
      expect(
        firstText(service.peek(NOTE.path)?.value.formatted.get("[@alpha]")),
      ).toBe("stale");

      finishFresh!([rendered("fresh")]);
      await vi.waitFor(() => expect(changed).toEqual([NOTE.path]));
      expect(
        firstText(service.peek(NOTE.path)?.value.formatted.get("[@alpha]")),
      ).toBe("fresh");
      await dispose();
    }),
  );

  it.effect(
    "replaces a held Profile failure when the document names another unavailable Profile",
    () =>
      Effect.promise(async () => {
        const frontmatter: Record<string, unknown> = {
          [FIELD_ZOTERO_NOTE_KEY]: "NOTE1234",
          [FIELD_LITERATURE_NOTE_PROFILE]: "Missing one",
        };
        const { service, metadataChanged, dispose } = await makeHarness({
          body: "Blah [@alpha].",
          frontmatter,
        });
        expect(
          (await readText(service)).presentationFailure?.diagnostic.stamp,
        ).toBe("Missing one");
        const changed: string[] = [];
        subscribe(service.runtime, service.changed, (path) =>
          changed.push(path),
        );

        frontmatter[FIELD_LITERATURE_NOTE_PROFILE] = "Missing two";
        metadataChanged(NOTE.path);
        expect(
          service.peek(NOTE.path)?.value.presentationFailure?.diagnostic.stamp,
        ).toBe("Missing one");

        await vi.waitFor(() => expect(changed).toEqual([NOTE.path, NOTE.path]));
        expect(
          service.peek(NOTE.path)?.value.presentationFailure?.diagnostic.stamp,
        ).toBe("Missing two");
        await dispose();
      }),
  );

  // The second invalidation cancels the fresh read: what that read would have
  // committed already predates it, and the stale mark it leaves is what makes
  // the next peek read once more. The last read is the one that stands.
  it.effect("discards a read a second invalidation landed on", () =>
    Effect.promise(async () => {
      let generation = 0;
      const gates: ((value: readonly RenderedCitation[]) => void)[] = [];
      const { service, citationRequests, rendersInvalidated, dispose } =
        await makeHarness({
          body: "Blah [@alpha].",
          formatCitations: () => {
            generation += 1;
            if (generation === 1) return Promise.resolve([rendered("v1")]);
            return new Promise((resolve) => {
              gates.push(resolve);
            });
          },
        });
      await readText(service);

      rendersInvalidated();
      service.peek(NOTE.path);
      await vi.waitFor(() => expect(citationRequests).toHaveLength(2));
      rendersInvalidated();
      gates[0]!([rendered("v2")]);
      await vi.waitFor(() => {
        expect(
          firstText(service.peek(NOTE.path)?.value.formatted.get("[@alpha]")),
        ).toBe("v1");
        expect(citationRequests).toHaveLength(3);
      });
      gates[1]!([rendered("v3")]);
      await vi.waitFor(() =>
        expect(
          firstText(service.peek(NOTE.path)?.value.formatted.get("[@alpha]")),
        ).toBe("v3"),
      );
      await dispose();
    }),
  );

  it.effect(
    "revalidates a stale document once, however many surfaces peek",
    () =>
      Effect.promise(async () => {
        const { service, citationRequests, rendersInvalidated, dispose } =
          await makeHarness({ body: "Blah [@alpha]." });
        await readText(service);

        rendersInvalidated();
        service.peek(NOTE.path);
        service.peek(NOTE.path);

        await vi.waitFor(() => expect(citationRequests).toHaveLength(2));
        expect(service.peek(NOTE.path)).not.toBeNull();
        expect(citationRequests).toHaveLength(2);
        await dispose();
      }),
  );

  it.effect("answers a load after invalidation with a fresh read", () =>
    Effect.promise(async () => {
      let generation = 0;
      const { service, rendersInvalidated, dispose } = await makeHarness({
        body: "Blah [@alpha].",
        formatCitations: (sources) => {
          generation += 1;
          const text = generation === 1 ? "stale" : "fresh";
          return Promise.resolve(sources.map(() => rendered(text)));
        },
      });
      await readText(service);

      rendersInvalidated();
      const text = await readText(service);

      expect(firstText(text.formatted.get("[@alpha]"))).toBe("fresh");
      expect(
        firstText(service.peek(NOTE.path)?.value.formatted.get("[@alpha]")),
      ).toBe("fresh");
      await dispose();
    }),
  );

  // A locator or a prefix belongs to the source a render is keyed by, and
  // editing one moves no citekey occurrence, so the metadata event is what
  // catches it.
  // An editor saving the document it shows lands here after every burst of
  // typing, so the text it holds stays on screen until the fresh read replaces
  // it; a peek that read nothing would put the raw source back for that long.
  it.effect(
    "keeps the one document whose own file changed until its fresh read lands",
    () =>
      Effect.promise(async () => {
        let generation = 0;
        let finishFresh:
          | ((value: readonly RenderedCitation[]) => void)
          | undefined;
        const { service, metadataChanged, dispose } = await makeHarness({
          body: "Blah [@alpha].",
          formatCitations: () => {
            generation += 1;
            if (generation === 1) return Promise.resolve([rendered("stale")]);
            return new Promise((resolve) => {
              finishFresh = resolve;
            });
          },
        });
        await readText(service);
        const changed: string[] = [];
        subscribe(service.runtime, service.changed, (path) =>
          changed.push(path),
        );

        metadataChanged(NOTE.path);

        expect(changed).toEqual([NOTE.path]);
        expect(
          firstText(service.peek(NOTE.path)?.value.formatted.get("[@alpha]")),
        ).toBe("stale");
        await vi.waitFor(() => expect(finishFresh).toBeDefined());
        expect(
          firstText(service.peek(NOTE.path)?.value.formatted.get("[@alpha]")),
        ).toBe("stale");

        finishFresh!([rendered("fresh")]);
        await vi.waitFor(() => expect(changed).toEqual([NOTE.path, NOTE.path]));
        expect(
          firstText(service.peek(NOTE.path)?.value.formatted.get("[@alpha]")),
        ).toBe("fresh");
        await dispose();
      }),
  );

  it.effect(
    "discards a document whose own file changed before its first read settled",
    () =>
      Effect.promise(async () => {
        let finishFirst:
          | ((value: readonly RenderedCitation[]) => void)
          | undefined;
        const { service, citationRequests, metadataChanged, dispose } =
          await makeHarness({
            body: "Blah [@alpha].",
            formatCitations: () =>
              new Promise((resolve) => {
                finishFirst = resolve;
              }),
          });
        service.peek(NOTE.path);
        await vi.waitFor(() => expect(finishFirst).toBeDefined());
        const changed: string[] = [];
        subscribe(service.runtime, service.changed, (path) =>
          changed.push(path),
        );

        metadataChanged(NOTE.path);

        expect(service.peek(NOTE.path)).toBeNull();
        expect(changed).toEqual([NOTE.path]);
        expect(citationRequests).toHaveLength(1);
        await dispose();
      }),
  );

  it.effect("keeps a document held when another file changed", () =>
    Effect.promise(async () => {
      const { service, metadataChanged, dispose } = await makeHarness({
        body: "Blah [@alpha].",
      });
      await readText(service);
      const events: string[] = [];
      subscribe(service.runtime, service.changed, () => events.push("changed"));
      subscribe(service.runtime, service.invalidated, () =>
        events.push("invalidated"),
      );

      metadataChanged("somewhere/else.md");

      expect(service.peek(NOTE.path)).not.toBeNull();
      expect(events).toEqual([]);
      await dispose();
    }),
  );

  // Which Literature Note a wikilink resolves to decides what a citekey here
  // reaches, so a moved mapping makes every document's text stale.
  it.effect(
    "keeps every document's text when a Literature Note moves, and says so",
    () =>
      Effect.promise(async () => {
        const { service, resolutionChanged, dispose } = await makeHarness({
          body: "Blah [@alpha].",
        });
        await readText(service);
        let invalidated = 0;
        subscribe(
          service.runtime,
          service.invalidated,
          () => (invalidated += 1),
        );

        resolutionChanged();

        expect(service.peek(NOTE.path)).not.toBeNull();
        expect(invalidated).toBe(1);
        await dispose();
      }),
  );

  // The citekey resolution snapshot decides what a literal `@citekey` reaches
  // and whether a wikilink's Item carries a native citation key, so a rebuild
  // makes every document's text stale.
  it.effect(
    "#1705 invalidates held text on lookup changes until disposed",
    () =>
      Effect.promise(async () => {
        await using cleanup = new AsyncDisposableStack();
        const { service, citekeyResolutionChanged, dispose } =
          await makeHarness({
            body: "Blah [@alpha].",
          });
        cleanup.defer(dispose);
        await readText(service);
        let invalidated = 0;
        subscribe(
          service.runtime,
          service.invalidated,
          () => (invalidated += 1),
        );

        citekeyResolutionChanged();

        expect(service.peek(NOTE.path)).not.toBeNull();
        expect(invalidated).toBe(1);
        await service[Symbol.asyncDispose]();

        citekeyResolutionChanged();
        expect(invalidated).toBe(1);
      }),
  );

  it.effect(
    "answers a read of a document deleted while it ran with nothing",
    () =>
      Effect.promise(async () => {
        const gate = Promise.withResolvers<readonly RenderedCitation[]>();
        const { service, queryClient, deleteNote, citationRequests, dispose } =
          await makeHarness({
            body: "Blah [@alpha].",
            formatCitations: () => gate.promise,
          });

        const reading = service.read(NOTE.path);
        await vi.waitFor(() => expect(citationRequests).toHaveLength(1));
        deleteNote();
        gate.resolve([rendered("gone")]);

        expect(await reading).toBeNull();
        // Not even the failed read the deletion left behind stays on the client.
        expect(
          queryClient.client.getQueryState(["citation-text", NOTE.path]),
        ).toBeUndefined();
        expect(service.peek(NOTE.path)).toBeNull();
        await dispose();
      }),
  );

  it.effect("reads a document again after it was dropped", () =>
    Effect.promise(async () => {
      const { service, citationRequests, indexChanged, dispose } =
        await makeHarness({ body: "Blah [@alpha]." });
      await readText(service);

      indexChanged(NOTE.path);
      await readText(service);

      expect(citationRequests).toHaveLength(2);
      expect(service.peek(NOTE.path)).not.toBeNull();
      await dispose();
    }),
  );

  describe("retention", () => {
    // Query Core owns these host timers; its retention cases use the live
    // runtime with a controlled host clock. Held Read cooldowns use TestClock.
    const GC_MS = 5 * 60 * 1000;
    const held = (h: Harness) =>
      h.queryClient.client.getQueryState(["citation-text", NOTE.path]);

    /** A harness whose garbage-collection clock the test advances. */
    async function retained(open: (docs: OpenDocumentsStub) => void) {
      // The clock is faked before the read, which schedules the collection of
      // a document nothing pins; it still advances, so the read runs.
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout"],
        shouldAdvanceTime: true,
      });
      const openDocuments = new OpenDocumentsStub();
      open(openDocuments);
      const h = await makeHarness({ body: "Blah [@alpha].", openDocuments });
      await readText(h.service);
      return {
        ...h,
        openDocuments,
        dispose: async () => {
          vi.useRealTimers();
          await h.dispose();
        },
      };
    }

    it.live("keeps an open document's text past the collection time", () =>
      Effect.promise(async () => {
        const h = await retained((docs) => docs.open(NOTE.path));

        vi.advanceTimersByTime(GC_MS * 2);

        expect(held(h)).toBeDefined();
        expect(h.service.peek(NOTE.path)).not.toBeNull();
        await h.dispose();
      }),
    );

    it.live("lets the text of a document never opened expire", () =>
      Effect.promise(async () => {
        const h = await retained(() => undefined);

        vi.advanceTimersByTime(GC_MS);

        expect(held(h)).toBeUndefined();
        await h.dispose();
      }),
    );

    it.live("lets the text expire once the last leaf showing it closes", () =>
      Effect.promise(async () => {
        const h = await retained((docs) => {
          docs.open(NOTE.path);
          docs.open(NOTE.path);
        });

        h.openDocuments.close(NOTE.path);
        vi.advanceTimersByTime(GC_MS);
        expect(held(h)).toBeDefined();

        h.openDocuments.close(NOTE.path);
        vi.advanceTimersByTime(GC_MS - 1);
        expect(held(h)).toBeDefined();
        vi.advanceTimersByTime(1);
        expect(held(h)).toBeUndefined();
        await h.dispose();
      }),
    );

    it.live("releases the old path when an open document is renamed", () =>
      Effect.promise(async () => {
        const h = await retained((docs) => docs.open(NOTE.path));

        h.openDocuments.rename(NOTE.path, "renamed.md");
        vi.advanceTimersByTime(GC_MS);

        expect(held(h)).toBeUndefined();
        await h.dispose();
      }),
    );

    it.live(
      "drops an open document's text at once when the file is deleted",
      () =>
        Effect.promise(async () => {
          const h = await retained((docs) => docs.open(NOTE.path));

          h.deleteNote();

          expect(held(h)).toBeUndefined();
          await h.dispose();
        }),
    );

    it.effect("pins an open document without reading it", () =>
      Effect.promise(async () => {
        const openDocuments = new OpenDocumentsStub();
        const h = await makeHarness({ body: "Blah [@alpha].", openDocuments });

        openDocuments.open(NOTE.path);
        await vi.waitFor(() => expect(held(h)?.fetchStatus).toBe("idle"));
        expect(h.citationRequests).toHaveLength(0);
        await h.dispose();
      }),
    );

    it.effect("releases every pin on unload", () =>
      Effect.promise(async () => {
        const openDocuments = new OpenDocumentsStub();
        openDocuments.open(NOTE.path);
        const h = await makeHarness({ body: "Blah [@alpha].", openDocuments });
        await readText(h.service);
        const query = h.queryClient.client
          .getQueryCache()
          .find({ queryKey: ["citation-text", NOTE.path], exact: true });
        expect(query?.getObserversCount()).toBe(1);

        await h.service[Symbol.asyncDispose]();

        expect(query?.getObserversCount()).toBe(0);
        await h.dispose();
      }),
    );

    it.effect(
      "pins a document a workspace Markdown leaf shows, until the leaf closes",
      () =>
        Effect.promise(async () => {
          const workspace = new MemoryWorkspace();
          const h = await makeHarness({ body: "Blah [@alpha].", workspace });
          const observers = () =>
            h.queryClient.client
              .getQueryCache()
              .find({ queryKey: ["citation-text", NOTE.path], exact: true })
              ?.getObserversCount() ?? 0;

          workspace.openMarkdownEditor(NOTE.path);
          workspace.trigger("layout-change");
          await vi.waitFor(() => expect(held(h)?.fetchStatus).toBe("idle"));
          expect(observers()).toBe(1);
          expect(h.citationRequests).toHaveLength(0);

          workspace.leaves.delete("markdown");
          workspace.open(null);
          await vi.waitFor(() => expect(observers()).toBe(0));
          await h.dispose();
        }),
    );
  });
});

/**
 * The Entry Serial standing for each work of one held Citation's first
 * occurrence.
 */
function firstSerials(
  held: readonly FormattedOccurrence[] = [],
): readonly (number | undefined)[] | undefined {
  return held[0]?.serials;
}

describe("CitationText Entry Serials", () => {
  /** `Both [@alpha; @beta].` under a style whose citations are footnotes. */
  const CLUSTER = "[@alpha; @beta]";
  const TWO_WORKS = [citation("alpha", ALPHA_KEY), citation("beta", LIT_KEY)];

  it.effect(
    "stands one serial per cited work in for the note a style writes",
    () =>
      Effect.promise(async () => {
        const { service, bibliographyRequests, dispose } = await makeHarness({
          body: `Both ${CLUSTER}.`,
          cited: TWO_WORKS,
          formatCitations: (sources) => Promise.resolve(sources.map(noted)),
        });

        const { formatted, entrySerials } = await readText(service);

        expect(entrySerials).toBe(true);
        expect(firstSerials(formatted.get(CLUSTER))).toEqual([1, 2]);
        // The bibliography is read for the works the document cites, in the order
        // the References Sidebar lists them.
        expect(bibliographyRequests).toHaveLength(1);
        await dispose();
      }),
  );

  // Author-in-text and author-suppressed members are the same works in the
  // same order, so the digits they show are the same digits.
  it.effect("numbers the works of a citation however it names them", () =>
    Effect.promise(async () => {
      const { service, dispose } = await makeHarness({
        body: `Both ${CLUSTER}.`,
        cited: TWO_WORKS,
        formatCitations: () =>
          Promise.resolve([
            {
              ...noted(`[@${ALPHA_KEY}; @${LIT_KEY}]`),
              citations: [
                { id: ALPHA_KEY, mode: "author-in-text" as const },
                { id: LIT_KEY, mode: "suppress-author" as const },
              ],
            },
          ]),
      });

      const { formatted } = await readText(service);

      expect(firstSerials(formatted.get(CLUSTER))).toEqual([1, 2]);
      await dispose();
    }),
  );

  it.effect("leaves the slot of a work the bibliography left out empty", () =>
    Effect.promise(async () => {
      const { service, dispose } = await makeHarness({
        body: `Both ${CLUSTER}.`,
        cited: TWO_WORKS,
        formatCitations: (sources) => Promise.resolve(sources.map(noted)),
        // The render answers with the second work alone, which leaves the first
        // one no row to point at.
        bibliography: (ids) => ids.slice(1),
      });

      const { formatted } = await readText(service);

      expect(firstSerials(formatted.get(CLUSTER))).toEqual([undefined, 1]);
      await dispose();
    }),
  );

  it.effect(
    "leaves every slot empty when no bibliography can be rendered",
    () =>
      Effect.promise(async () => {
        const { service, dispose } = await makeHarness({
          body: `Both ${CLUSTER}.`,
          cited: TWO_WORKS,
          formatCitations: (sources) => Promise.resolve(sources.map(noted)),
          bibliography: () => null,
        });

        const { formatted, entrySerials } = await readText(service);

        expect(entrySerials).toBe(true);
        expect(firstSerials(formatted.get(CLUSTER))).toEqual([
          undefined,
          undefined,
        ]);
        await dispose();
      }),
  );

  // An in-text style writes no note, so nothing stands in for one and the
  // document pays for no bibliography of its own.
  it.effect("keeps an in-text style's document off serials", () =>
    Effect.promise(async () => {
      const { service, bibliographyRequests, dispose } = await makeHarness({
        body: `Both ${CLUSTER}.`,
        cited: TWO_WORKS,
      });

      const { formatted, entrySerials } = await readText(service);

      expect(entrySerials).toBe(false);
      expect(firstSerials(formatted.get(CLUSTER))).toEqual([]);
      expect(bibliographyRequests).toEqual([]);
      await dispose();
    }),
  );
});

it.effect("#1683 renders a document with one source read", () =>
  Effect.promise(async () => {
    await using h = await createCitationIndexHarness(
      { "draft.md": "[@doe2024]" },
      { zoteroRows: annotationRows },
    );
    await using service = citationTextFixture({
      host: h.host,
      citationIndex: h.index,
      citationLookup: h.lookup,
      noteIndex: h.noteIndex,
      profile: profileReader(),
      queryClient: h.queryClient,
      openDocuments: new OpenDocumentsStub(),
      bibliographyRender: {
        vaultPresentation: { styleId: null, locale: null },
        readCitations: async (sources) =>
          sources.map((source) => rendered(source)),
        readBibliography: async () => ({ entries: [], hasEntryMarkers: false }),
        invalidated: Stream.empty,
      } satisfies CitationTextDeps["bibliographyRender"],
    });
    const result = await service.read(h.draft.path);
    expect(result?.formatted.size).toBe(1);
    expect(h.db.itemReads).toBe(1);
  }),
);

it.effect(
  "attaches streams before acquisition returns and keeps a throwing subscriber (#1705)",
  () =>
    Effect.promise(async () => {
      const h = await makeHarness({ body: "[@alpha]" });
      try {
        const received = Promise.withResolvers<void>();
        let deliveries = 0;
        const off = subscribe(h.service.runtime, h.service.invalidated, () => {
          deliveries += 1;
          if (deliveries === 1) throw new Error("surface failed");
          if (deliveries === 2) received.resolve();
        });
        h.rendersInvalidated();
        h.rendersInvalidated();
        await received.promise;
        expect(deliveries).toBe(2);
        off();
        h.rendersInvalidated();
        expect(deliveries).toBe(2);
      } finally {
        await h.dispose();
      }
    }),
);

it.effect(
  "replays a failed startup and recovers the next host event (#1705)",
  () =>
    Effect.promise(async () => {
      const documents = new OpenDocumentsStub();
      let failed = true;
      const paths = documents.paths.bind(documents);
      documents.paths = () => {
        if (failed) throw new Error("workspace unavailable");
        return paths();
      };
      const h = await makeHarness({
        body: "[@alpha]",
        openDocuments: documents,
      });
      try {
        const delivered = Promise.withResolvers<unknown>();
        const off = subscribe(
          h.service.runtime,
          h.service.changes,
          delivered.resolve,
        );
        expect(await delivered.promise).toEqual({
          startup: "failed",
          stopped: false,
        });
        off();
        let invalidations = 0;
        subscribe(
          h.service.runtime,
          h.service.invalidated,
          () => invalidations++,
        );
        h.rendersInvalidated();
        expect(invalidations).toBe(1);
        // A failed host delivery must leave intake attached for the next event.
        documents.open("other.md");
        failed = false;
        documents.open(NOTE.path);
        await vi.waitFor(() =>
          expect(
            h.queryClient.client.getQueryState(["citation-text", NOTE.path])
              ?.fetchStatus,
          ).toBe("idle"),
        );
        expect(h.citationRequests).toEqual([]);
        expect((await h.service.read(NOTE.path))?.formatted.size).toBe(1);
      } finally {
        await h.dispose();
      }
    }),
);

it.effect(
  "aborts in-flight text on whole-runtime disposal and keeps released reads inert (#1705)",
  () =>
    Effect.promise(async () => {
      const entered = Promise.withResolvers<AbortSignal>();
      const aborted = Promise.withResolvers<void>();
      const render = Promise.withResolvers<readonly RenderedCitation[]>();
      const h = await makeHarness({
        body: "[@alpha]",
        formatCitations: async (_citations, signal) => {
          entered.resolve(signal!);
          try {
            return await abortable(render.promise, signal!);
          } finally {
            aborted.resolve();
          }
        },
      });
      try {
        const reading = h.service.read(NOTE.path);
        const signal = await entered.promise;
        await h.service.runtime.dispose();
        await aborted.promise;
        expect(signal.aborted).toBe(true);
        expect(await reading).toBeNull();
        expect(h.service.peek(NOTE.path)).toBeNull();
        expect(await h.service.read(NOTE.path)).toBeNull();
        render.resolve([rendered("late")]);
        expect(h.citationRequests).toHaveLength(1);
        expect(h.service.current.stopped).toBe(true);
        expect(
          h.queryClient.client.getQueryState(["citation-text", NOTE.path]),
        ).toBeUndefined();
      } finally {
        render.resolve([]);
        await h.dispose();
      }
    }),
);

it.effect(
  "retries a failed document render after the TestClock cooldown (#1705)",
  () =>
    Effect.gen(function* () {
      const queryClient = yield* queryClientsOf();
      const context = yield* Effect.context<never>();
      let reads = 0;
      const h = yield* Effect.acquireRelease(
        Effect.promise(() =>
          makeHarness({
            body: "[@alpha]",
            queryClient,
            context,
            formatCitations: async () => {
              if (++reads === 1) throw new Error("render failed");
              return [rendered("recovered")];
            },
          }),
        ),
        (h) => Effect.promise(() => h.dispose()),
      );
      expect(yield* Effect.promise(() => h.service.read(NOTE.path))).toBeNull();
      expect(yield* Effect.promise(() => h.service.read(NOTE.path))).toBeNull();
      expect(reads).toBe(1);
      yield* TestClock.adjust(5001);
      const text = yield* Effect.promise(() => h.service.read(NOTE.path));
      expect(firstText(text?.formatted.get("[@alpha]"))).toBe("recovered");
      expect(reads).toBe(2);
    }),
);

it.effect(
  "preserves caller AbortError while another surface shares the render (#1705)",
  () =>
    Effect.promise(async () => {
      const entered = Promise.withResolvers<AbortSignal>();
      const render = Promise.withResolvers<readonly RenderedCitation[]>();
      const h = await makeHarness({
        body: "[@alpha]",
        formatCitations: (_sources, signal) => {
          entered.resolve(signal!);
          return render.promise;
        },
      });
      try {
        const caller = new AbortController();
        const cancelled = h.service.read(NOTE.path, { signal: caller.signal });
        const cancelledResult = expect(cancelled).rejects.toMatchObject({
          name: "AbortError",
        });
        const sharedSignal = await entered.promise;
        const other = h.service.read(NOTE.path);
        caller.abort();
        await cancelledResult;
        expect(sharedSignal.aborted).toBe(false);
        render.resolve([rendered("shared")]);
        expect(firstText((await other)?.formatted.get("[@alpha]"))).toBe(
          "shared",
        );
        expect(h.citationRequests).toHaveLength(1);
      } finally {
        render.resolve([]);
        await h.dispose();
      }
    }),
);

it.effect(
  "replays stopped state to a subscription made after runtime disposal (#1705)",
  () =>
    Effect.gen(function* () {
      const h = yield* Effect.acquireRelease(
        Effect.promise(() => makeHarness({ body: "[@alpha]" })),
        (h) => Effect.promise(() => h.dispose()),
      );
      yield* Effect.promise(() => h.service.runtime.dispose());
      expect(yield* Stream.runCollect(h.service.changes)).toEqual([
        { startup: "ready", stopped: true },
      ]);
    }),
);
