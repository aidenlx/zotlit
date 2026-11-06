// The per-leaf host model of the Template Workbench View: the Workbench view
// state, the one read of the chosen Item, and the commands one leaf owns, as
// atoms in the view registry. The reader's choices are the Workbench model's.
import { Cause, Effect, Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { CITATION_VARIANTS } from "@zotlit/db";
import {
  parseLiteratureNoteTemplate,
  parsePlainTemplateDocument,
} from "@zotlit/templates/facade";
import type { WorkbenchDocumentKind } from "@zotlit/workbench/document";
import {
  CITATION_EXAMPLE_IDS,
  PARTIAL_CONTEXTS,
} from "@zotlit/workbench/render";
import type {
  RenderRequest,
  PartialContext,
  PartialPreviewSelection,
} from "@zotlit/workbench/render";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";
import { INITIAL_VIEW, TABS, patchAt } from "@zotlit/workbench/ui";
import type {
  TemplateRoot,
  WorkbenchChoices,
  WorkbenchItemChoice,
  WorkbenchItemData,
  WorkbenchItemDataInput,
  WorkbenchModel,
  WorkbenchPreviewSettings,
  WorkbenchViewState,
} from "@zotlit/workbench/ui";

import type { ViewRegistryHandle, ViewServices } from "@/lib/view-atoms";
import { viewRuntime } from "@/lib/view-atoms";
import { templateRevisionAtom } from "@/services/template/atoms";
import { zoteroRevisionAtom } from "@/services/zotero-reads/atoms";

import { readChosenItem } from "./atoms";
import { PartialPreviewFailed, PreviewItemMissing } from "./errors";

/** The Template Document the leaf holds, as the view last loaded it. */
export interface WorkbenchDocumentFacts {
  readonly path: string | null;
  readonly kind: WorkbenchDocumentKind;
  /** The Shared Partial's own name, or null for any other document. */
  readonly partialName: string | null;
}

/**
 * The chosen Item's read, as the surfaces show it. A finished read holds the
 * Item's data: an Item the read cannot find fails with `ItemUnavailable`.
 */
export type WorkbenchItemRead =
  | {
      readonly status: "empty" | "loading";
      readonly error: null;
      readonly snapshot: null;
    }
  | {
      readonly status: "error";
      /** The read's own message. */
      readonly error: string;
      readonly snapshot: null;
    }
  | {
      readonly status: "ready";
      readonly error: null;
      readonly snapshot: ItemSnapshot;
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
 * The share of the panels' container one panel takes at most, so the source
 * stays in view; the panel's `max-w-2/5` draws it.
 */
const PANEL_SHARE = 0.4;

/**
 * The widest the view draws a panel in a container `container` pixels wide:
 * {@link PANEL_SHARE} of it, and never past {@link PANEL_WIDTH}.
 */
export const panelLimit = (container: number) =>
  clampPanelWidth(container * PANEL_SHARE);

/**
 * `width` held within {@link PANEL_WIDTH}, and within `max` where the view
 * draws the panel narrower than that.
 */
export const clampPanelWidth = (width: number, max: number = PANEL_WIDTH.max) =>
  Math.round(
    Math.min(Math.max(PANEL_WIDTH.min, max), Math.max(PANEL_WIDTH.min, width)),
  );

export const showPanel = (side: PanelSide, shown: boolean) =>
  patchAt<WorkbenchPanels, PanelSide>(side, { shown });
/** Sets a panel's width, held within {@link PANEL_WIDTH}. */
export const setPanelWidth = (side: PanelSide, width: number) =>
  patchAt<WorkbenchPanels, PanelSide>(side, { width: clampPanelWidth(width) });

const NO_DOCUMENT: WorkbenchDocumentFacts = {
  path: null,
  kind: "profile",
  partialName: null,
};

/** Progress of the explicit action that creates the built-in Profile document. */
export type Customization = "idle" | "pending" | "failed";

export const setPresentation = (
  value: Partial<WorkbenchViewState["presentation"]>,
) => patchAt<WorkbenchViewState, "presentation">("presentation", value);

/** What a Shared Partial preview renders with: the native renderer's own. */
export type PartialRender = (
  request: RenderRequest,
  partial: PartialPreviewSelection,
) => Effect.Effect<string, unknown, ViewServices>;

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

export function makeTemplateWorkbenchModel() {
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
  const document = Atom.make(NO_DOCUMENT);
  /** Which side panels the leaf shows, and how wide. */
  const panels = Atom.make(INITIAL_PANELS);
  /** Progress of Customize, which creates the built-in Profile document. */
  const customization = Atom.make<Customization>("idle");
  /** Counts the reader's refreshes; each one reads the chosen Item again. */
  const refresh = Atom.make(0);
  const item = Atom.map(view, (state) => state.item);
  const itemId = Atom.map(view, (state) => state.item?.id ?? null);
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
    // The read answers no Item while none is chosen.
    return result.value === null
      ? { status: "empty", error: null, snapshot: null }
      : { status: "ready", error: null, snapshot: result.value.snapshot };
  });
  /** The chosen Item's title: the read's, once it named one. */
  const title = Atom.make((get) => {
    const result = get(chosen);
    const named = AsyncResult.isSuccess(result) ? result.value?.title : null;
    return named ?? get(item)?.title ?? null;
  });
  const itemData = ({ document: atoms }: WorkbenchItemDataInput) => {
    const invalid = Atom.make((get) =>
      refused(get(document).kind, get(atoms.source)),
    );
    return Atom.make((get): WorkbenchItemData => ({
      snapshot: get(read).snapshot,
      // Output kept for another Template Document is another preview's.
      document: get(document).path ?? undefined,
      // A document the parser refuses is a failure, not a wait.
      hold: get(invalid) && "invalid",
    }));
  };
  /**
   * Opens a chooser and answers what the reader chose. A newer chooser
   * replaces it, and the leaf's close interrupts it.
   */
  const chooserCommand = <A>() =>
    Atom.setIdleTTL(
      viewRuntime.fn(
        (chooser: Effect.Effect<A | null, never, ViewServices>) => chooser,
      ),
      0,
    );
  return {
    editor,
    view,
    fieldsRoot,
    document,
    panels,
    customization,
    refresh,
    item,
    chosen,
    read,
    title,
    itemData,
    chooseItem: chooserCommand<WorkbenchItemChoice>(),
    chooseAnnotation: chooserCommand<string>(),
  };
}

/**
 * A Shared Partial's preview for one caller, keyed by the JSON of
 * `[name, context]`. It renders once the chosen Item is read, and again when
 * a partial is saved or the data it reads changes. A failed Item read is the
 * preview's failure.
 */
export function makePartialPreviews({
  model,
  workbench,
  renderPartial,
  source,
}: {
  readonly model: TemplateWorkbenchModel;
  readonly workbench: WorkbenchModel;
  readonly renderPartial: PartialRender;
  /** The document's source as the editor holds it now. */
  readonly source: () => string;
}) {
  return Atom.family((key: string) =>
    viewRuntime.atom((get) => {
      const [name, context] = JSON.parse(key) as [string, PartialContext];
      get(templateRevisionAtom);
      const { variant, citationExample, partialProfile } = get(
        workbench.choices,
      );
      const { example } = get(workbench.examples);
      const data = get(workbench.snapshot);
      return get.result(model.chosen, { suspendOnWaiting: true }).pipe(
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
              { name, context, profile: partialProfile },
            ).pipe(
              Effect.mapError((cause) => new PartialPreviewFailed({ cause })),
            );
          },
        ),
      );
    }),
  );
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
    model.document,
    model.panels,
    model.customization,
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
    Pick<WorkbenchChoices, "variant" | "citationExample">
  >;
}

/** What `getState` saves beside the file, from the leaf's state. */
export function savedWorkbench(state: {
  readonly defaultDraft: boolean;
  readonly view: WorkbenchViewState;
  readonly choices: WorkbenchChoices;
  readonly panels: WorkbenchPanels;
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
    annotationId: state.choices.annotationId,
    variant: state.choices.variant,
    citationExample: state.choices.citationExample,
    advanced,
    panels: state.panels,
    preview: state.choices.preview,
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
): Partial<Pick<WorkbenchChoices, "variant" | "citationExample">> {
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
