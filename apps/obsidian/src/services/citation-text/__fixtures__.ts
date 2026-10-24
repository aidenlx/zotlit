import type { App } from "obsidian";

import { layerHostApp } from "@/lib/__fixtures__/obsidian-host-app";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { Context, Effect, Layer, PubSub, Stream } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import type { OpenDocuments } from "@/lib/open-documents";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import type { CitationLookupState } from "@/services/citation-index/lookup-service";
import type {
  PlainCitationIndex,
  PlainCitationLookup,
} from "@/services/citation-index/plain";
import { scanNote } from "@/services/citation-index/scan-note";
import { CitationIndex } from "@/services/citation-index/service";
import type { CitationIndexEvent } from "@/services/citation-index/service";
import type {
  Citation,
  CitationOccurrence,
} from "@/services/citation-index/service";
import type { PlainNoteIndex } from "@/services/note-index/plain";
import { NoteIndex } from "@/services/note-index/service";
import type { NoteIndexChange } from "@/services/note-index/service";
import type { RenderedCitation } from "@/services/pandoc/engine";
import { inlineText } from "@/services/pandoc/inline-content";
import { BibliographyRender } from "@/services/pandoc/render-cache";
import type { BibliographyRenderEvent } from "@/services/pandoc/render-cache";
import type { PlainBibliographyRender } from "@/services/pandoc/render-cache/plain";
import { Profile } from "@/services/profile/service";
import type { ProfileReader } from "@/services/profile/service";
// The one cited work, and the Citation Index answer naming it, that the citation-text suites read against.
import type { PlainQueryClients } from "@/services/query-client/plain";
import { QueryClients } from "@/services/query-client/service";
import type { HeldReadChange } from "@/services/query-client/service";

import { plainCitationText } from "./plain";
import type { FormattedOccurrence, PresentedCitation } from "./present";
import { layerCitationText } from "./service";

/** The Indexed Key of the cited work, which is also the CSL id a render names it by. */
export const ALPHA_KEY = "ALPHA234";

/**
 * One Citation Index answer.
 *
 * @param indexedKey the Indexed Key the citekey reaches, or null for a key that
 *   reaches no Literature Note.
 */
export function citation(
  citekey: string,
  indexedKey: string | null = ALPHA_KEY,
): Citation {
  return {
    indexedKey,
    linkpath: indexedKey === null ? null : "Zeta 2020",
    refNumber: 1,
    occurrences: [
      {
        kind: "citekey",
        raw: citekey,
        position: {
          start: { line: 0, col: 0, offset: 0 },
          end: { line: 0, col: 0, offset: 0 },
        },
      },
    ],
  };
}

export function literalOccurrences(body: string): CitationOccurrence[] {
  return scanNote(body).citekeys;
}

/** One formatted citation, as the render cache hands it over. */
export function rendered(text: string): RenderedCitation {
  return { content: [{ t: "Str", c: text }], citations: [] };
}

/** One formatted citation as a surface holds it, standing for no note. */
export function presented(text: string): PresentedCitation {
  return { text: rendered(text), serials: [] };
}

/**
 * One formatted citation of a note-class style: the works it names read out of
 * the source, and a note where an in-text style would have written the text.
 *
 * @param source the citation as the render was asked for it, whose keys are
 *   the CSL ids the render answers with.
 */
export function noted(source: string): RenderedCitation {
  return {
    content: [
      {
        t: "Cite",
        c: [
          [],
          [{ t: "Note", c: [{ t: "Para", c: [{ t: "Str", c: source }] }] }],
        ],
      },
    ],
    citations: scanNote(source).citations.flatMap(({ keys }) =>
      keys.map(({ citekey }) => ({ id: citekey, mode: "normal" as const })),
    ),
  };
}

/**
 * The one occurrence a document holding a Citation once writes of it, for a
 * suite that stands in for a whole read.
 */
export function occurrences(
  text: RenderedCitation,
  start = 0,
): FormattedOccurrence[] {
  return [{ start, text, serials: [] }];
}

/**
 * The text every occurrence of one held Citation reads as, in document order,
 * which is what a suite asserting on a position-dependent render asserts on.
 */
export function occurrenceTexts(
  held: readonly FormattedOccurrence[] = [],
): string[] {
  return held.map(({ text }) => inlineText(text.content));
}

/** The text one held Citation's first occurrence reads as. */
export function firstText(
  held: readonly FormattedOccurrence[] = [],
): string | undefined {
  return occurrenceTexts(held)[0];
}

/** The real CitationText layer over already-owned consumer fixture dependencies. */
export interface CitationTextFixtureDeps {
  app: App;
  citationIndex: Pick<
    PlainCitationIndex,
    "getParsedDocument" | "changed" | "membership-changed"
  >;
  citationLookup: Pick<PlainCitationLookup, "changed">;
  noteIndex: Pick<PlainNoteIndex, "whenIndexed" | "changed" | "indexed">;
  profile: ProfileReader;
  bibliographyRender: Pick<
    PlainBibliographyRender,
    "readCitations" | "readBibliography" | "vaultPresentation" | "invalidated"
  >;
  queryClient: Pick<
    PlainQueryClients,
    "client" | "ask" | "read" | "peek" | "invalidate" | "watch"
  >;
  openDocuments: OpenDocuments;
}

export function citationTextFixture(
  deps: CitationTextFixtureDeps,
  context: Context.Context<never> = Context.empty(),
) {
  const stack = new AsyncDisposableStack();
  const callbacks = <A>(
    register: (emit: (event: A) => void) => (() => void)[],
  ) => {
    const bus = Effect.runSync(PubSub.unbounded<A>());
    for (const off of register((value) => PubSub.publishUnsafe(bus, value)))
      stack.defer(off);
    stack.defer(() => Effect.runSync(PubSub.shutdown(bus)));
    return Stream.fromPubSub(bus);
  };
  let revision = 0;
  const initialLookup = { revision: "0" } as CitationLookupState;
  const queries = deps.queryClient;
  const runtime = buildRuntime(
    layerCitationText(deps.openDocuments).pipe(
      Layer.provide(
        Layer.mergeAll(
          layerHostApp(deps.app),
          Layer.succeed(
            CitationIndex,
            stubService<CitationIndex["Service"]>("CitationIndex", {
              getParsedDocument: (file, signal) =>
                Effect.tryPromise(() =>
                  deps.citationIndex.getParsedDocument(file, signal),
                ),
              changes: Stream.empty,
              events: Stream.merge(
                deps.citationIndex.changed.pipe(
                  Stream.map((path): CitationIndexEvent => ({
                    type: "changed",
                    path,
                  })),
                ),
                deps.citationIndex["membership-changed"].pipe(
                  Stream.map((): CitationIndexEvent => ({
                    type: "membership-changed",
                  })),
                ),
              ),
            }),
          ),
          Layer.succeed(
            CitationLookup,
            stubService<CitationLookup["Service"]>("CitationLookup", {
              current: Effect.succeed(initialLookup),
              changes: deps.citationLookup.changed.pipe(
                Stream.map((): CitationLookupState => ({
                  ...initialLookup,
                  revision: String(++revision),
                })),
              ),
            }),
          ),
          Layer.succeed(
            NoteIndex,
            stubService<NoteIndex["Service"]>("NoteIndex", {
              whenIndexed: () =>
                Effect.promise(() => deps.noteIndex.whenIndexed()),
              changes: Stream.merge(
                deps.noteIndex.changed.pipe(
                  Stream.map((file): NoteIndexChange => ({
                    type: "changed",
                    file,
                  })),
                ),
                deps.noteIndex.indexed.pipe(
                  Stream.map((): NoteIndexChange => ({ type: "indexed" })),
                ),
              ),
            }),
          ),
          Layer.succeed(
            Profile,
            stubService<Profile["Service"]>("Profile", {
              loaded: Effect.sync(() => deps.profile.loaded),
              profiles: Effect.sync(() => deps.profile.profiles),
              resolveProfile: (
                ...args: Parameters<ProfileReader["resolveProfile"]>
              ) => Effect.sync(() => deps.profile.resolveProfile(...args)),
              profileOf: (...args: Parameters<ProfileReader["profileOf"]>) =>
                Effect.sync(() => deps.profile.profileOf(...args)),
              changes: Stream.empty,
            }),
          ),
          Layer.succeed(
            BibliographyRender,
            stubService<BibliographyRender["Service"]>("BibliographyRender", {
              state: Effect.sync(() => ({
                vaultPresentation: deps.bibliographyRender.vaultPresentation,
                missingStyle: null,
              })),
              readCitations: (...args) =>
                Effect.tryPromise({
                  try: () => deps.bibliographyRender.readCitations(...args),
                  catch: (error) => error,
                }),
              readBibliography: (...args) =>
                Effect.tryPromise({
                  try: () => deps.bibliographyRender.readBibliography(...args),
                  catch: (error) => error,
                }),
              changes: Stream.empty,
              events: deps.bibliographyRender.invalidated.pipe(
                Stream.map((): BibliographyRenderEvent => ({
                  _tag: "invalidated",
                })),
              ),
            }),
          ),
          Layer.succeed(
            QueryClients,
            stubService<QueryClients["Service"]>("QueryClients", {
              client: queries.client,
              changes: callbacks<HeldReadChange>((emit) => {
                let changed = false;
                return [
                  queries.watch([], {
                    changed: () => {
                      changed = true;
                    },
                    settled: (key, held) => {
                      emit({ key, held, changed });
                      changed = false;
                    },
                  }),
                ];
              }),
              ask: (key, fn) =>
                Effect.tryPromise({
                  try: () => queries.ask(key, fn),
                  catch: (error) => error,
                }),
              read: (key, fn, signal) =>
                Effect.tryPromise({
                  try: () => queries.read(key, fn, signal),
                  catch: (error) => error,
                }),
              peek: (key) => Effect.sync(() => queries.peek(key)),
              invalidate: (key) => Effect.sync(() => queries.invalidate(key)),
              watch: (prefix, on) =>
                Effect.sync(() => queries.watch(prefix, on)),
            }),
          ),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  try {
    return Object.assign(plainCitationText(runtime), {
      runtime,
      [Symbol.asyncDispose]: () => stack.disposeAsync(),
    });
  } catch (error) {
    void stack.disposeAsync();
    throw error;
  }
}

export type CitationTextFixture = ReturnType<typeof citationTextFixture>;
