// Per-leaf References reads, retained entries, and copy snapshots in the view registry.
import { Effect, Option, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createContext, useContext } from "react";

import { withLogCategory } from "@/lib/effect-log";
import { viewRuntime } from "@/lib/view-atoms";
import {
  citationLookupStateAtom,
  documentRevisionsAtom,
} from "@/services/citation-index/atoms";
import {
  CitationIndex,
  citationsEqual,
  documentCitationErrorsEqual,
} from "@/services/citation-index/service";
import type { DocumentCitationSet } from "@/services/citation-index/service";
import { entrySerialsAtom } from "@/services/citation-text/atoms";
import {
  bibliographyRevisionsAtom,
  pandocEngineAtom,
} from "@/services/pandoc/atoms";
import {
  documentCitationPresentation,
  samePresentation,
} from "@/services/pandoc/document-presentation";
import type { DocumentPresentationFailure } from "@/services/pandoc/document-presentation";
import { BibliographyRender } from "@/services/pandoc/render-cache";
import {
  zoteroReadyAtom,
  zoteroRevisionAtom,
} from "@/services/zotero-reads/atoms";

import type { CopyBibliographySnapshot } from "./actions";
import { metadataRevisionAtom, referencesSelectionAtom } from "./atoms";
import type { ReferencesSelection } from "./atoms";
import { buildReferenceEntries } from "./entries";
import type { ReferenceEntry, RenderedReference } from "./entries";
import { minimalReferencesState, referencesCopyState } from "./state";
import type { ReferencesState, ReferencesFormatting } from "./state";

interface ReferencesDocument extends ReferencesSelection {
  readonly set: DocumentCitationSet | null;
}
interface ReferencesRender {
  readonly document: ReferencesDocument | null;
  readonly generation: number;
  readonly key: string | null;
  readonly entries: readonly ReferenceEntry[];
  readonly rendered: ReadonlyMap<string, RenderedReference>;
  readonly entryMarkers: boolean | null;
  readonly formatting: ReferencesFormatting;
  readonly formattingFailed: boolean;
  readonly documentPresentationError: DocumentPresentationFailure | null;
}
const EMPTY_RENDER: ReferencesRender = {
  document: null,
  generation: 0,
  key: null,
  entries: [],
  rendered: new Map(),
  entryMarkers: null,
  formatting: "pending",
  formattingFailed: false,
  documentPresentationError: null,
};

export function makeReferencesModel() {
  const cursors = Atom.make<Readonly<Record<string, number>>>({});
  const scanRevision = Atom.make((get) => {
    const { path } = get(referencesSelectionAtom);
    const revisions = get(documentRevisionsAtom);
    return `${revisions["*"] ?? 0}:${path ? (revisions[path] ?? 0) : 0}`;
  });
  const scanned = viewRuntime.atom((get) => {
    const selection = get(referencesSelectionAtom);
    get(scanRevision);
    get(metadataRevisionAtom);
    get(citationLookupStateAtom);
    get(zoteroRevisionAtom);
    return Effect.gen(function* () {
      if (!selection.ready) return null;
      const set = selection.file
        ? yield* (yield* CitationIndex).getDocumentCitationSet(selection.file)
        : null;
      return { ...selection, set } satisfies ReferencesDocument;
    }).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("References citation lookup failed", { error }),
      ),
      withLogCategory("references"),
    );
  });
  const document = Atom.make((get): ReferencesDocument | null => {
    const result = get(scanned);
    const previous = Option.getOrNull(get.self<ReferencesDocument | null>());
    if (AsyncResult.isFailure(result)) return previous;
    const next = Option.getOrElse(AsyncResult.value(result), () => previous);
    return sameDocument(previous, next) ? previous : next;
  });
  const renderKey = Atom.make<string | null>(null);
  const revision = Atom.make((get) => {
    const key = get(renderKey);
    const revisions = get(bibliographyRevisionsAtom);
    return `${revisions["*"] ?? 0}:${key ? (revisions[key] ?? 0) : 0}`;
  });
  const loaded = viewRuntime.atom((get) => {
    const current = get(document);
    get(revision);
    get(zoteroRevisionAtom);
    const engine = get(pandocEngineAtom);
    const previous = get.self<AsyncResult.AsyncResult<ReferencesRender>>().pipe(
      Option.flatMap((result) => AsyncResult.value(result)),
      Option.getOrElse(() => EMPTY_RENDER),
    );
    return loadReferences(current, previous, engine.kind === "installed");
  });
  const state = Atom.make((get): ReferencesState => {
    const result = get(loaded);
    const render = Option.getOrElse(
      AsyncResult.value(result),
      () => EMPTY_RENDER,
    );
    const selection = get(referencesSelectionAtom);
    const current = get(document);
    const engine = get(pandocEngineAtom);
    const status = get(citationLookupStateAtom).status;
    const path = render.document?.path ?? null;
    const formatting = AsyncResult.isFailure(result)
      ? "failed"
      : result.waiting ||
          current !== render.document ||
          selection.path !== path ||
          (render.document &&
            !samePresentation(
              selection.presentation,
              render.document.presentation,
            ))
        ? "pending"
        : render.formatting;
    return {
      entries: render.entries,
      listMode:
        render.entryMarkers === null
          ? { kind: "minimal" }
          : {
              kind: "bibliography",
              hasEntryMarkers: render.entryMarkers,
              entrySerials: path ? get(entrySerialsAtom(path)) : false,
            },
      engine,
      formattingFailed:
        AsyncResult.isFailure(result) || render.formattingFailed,
      documentPresentationError: render.documentPresentationError,
      dbReady: get(zoteroReadyAtom),
      citekeyResolution: status === "pending" ? null : status,
      copy: referencesCopyState({
        path,
        generation: render.generation,
        entries: render.entries,
        formatting,
      }),
    };
  });
  const snapshot = Atom.make((get): CopyBibliographySnapshot | null => {
    const current = get(state);
    return current.copy.kind === "ready"
      ? {
          ...current.copy.target,
          entries: current.entries
            .filter((entry) => entry.kind === "rendered")
            .map(({ marker, content }) => ({ marker, content })),
        }
      : null;
  });
  return { cursors, scanned, loaded, state, snapshot, renderKey };
}
export type ReferencesModel = ReturnType<typeof makeReferencesModel>;

export function holdReferencesModel(
  registry: AtomRegistry.AtomRegistry,
  model: ReferencesModel,
): () => void {
  const releases = [
    registry.mount(model.cursors),
    registry.mount(model.renderKey),
    registry.mount(model.state),
  ];
  // The held key selects cache events. It is written at the registry boundary,
  // so the read itself stays a pure dependency computation.
  releases.push(
    registry.subscribe(
      model.loaded,
      (result) => {
        if (AsyncResult.isFailure(result)) return;
        const render = Option.getOrNull(AsyncResult.value(result));
        if (render && registry.get(model.renderKey) !== render.key)
          registry.set(model.renderKey, render.key);
      },
      { immediate: true },
    ),
  );
  return () => {
    for (const release of releases) release();
  };
}

export const advanceOccurrence =
  (id: string, count: number) =>
  (
    cursors: Readonly<Record<string, number>>,
  ): Readonly<Record<string, number>> =>
    count === 0
      ? cursors
      : { ...cursors, [id]: ((cursors[id] ?? -1) + 1) % count };

function sameDocument(
  a: ReferencesDocument | null,
  b: ReferencesDocument | null,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.path === b.path &&
      samePresentation(a.presentation, b.presentation) &&
      a.set?.lookup.revision === b.set?.lookup.revision &&
      citationsEqual(a.set?.citations ?? [], b.set?.citations ?? []) &&
      documentCitationErrorsEqual(a.set?.errors ?? [], b.set?.errors ?? []))
  );
}

function loadReferences(
  document: ReferencesDocument | null,
  previous: ReferencesRender,
  installed: boolean,
) {
  const citations = document?.set?.citations ?? [];
  const errors = document?.set?.errors ?? [];
  const restyled =
    !!document &&
    !!previous.document &&
    !samePresentation(document.presentation, previous.document.presentation);
  const rendered = restyled
    ? new Map<string, RenderedReference>()
    : previous.rendered;
  const first: ReferencesRender = {
    ...previous,
    document,
    generation: previous.generation + 1,
    rendered,
    key: restyled ? null : previous.key,
    entryMarkers: restyled ? null : previous.entryMarkers,
    formattingFailed: restyled ? false : previous.formattingFailed,
    documentPresentationError: restyled
      ? null
      : previous.documentPresentationError,
    entries: buildReferenceEntries(citations, {
      bibliography: { entries: rendered, complete: false },
      errors,
    }),
    formatting: installed ? "pending" : "unavailable",
  };
  const read = Effect.gen(function* () {
    if (!document?.set)
      return {
        ...first,
        key: null,
        rendered: new Map(),
        entryMarkers: null,
        formatting: "unavailable" as const,
        formattingFailed: false,
        documentPresentationError: null,
      };
    const renders = yield* BibliographyRender;
    const declared = document.presentation;
    const presented = documentCitationPresentation(
      declared,
      (yield* renders.state).vaultPresentation,
      {
        citations,
        works: document.set.sources,
      },
    );
    const minimal = (
      failed: boolean,
      error: DocumentPresentationFailure | null,
    ): ReferencesRender => ({
      ...first,
      entries: minimalReferencesState({
        citations,
        errors,
        formattingFailed: failed,
      }).entries,
      rendered: new Map(),
      entryMarkers: null,
      key: null,
      formatting: failed ? "failed" : "unavailable",
      formattingFailed: failed,
      documentPresentationError: error,
    });
    if (presented.kind === "unusable") return minimal(false, presented);
    const outcome = yield* renders.render(
      presented.items,
      presented.presentation,
    );
    if (outcome.kind === "unavailable") {
      const error: DocumentPresentationFailure | null =
        outcome.reason === "style-missing" &&
        declared.kind === "read" &&
        typeof declared.presentation.styleId === "string"
          ? declared.profileStyle
            ? {
                kind: "unusable",
                property: "profile-style",
                styleId: declared.presentation.styleId,
                ...declared.profileStyle,
              }
            : { kind: "unusable", property: "style" }
          : null;
      return minimal(outcome.reason === "failed", error);
    }
    const { record, key } = outcome;
    const formatted = new Map(
      record.value.entries.map(({ id, marker, content }) => [
        id,
        { marker, content },
      ]),
    );
    return {
      ...first,
      key,
      rendered: formatted,
      entries: buildReferenceEntries(citations, {
        bibliography: { entries: formatted, complete: true },
        errors,
      }),
      entryMarkers: record.value.hasEntryMarkers,
      formattingFailed: record.status === "failed",
      formatting:
        record.status === "revalidating"
          ? "pending"
          : record.status === "failed"
            ? "failed"
            : "complete",
      documentPresentationError: null,
    } satisfies ReferencesRender;
  }).pipe(
    Effect.tapError((error) =>
      Effect.logWarning("References bibliography render failed", { error }),
    ),
    withLogCategory("references"),
  );
  return Stream.concat(Stream.make(first), Stream.fromEffect(read));
}

export const ReferencesModelContext = createContext<ReferencesModel | null>(
  null,
);
export function useReferencesModel(): ReferencesModel {
  const model = useContext(ReferencesModelContext);
  if (!model)
    throw new Error(
      "useReferencesModel must be used within ReferencesModelContext",
    );
  return model;
}
