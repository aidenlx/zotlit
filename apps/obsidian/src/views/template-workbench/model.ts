// The per-leaf host model of the Template Workbench View: the Workbench view
// state, the reader's choices beside it, the one read of the chosen Item, and
// the commands one leaf owns, as atoms in the view registry.
import { Cause, Effect, Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { CITATION_VARIANTS, DEFAULT_CITATION_VARIANT } from "@zotlit/db";
import type { CitationVariant } from "@zotlit/db";
import {
  parseLiteratureNoteTemplate,
  parsePlainTemplateDocument,
} from "@zotlit/templates/facade";
import type { WorkbenchDocumentKind } from "@zotlit/workbench/document";
import {
  CITATION_EXAMPLE_IDS,
  CITATION_EXAMPLE_ITEM,
  DEFAULT_CITATION_EXAMPLE,
  PARTIAL_CONTEXTS,
  SAMPLE_ANNOTATIONS,
  isPartialContext,
} from "@zotlit/workbench/render";
import type {
  RenderRequest,
  AnnotationExample,
  CitationExampleId,
  PartialContext,
  PartialPreviewSelection,
} from "@zotlit/workbench/render";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";
import {
  INITIAL_CHOICES,
  INITIAL_VIEW,
  TABS,
  annotationSamples,
  patch,
} from "@zotlit/workbench/ui";
import type {
  TemplateRoot,
  WorkbenchChoices,
  WorkbenchItemChoice,
  WorkbenchItemData,
  WorkbenchItemDataInput,
  WorkbenchPreviewSettings,
  WorkbenchViewState,
} from "@zotlit/workbench/ui";

import type { ViewRegistryHandle, ViewServices } from "@/lib/view-atoms";
import { viewRuntime } from "@/lib/view-atoms";
import { templateRevisionAtom } from "@/services/template/atoms";
import { zoteroRevisionAtom } from "@/services/zotero-reads/atoms";

import { readChosenItem } from "./atoms";
import { PartialPreviewFailed, PreviewItemMissing } from "./errors";
import { getSampleAnnotationParent } from "./selection-data";

/** The Template Document the leaf holds, as the view last loaded it. */
export interface WorkbenchDocumentFacts {
  readonly path: string | null;
  readonly kind: WorkbenchDocumentKind;
  /** The Shared Partial's own name, or null for any other document. */
  readonly partialName: string | null;
}

/** What the reader chose beside the Item. */
export interface WorkbenchPicks {
  /** The annotation the examples render, or null for the first one. */
  readonly annotationId: string | null;
  /** The Citation Variant a citation set renders under. */
  readonly variant: CitationVariant;
  /**
   * The built-in Citation example set, or null while the chosen Item supplies
   * the set. It outranks the Item: a reader who picks an example looks at it.
   */
  readonly citationExample: CitationExampleId | null;
}

/** The chosen Item's read, as the surfaces show it. */
export interface WorkbenchItemRead {
  readonly status: "empty" | "loading" | "ready" | "error";
  /** The read's own message, when it failed with one. */
  readonly error: string | null;
  /** The Item's data; null while it loads, after a failure, or when unavailable. */
  readonly snapshot: ItemSnapshot | null;
}

export const INITIAL_PICKS: WorkbenchPicks = {
  annotationId: null,
  variant: DEFAULT_CITATION_VARIANT,
  citationExample: DEFAULT_CITATION_EXAMPLE,
};

/** The side panels of the view: Fields on the left, Preview on the right. */
export type PanelSide = "fields" | "preview";
export interface WorkbenchPanel {
  readonly shown: boolean;
  /** The panel's width in pixels, which the reader sets with its edge. */
  readonly width: number;
}
export type WorkbenchPanels = Readonly<Record<PanelSide, WorkbenchPanel>>;

/** The widths a panel can take, in pixels. */
export const PANEL_WIDTH = { min: 240, initial: 400, max: 960 } as const;

/** A new view shows neither panel. */
const INITIAL_PANELS: WorkbenchPanels = {
  fields: { shown: false, width: PANEL_WIDTH.initial },
  preview: { shown: false, width: PANEL_WIDTH.initial },
};

/**
 * `width` held within {@link PANEL_WIDTH}, and within `max` where the view
 * draws the panel narrower than that.
 */
export const clampPanelWidth = (width: number, max: number = PANEL_WIDTH.max) =>
  Math.round(
    Math.min(Math.max(PANEL_WIDTH.min, max), Math.max(PANEL_WIDTH.min, width)),
  );

const patchPanel =
  (side: PanelSide, value: Partial<WorkbenchPanel>) =>
  (state: WorkbenchPanels): WorkbenchPanels => {
    const panel = patch(value)(state[side]);
    return panel === state[side] ? state : { ...state, [side]: panel };
  };
export const showPanel = (side: PanelSide, shown: boolean) =>
  patchPanel(side, { shown });
/** Sets a panel's width, held within {@link PANEL_WIDTH}. */
export const setPanelWidth = (side: PanelSide, width: number) =>
  patchPanel(side, { width: clampPanelWidth(width) });

const NO_DOCUMENT: WorkbenchDocumentFacts = {
  path: null,
  kind: "profile",
  partialName: null,
};

export const chooseItem = (item: WorkbenchItemChoice | null) =>
  patch<WorkbenchViewState>({ item });
export const setTab = (tab: WorkbenchViewState["tab"]) =>
  patch<WorkbenchViewState>({ tab });
export const setRoot = (root: TemplateRoot) =>
  patch<WorkbenchViewState>({ root });
export const setAdvanced = (advanced: boolean) =>
  patch<WorkbenchViewState>({ advanced });
export const setCustomization = (
  customization: WorkbenchViewState["customization"],
) => patch<WorkbenchViewState>({ customization });
export const setPresentation =
  (value: Partial<WorkbenchViewState["presentation"]>) =>
  (state: WorkbenchViewState): WorkbenchViewState => {
    const presentation = patch(value)(state.presentation);
    return presentation === state.presentation
      ? state
      : { ...state, presentation };
  };
export const chooseAnnotation = (annotationId: string | null) =>
  patch<WorkbenchPicks>({ annotationId });
export const chooseCitation = (
  value: Partial<Pick<WorkbenchPicks, "variant" | "citationExample">>,
) => patch<WorkbenchPicks>(value);

/** A chooser one leaf opened; it answers what the reader chose. */
export type ItemChooser = Effect.Effect<
  WorkbenchItemChoice | null,
  never,
  ViewServices
>;
export type AnnotationChooser = Effect.Effect<
  string | null,
  never,
  ViewServices
>;

interface AnnotationExamples {
  readonly current: readonly AnnotationExample[];
  readonly example: AnnotationExample | null;
}

/** With no Item chosen, a Sample Annotation named by id stands alone. */
const sampleAnnotation = (annotationId: string | null): AnnotationExamples => ({
  current: [],
  example:
    SAMPLE_ANNOTATIONS.find((sample) => sample.id === annotationId) ?? null,
});

const NO_EXAMPLES: AnnotationExamples = { current: [], example: null };

/** What a Shared Partial preview renders with: the native renderer's own. */
export type PartialRender = (
  request: RenderRequest,
  partial: PartialPreviewSelection,
) => Effect.Effect<string, unknown, ViewServices>;

/** What the leaf's model reads from the view that holds it. */
export interface TemplateWorkbenchModelOptions {
  /** Renders a Shared Partial; a leaf without the native renderer has none. */
  readonly renderPartial?: PartialRender | undefined;
  /** The document's source as the editor holds it now. */
  readonly source?: () => string;
}

/** Whether the parser refuses the draft, which no render can read. */
function refused(kind: WorkbenchDocumentKind, source: string): boolean {
  try {
    if (kind === "profile") parseLiteratureNoteTemplate(source);
    else parsePlainTemplateDocument(source);
    return false;
  } catch {
    return true;
  }
}

export function makeTemplateWorkbenchModel({
  renderPartial,
  source = () => "",
}: TemplateWorkbenchModelOptions = {}) {
  /**
   * The editor's view state, and the root the reader moved the Fields panel
   * to, or null while the panel shows the editor's root.
   */
  const editor = Atom.make<{
    readonly view: WorkbenchViewState;
    readonly fieldsRoot: TemplateRoot | null;
  }>({ view: INITIAL_VIEW, fieldsRoot: null });
  /**
   * The editor's view state. A write that changes the Item or the root drops
   * the Fields panel's own root in the same write.
   */
  const view = Atom.writable(
    (get) => get(editor).view,
    (ctx, next: WorkbenchViewState) => {
      const current = ctx.get(editor);
      const moved =
        next.root !== current.view.root ||
        next.item?.id !== current.view.item?.id;
      ctx.set(editor, {
        view: next,
        fieldsRoot: moved ? null : current.fieldsRoot,
      });
    },
  );
  /** The root the Fields panel shows instead of the editor's; null for the editor's. */
  const fieldsRoot = Atom.writable(
    (get) => get(editor).fieldsRoot,
    (ctx, root: TemplateRoot | null) => {
      const current = ctx.get(editor);
      ctx.set(editor, {
        ...current,
        fieldsRoot: root === current.view.root ? null : root,
      });
    },
  );
  const picks = Atom.make(INITIAL_PICKS);
  const preview = Atom.make<WorkbenchPreviewSettings>(INITIAL_CHOICES.preview);
  const document = Atom.make(NO_DOCUMENT);
  /** Which side panels the leaf shows, and how wide. */
  const panels = Atom.make(INITIAL_PANELS);
  /** The Profile a Shared Partial preview reads bindings from; null is the default one. */
  const partialProfile = Atom.make<string | null>(null);
  /** Counts the reader's refreshes; each one reads the chosen Item again. */
  const refresh = Atom.make(0);
  const item = Atom.map(view, (state) => state.item);
  const itemId = Atom.map(view, (state) => state.item?.id ?? null);
  const root = Atom.map(view, (state) => state.root);
  /**
   * The one read of the chosen Item that every surface derives from. A new
   * choice, a refresh, or a Zotero change interrupts the read it replaces.
   */
  // The leaf's close stops the read at once.
  const chosen = Atom.setIdleTTL(
    viewRuntime.atom((get) => {
      const id = get(itemId);
      get(refresh);
      // Samples carry their data, so database changes reach connected Items alone.
      if (id && !id.startsWith("sample:")) get(zoteroRevisionAtom);
      return id === null ? Effect.succeed(null) : readChosenItem(id);
    }),
    0,
  );
  const read = Atom.make((get): WorkbenchItemRead => {
    const result = get(chosen);
    if (get(itemId) === null)
      return { status: "empty", error: null, snapshot: null };
    if (result.waiting || AsyncResult.isInitial(result))
      return { status: "loading", error: null, snapshot: null };
    if (AsyncResult.isFailure(result)) {
      const failure = Cause.squash(result.cause);
      return {
        status: "error",
        error:
          failure instanceof Error
            ? failure.message
            : Cause.pretty(result.cause),
        snapshot: null,
      };
    }
    return {
      status: "ready",
      error: null,
      snapshot: result.value?.snapshot ?? null,
    };
  });
  /** The chosen Item's title: the read's, once it named one. */
  const title = Atom.make((get) => {
    const result = get(chosen);
    const named = AsyncResult.isSuccess(result) ? result.value?.title : null;
    return named ?? get(item)?.title ?? null;
  });
  const examples = Atom.make((get): AnnotationExamples => {
    const { annotationId } = get(picks);
    if (get(itemId) === null) return sampleAnnotation(annotationId);
    const loaded = get(read).snapshot;
    return loaded ? annotationSamples(loaded, annotationId) : NO_EXAMPLES;
  });
  /** The Citation set the render reads, when the document reads one. */
  const citation = Atom.make((get) => {
    const { kind } = get(document);
    const set =
      kind === "citation" || (kind === "partial" && get(root) === "citation");
    if (!set) return null;
    const { variant, citationExample } = get(picks);
    return { variant, example: citationExample };
  });
  const partial = Atom.make((get): PartialPreviewSelection | null => {
    const { kind, partialName } = get(document);
    if (kind !== "partial" || partialName === null) return null;
    const context = get(root);
    return {
      name: partialName,
      context: isPartialContext(context) ? context : "note",
      profile: get(partialProfile),
    };
  });
  /** The choices the Workbench model reads; each write lands in the atom that holds it. */
  const choices = Atom.writable(
    (get): WorkbenchChoices => ({
      annotation: get(examples).example,
      citation: get(citation),
      partial: get(partial),
      preview: get(preview),
    }),
    (ctx, next: WorkbenchChoices) => {
      ctx.set(
        picks,
        patch<WorkbenchPicks>({
          annotationId: next.annotation?.id ?? null,
          ...(next.citation
            ? {
                variant: next.citation.variant,
                citationExample: next.citation.example,
              }
            : {}),
        })(ctx.get(picks)),
      );
      ctx.set(preview, next.preview);
      if (next.partial) {
        ctx.set(view, setRoot(next.partial.context)(ctx.get(view)));
        ctx.set(partialProfile, next.partial.profile);
      }
    },
  );
  /**
   * The paper one render reads. A chosen Citation example carries its own
   * data and outranks the Item; otherwise the read stands, and with no Item
   * at all the Sample Annotation's own parent does.
   */
  const snapshot = Atom.make((get): ItemSnapshot | null => {
    if (get(citation)?.example) return CITATION_EXAMPLE_ITEM;
    const loaded = get(read).snapshot;
    if (loaded) return loaded;
    const { example } = get(examples);
    return get(itemId) === null && example
      ? getSampleAnnotationParent(example.id)
      : null;
  });
  const itemData = ({ document: atoms }: WorkbenchItemDataInput) => {
    const invalid = Atom.make((get) =>
      refused(get(document).kind, get(atoms.source)),
    );
    return Atom.make((get): WorkbenchItemData => ({
      snapshot: get(snapshot),
      // Output kept for another Template Document is another preview's.
      document: get(document).path ?? undefined,
      // A document the parser refuses is a failure, not a wait.
      hold: get(invalid) && "invalid",
    }));
  };
  /**
   * Makes an Item the choice. An Item the reader picked is the Citation set
   * they asked to see, so the built-in example that outranks it stands down.
   */
  const pick = Atom.writable(
    (get) => get(item),
    (ctx, choice: WorkbenchItemChoice) => {
      ctx.set(view, chooseItem(choice)(ctx.get(view)));
      if (ctx.get(view).root === "citation")
        ctx.set(
          picks,
          chooseCitation({ citationExample: null })(ctx.get(picks)),
        );
    },
  );
  /**
   * A Shared Partial's preview for one caller, keyed by the JSON of
   * `[name, context]`. It renders once the chosen Item is read, and again when
   * a partial is saved or the data it reads changes. A failed Item read is
   * the preview's failure. A leaf without the native renderer has none.
   */
  const partialPreview =
    renderPartial &&
    Atom.family((key: string) =>
      viewRuntime.atom((get) => {
        const [name, context] = JSON.parse(key) as [string, PartialContext];
        get(templateRevisionAtom);
        const { variant, citationExample } = get(picks);
        const { example } = get(examples);
        const profile = get(partialProfile);
        const data = get(snapshot);
        return get.result(chosen, { suspendOnWaiting: true }).pipe(
          Effect.mapError((cause) => new PartialPreviewFailed({ cause })),
          Effect.flatMap(
            (): Effect.Effect<
              string,
              PartialPreviewFailed | PreviewItemMissing,
              ViewServices
            > => {
              if (!data) return Effect.fail(new PreviewItemMissing());
              return renderPartial(
                {
                  source: source(),
                  snapshot: data,
                  ...(example ? { annotation: example } : {}),
                  ...(context === "citation"
                    ? { citation: { variant, example: citationExample } }
                    : {}),
                },
                { name, context, profile },
              ).pipe(
                Effect.mapError((cause) => new PartialPreviewFailed({ cause })),
              );
            },
          ),
        );
      }),
    );
  /**
   * Opens a chooser and makes its Item the choice; answers the choice. A
   * newer chooser replaces it, and the leaf's close interrupts it.
   */
  const chooseItemCommand = Atom.setIdleTTL(
    viewRuntime.fn((chooser: ItemChooser, get) =>
      Effect.gen(function* () {
        const choice = yield* chooser;
        if (choice) yield* Effect.sync(() => get.set(pick, choice));
        return choice;
      }),
    ),
    0,
  );
  /** Opens the annotation chooser, and makes its answer the example. */
  const chooseAnnotationCommand = Atom.setIdleTTL(
    viewRuntime.fn((chooser: AnnotationChooser, get) =>
      Effect.gen(function* () {
        const id = yield* chooser;
        if (id !== null)
          yield* Effect.sync(() =>
            get.set(picks, chooseAnnotation(id)(get(picks))),
          );
        return id;
      }),
    ),
    0,
  );
  return {
    editor,
    view,
    fieldsRoot,
    picks,
    preview,
    document,
    panels,
    partialProfile,
    refresh,
    item,
    chosen,
    read,
    title,
    examples,
    choices,
    snapshot,
    itemData,
    pick,
    partialPreview,
    chooseItem: chooseItemCommand,
    chooseAnnotation: chooseAnnotationCommand,
  };
}
export type TemplateWorkbenchModel = ReturnType<
  typeof makeTemplateWorkbenchModel
>;

/**
 * Keeps the leaf's writable state, its Item read and its commands alive in
 * `registry`, from the view's constructor to its close.
 * @returns Releases them, which interrupts the read and every command.
 */
export function holdTemplateWorkbenchModel(
  registry: ViewRegistryHandle,
  model: TemplateWorkbenchModel,
): () => void {
  const releases = [
    model.editor,
    model.view,
    model.picks,
    model.preview,
    model.document,
    model.panels,
    model.partialProfile,
    model.refresh,
    model.read,
    model.chooseItem,
    model.chooseAnnotation,
  ].map((atom) => registry.mount(atom as Atom.Atom<unknown>));
  return () => {
    for (const release of releases.reverse()) release();
  };
}

const decode = <A>(schema: Schema.Codec<A>, value: unknown): A | null =>
  Option.getOrNull(Schema.decodeUnknownOption(schema)(value));
const record = Schema.Record(Schema.String, Schema.Unknown);
const roots = Schema.Literals(["note", "annotation", "filename", "citation"]);

/** The saved view state of one leaf, as `getState` writes it. */
export interface SavedWorkbench {
  readonly defaultDraft: boolean;
  readonly tab: WorkbenchViewState["tab"] | null;
  readonly root: TemplateRoot | null;
  readonly advanced: boolean | null;
  /** The chosen Item; undefined when the state names none, null when it clears it. */
  readonly itemIndexedKey: string | null | undefined;
  /** The chosen annotation; undefined when the state names none. */
  readonly annotationId: string | null | undefined;
  readonly partialContext: PartialContext | null;
  readonly partialProfile: string | null;
  /** The panels the state names; a side it leaves out keeps the leaf's own. */
  readonly panels: Partial<WorkbenchPanels>;
  /** The Preview's settings the state names; each one decodes alone. */
  readonly preview: Partial<WorkbenchPreviewSettings>;
  /** The Citation Variant and example set the state names; each decodes alone. */
  readonly citation: Partial<
    Pick<WorkbenchPicks, "variant" | "citationExample">
  >;
}

/** What `getState` saves beside the file, from the leaf's state. */
export function savedWorkbench(state: {
  readonly defaultDraft: boolean;
  readonly view: WorkbenchViewState;
  readonly picks: WorkbenchPicks;
  readonly panels: WorkbenchPanels;
  readonly preview: WorkbenchPreviewSettings;
  /** A Shared Partial's caller and Profile; null for any other kind. */
  readonly partial: {
    readonly context: PartialContext;
    readonly profile: string | null;
  } | null;
}): Record<string, unknown> {
  const { tab, item, advanced } = state.view;
  return {
    ...(state.defaultDraft ? { defaultDraft: true, file: null } : {}),
    tab,
    itemIndexedKey: item?.id ?? null,
    annotationId: state.picks.annotationId,
    variant: state.picks.variant,
    citationExample: state.picks.citationExample,
    advanced,
    panels: state.panels,
    preview: state.preview,
    // A Shared Partial's caller is a choice nothing else can name, so the
    // workspace carries it back with the file it belongs to. No other kind
    // has one to carry.
    ...(state.partial
      ? {
          partialContext: state.partial.context,
          partialProfile: state.partial.profile,
        }
      : {}),
  };
}

/** Each saved field decodes alone, so one bad field leaves the others. */
export function readSavedWorkbench(input: unknown): SavedWorkbench | null {
  const value = decode(record, input);
  if (!value) return null;
  const nullable = (key: string) =>
    value[key] === null
      ? null
      : (decode(Schema.String, value[key]) ?? undefined);
  return {
    defaultDraft: value.defaultDraft === true,
    tab: decode(Schema.Literals(TABS), value.tab),
    root: decode(roots, value.root),
    advanced: decode(Schema.Boolean, value.advanced),
    itemIndexedKey: nullable("itemIndexedKey"),
    annotationId: nullable("annotationId"),
    partialContext: decode(
      Schema.Literals(PARTIAL_CONTEXTS),
      value.partialContext,
    ),
    partialProfile: decode(Schema.String, value.partialProfile),
    panels: readPanels(value.panels),
    preview: readPreview(value.preview),
    citation: readCitation(value),
  };
}

/** A null example set stands: the chosen Item supplies the set. */
function readCitation(
  value: Record<string, unknown>,
): Partial<Pick<WorkbenchPicks, "variant" | "citationExample">> {
  const variant = decode(Schema.Literals(CITATION_VARIANTS), value.variant);
  const citationExample =
    value.citationExample === null
      ? null
      : (decode(Schema.Literals(CITATION_EXAMPLE_IDS), value.citationExample) ??
        undefined);
  return {
    ...(variant === null ? {} : { variant }),
    ...(citationExample === undefined ? {} : { citationExample }),
  };
}

/** Each setting decodes alone, so one bad setting leaves the others. */
function readPreview(input: unknown): Partial<WorkbenchPreviewSettings> {
  const value = decode(record, input) ?? {};
  const mode = decode(Schema.Literals(["create", "update"]), value.mode);
  const flag = (key: "live" | "showMarkdown" | "showManaged") => {
    const flag = decode(Schema.Boolean, value[key]);
    return flag === null ? {} : { [key]: flag };
  };
  return {
    ...(mode === null ? {} : { mode }),
    ...flag("live"),
    ...flag("showMarkdown"),
    ...flag("showManaged"),
  };
}

const savedPanel = Schema.Struct({
  shown: Schema.Boolean,
  width: Schema.Finite,
});

/** Each side decodes alone; its width is held within the limits. */
function readPanels(input: unknown): Partial<WorkbenchPanels> {
  const value = decode(record, input) ?? {};
  const panels: Partial<Record<PanelSide, WorkbenchPanel>> = {};
  for (const side of ["fields", "preview"] as const) {
    const panel = decode(savedPanel, value[side]);
    if (panel)
      panels[side] = {
        shown: panel.shown,
        width: clampPanelWidth(panel.width),
      };
  }
  return panels;
}

const position = Schema.Struct({ top: Schema.Finite, left: Schema.Finite });
const ephemeral = Schema.Struct({
  context: Schema.String,
  selection: Schema.optional(Schema.Unknown),
  selected: Schema.optional(Schema.Unknown),
  field: Schema.optional(Schema.Unknown),
  scroll: Schema.optional(Schema.Unknown),
});
const range = Schema.Struct({
  from: Schema.Finite,
  to: Schema.Finite,
  anchor: Schema.optional(Schema.Finite),
  head: Schema.optional(Schema.Finite),
});
const insertTarget = Schema.Struct({ slice: Schema.String, range });

/** The ephemeral state of one leaf, as `getEphemeralState` writes it. */
export interface EphemeralWorkbench {
  /** The document and Item the presentation was saved for. */
  readonly context: string;
  readonly focus: boolean;
  readonly selection: typeof insertTarget.Type | null;
  readonly selected: number | null;
  readonly field: string | null;
  readonly scroll: Record<string, { top: number; left: number }>;
}

/** Each ephemeral field decodes alone; the record needs its context. */
export function readEphemeralWorkbench(
  input: unknown,
): EphemeralWorkbench | null {
  const value = decode(record, input);
  const state = decode(ephemeral, value?.zotlitTemplateWorkbench);
  if (!value || !state) return null;
  const selected = decode(Schema.Int, state.selected);
  const scroll: Record<string, { top: number; left: number }> = {};
  for (const [key, saved] of Object.entries(
    decode(record, state.scroll) ?? {},
  )) {
    const at = decode(position, saved);
    if (at)
      scroll[key] = { top: Math.max(0, at.top), left: Math.max(0, at.left) };
  }
  return {
    context: state.context,
    focus: value.focus === true,
    selection: decode(insertTarget, state.selection),
    selected: selected !== null && selected >= 0 ? selected : null,
    field: decode(Schema.String, state.field),
    scroll,
  };
}
