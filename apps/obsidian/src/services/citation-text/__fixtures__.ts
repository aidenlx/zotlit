import { Context, Effect, Layer, Stream } from "effect";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import type { HostSources } from "@/lib/__fixtures__/obsidian-host-app";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import type { OpenDocuments } from "@/lib/open-documents";
import { CitationLookup } from "@/services/citation-index/lookup-service";
import { scanNote } from "@/services/citation-index/scan-note";
import { CitationIndex } from "@/services/citation-index/service";
import type {
  Citation,
  CitationOccurrence,
} from "@/services/citation-index/service";
import { NoteIndex } from "@/services/note-index/service";
import type { RenderedCitation } from "@/services/pandoc/engine";
import { inlineText } from "@/services/pandoc/inline-content";
import { BibliographyRender } from "@/services/pandoc/render-cache";
import { Profile } from "@/services/profile/service";
import type { ProfileReader } from "@/services/profile/service";
// The one cited work, and the Citation Index answer naming it, that the citation-text suites read against.
import { QueryClients } from "@/services/query-client/service";

import type { FormattedOccurrence, PresentedCitation } from "./present";
import { CitationText, layerCitationText } from "./service";

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
  /** The Obsidian objects the capability tags read; a missing one is empty. */
  host: HostSources;
  citationIndex: Pick<CitationIndex["Service"], "getParsedDocument" | "events">;
  citationLookup: Pick<CitationLookup["Service"], "current" | "changes">;
  noteIndex: Pick<NoteIndex["Service"], "whenIndexed" | "changes">;
  profile: ProfileReader;
  bibliographyRender: Pick<
    BibliographyRender["Service"],
    "readCitations" | "readBibliography" | "state" | "events"
  >;
  queryClient: Pick<
    QueryClients["Service"],
    "client" | "changes" | "ask" | "read" | "peek" | "invalidate" | "watch"
  >;
  /** The documents open in the workspace; without it, the layer reads the host's workspace. */
  openDocuments?: OpenDocuments;
}

export function citationTextFixture(
  deps: CitationTextFixtureDeps,
  context: Context.Context<never> = Context.empty(),
) {
  const stack = new AsyncDisposableStack();

  const queries = deps.queryClient;
  const runtime = buildRuntime(
    layerCitationText(deps.openDocuments).pipe(
      Layer.provide(
        Layer.mergeAll(
          layerHost(deps.host),
          Layer.succeed(
            CitationIndex,
            stubService<CitationIndex["Service"]>("CitationIndex", {
              ...deps.citationIndex,
            }),
          ),
          Layer.succeed(
            CitationLookup,
            stubService<CitationLookup["Service"]>("CitationLookup", {
              ...deps.citationLookup,
            }),
          ),
          Layer.succeed(
            NoteIndex,
            stubService<NoteIndex["Service"]>("NoteIndex", {
              ...deps.noteIndex,
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
              ...deps.bibliographyRender,
            }),
          ),
          Layer.succeed(
            QueryClients,
            stubService<QueryClients["Service"]>("QueryClients", {
              ...queries,
            }),
          ),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  try {
    return Object.assign(runtime.runSync(CitationText), {
      bridge: effectBridge(runtime),
      runtime,
      [Symbol.asyncDispose]: () => stack.disposeAsync(),
    });
  } catch (error) {
    void stack.disposeAsync();
    throw error;
  }
}

export type CitationTextFixture = ReturnType<typeof citationTextFixture>;
