// Per-owner preview state and interruptible Item Snapshot reads in the view registry.
import { Cause, Data, Effect, Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { parseIndexedKey, DEFAULT_CITATION_VARIANT } from "@zotlit/db";
import type { CitationVariant } from "@zotlit/db";
import type { ManagedEntrySource } from "@zotlit/workbench/document";
import {
  CITATION_EXAMPLE_IDS,
  DEFAULT_CITATION_EXAMPLE,
  SAMPLE_ANNOTATIONS,
} from "@zotlit/workbench/render";
import type {
  AnnotationExample,
  CitationExampleId,
} from "@zotlit/workbench/render";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";
import type { WorkbenchItemChoice, PreviewMode } from "@zotlit/workbench/ui";
import { TABS, annotationSamples } from "@zotlit/workbench/ui";

import type { ViewRegistryHandle } from "@/lib/view-atoms";
import { viewRuntime } from "@/lib/view-atoms";
import { zoteroRevisionAtom } from "@/services/zotero-reads/atoms";
import { ZoteroReads } from "@/services/zotero-reads/service";
import { getSampleItem } from "@/views/template-workbench/selection-data";
import type { TemplateAuthoringContext } from "@/views/template-workbench/view";

export interface NativePreviewState {
  context: TemplateAuthoringContext | null;
  annotationId: string | null;
  presentation: { scrollTop: number; reveal: string | null; pending: boolean };
  source: string | null;
  sourceProblem: string | null;
  entries: readonly ManagedEntrySource[];
  item: WorkbenchItemChoice | null;
  preview: { mode: PreviewMode; live: boolean };
  status: "empty" | "loading" | "ready" | "error";
  error: string | null;
  showMarkdown: boolean;
  showManaged: boolean;
  snapshot: ItemSnapshot | null;
  current: readonly AnnotationExample[];
  example: AnnotationExample | null;
  /** The Citation Variant a Citation Template preview renders under. */
  variant: CitationVariant;
  /**
   * The built-in Citation example set the preview renders, or null while the
   * chosen Item supplies the set instead. It outranks `item`: a reader who
   * picks an example is looking at the example, whichever Item is selected.
   */
  citationExample: CitationExampleId | null;
}
const EMPTY_PREVIEW: NativePreviewState = {
  context: null,
  annotationId: null,
  presentation: { scrollTop: 0, reveal: null, pending: false },
  source: null,
  sourceProblem: null,
  entries: [],
  item: null,
  preview: { mode: "create", live: true },
  status: "empty",
  error: null,
  showMarkdown: false,
  showManaged: false,
  snapshot: null,
  current: [],
  example: null,
  variant: DEFAULT_CITATION_VARIANT,
  citationExample: DEFAULT_CITATION_EXAMPLE,
};

export const patchPreview =
  (patch: Partial<NativePreviewState>) =>
  (state: NativePreviewState): NativePreviewState =>
    Object.entries(patch).every(
      ([key, value]) => state[key as keyof NativePreviewState] === value,
    )
      ? state
      : { ...state, ...patch };

class PreviewItemUnavailable extends Data.TaggedError(
  "PreviewItemUnavailable",
)<{ readonly selection: string }> {}

const readSnapshot = Effect.fn("NotePreview.readSnapshot")(function* (
  id: string | null,
) {
  if (!id) return null;
  const sample = getSampleItem(id);
  if (sample) return sample;
  const parsed = id.startsWith("sample:") ? null : parseIndexedKey(id);
  if (!parsed)
    return yield* new PreviewItemUnavailable({
      selection: id,
    });
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      return yield* reads.ItemSnapshot({
        selection: {
          key: parsed.key,
          library:
            parsed.groupID === null
              ? { type: "personal" }
              : { type: "group", groupID: parsed.groupID },
        },
        provenance: {
          kind: "connected",
          installationId: "obsidian",
          vault: "preview",
        },
      });
    }),
  );
});

export function makePreviewModel() {
  const input = Atom.make<NativePreviewState>({ ...EMPTY_PREVIEW });
  const refresh = Atom.make(0);
  const item = Atom.map(input, (state) => state.item?.id ?? null);
  const loaded = viewRuntime.atom((get) => {
    const id = get(item);
    get(refresh);
    // Samples carry their data, so database changes affect connected Items alone.
    if (id && !id.startsWith("sample:")) get(zoteroRevisionAtom);
    return readSnapshot(id);
  });
  const annotationId = Atom.map(input, (state) => state.annotationId);
  const examples = Atom.make((get) => {
    const id = get(annotationId);
    const selected = get(item);
    const result = get(loaded);
    const snapshot =
      result.waiting || AsyncResult.isFailure(result)
        ? null
        : Option.getOrNull(AsyncResult.value(result));
    return snapshot
      ? annotationSamples(snapshot, id)
      : {
          current: [],
          example: !selected
            ? (SAMPLE_ANNOTATIONS.find((sample) => sample.id === id) ?? null)
            : null,
        };
  });
  const state = Atom.make((get): NativePreviewState => {
    const inputState = get(input);
    const result = get(loaded);
    const snapshot = result.waiting
      ? null
      : Option.getOrNull(AsyncResult.value(result));
    const failed = AsyncResult.isFailure(result);
    const failure = AsyncResult.isFailure(result)
      ? Cause.squash(result.cause)
      : null;
    return {
      ...inputState,
      snapshot: failed ? null : snapshot,
      status: !inputState.item
        ? "empty"
        : result.waiting || AsyncResult.isInitial(result)
          ? "loading"
          : failed
            ? "error"
            : "ready",
      error: failed
        ? failure instanceof PreviewItemUnavailable
          ? null
          : failure instanceof Error
            ? failure.message
            : AsyncResult.isFailure(result)
              ? Cause.pretty(result.cause)
              : null
        : null,
      ...get(examples),
    };
  });
  return { input, refresh, loaded, state };
}
export type PreviewModel = ReturnType<typeof makePreviewModel>;

export function holdPreviewModel(
  registry: ViewRegistryHandle,
  model: PreviewModel,
): () => void {
  const releases = [
    registry.mount(model.input),
    registry.mount(model.refresh),
    registry.mount(model.state),
  ];
  return () => {
    for (const release of releases.reverse()) release();
  };
}

/** The Workbench's external-store seam, backed by the owner's atom model. */
export function previewStateHandle(
  registry: ViewRegistryHandle,
  model: PreviewModel,
) {
  return {
    registry,
    model,
    getState: () => registry.get(model.state),
    setState: (patch: Partial<NativePreviewState>) =>
      registry.update(model.input, patchPreview(patch)),
    subscribe: (
      listener: (
        state: NativePreviewState,
        previous: NativePreviewState,
      ) => void,
    ) => {
      let previous = registry.get(model.state);
      return registry.subscribe(model.state, (next) => {
        const before = previous;
        previous = next;
        listener(next, before);
      });
    },
  };
}
export type PreviewStateHandle = ReturnType<typeof previewStateHandle>;

const decode = <A>(schema: Schema.Codec<A>, value: unknown): A | null =>
  Option.getOrNull(Schema.decodeUnknownOption(schema)(value));
const savedRecord = Schema.Record(Schema.String, Schema.Unknown);

/** Each saved field decodes alone, so one bad field leaves the others. */
export function readSavedPreview(input: unknown) {
  const value = decode(savedRecord, input);
  if (!value || !Object.hasOwn(value, "source")) return null;
  const source = decode(savedRecord, value.source);
  return {
    source: source
      ? {
          path: decode(Schema.String, source.path),
          builtin: source.builtin === true,
        }
      : null,
    item: decode(Schema.String, value.item),
    annotationId: decode(Schema.String, value.annotationId),
    root:
      decode(
        Schema.Literals(["note", "filename", "annotation", "citation"]),
        value.root,
      ) ?? "note",
    tab: decode(Schema.Literals(TABS), value.tab) ?? "note",
    kind:
      decode(Schema.Literals(["profile", "citation", "partial"]), value.kind) ??
      "profile",
    advanced: decode(Schema.Boolean, value.advanced) ?? false,
    variant:
      decode(Schema.Literals(["main", "alt"]), value.variant) ??
      DEFAULT_CITATION_VARIANT,
    citationExample:
      value.citationExample === null
        ? null
        : (decode(
            Schema.Literals(CITATION_EXAMPLE_IDS),
            value.citationExample,
          ) ?? DEFAULT_CITATION_EXAMPLE),
    partialProfile: decode(Schema.String, value.partialProfile),
    mode: value.mode === "update" ? ("update" as const) : ("create" as const),
    live: value.live !== false,
    showMarkdown: value.showMarkdown === true,
    showManaged: value.showManaged === true,
  };
}

export function readEphemeralPreview(input: unknown) {
  const value = decode(savedRecord, input);
  const state = decode(savedRecord, value?.zotlitPreview);
  const context = decode(Schema.String, state?.context);
  if (!state || context === null) return null;
  return {
    context,
    scrollTop: Math.max(0, decode(Schema.Finite, state.scrollTop) ?? 0),
    reveal: decode(Schema.String, state.reveal),
    pending: true,
  };
}
