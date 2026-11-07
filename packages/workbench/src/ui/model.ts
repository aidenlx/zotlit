// The Workbench model: what one editor shows, as atoms that pure transitions change.
// The document controller stays the authority on the document's text; the model
// holds the controller in use, the reader's choices, the side panels, and the
// render scheduler.

import type { WorkbenchDocumentAtoms } from "#/document/atoms";
import type { WorkbenchDocumentController } from "#/document/controller";
import type {
  CitationExampleId,
  CitationPreviewSelection,
} from "#/render/citation-examples";
import type { PartialPreviewSelection } from "#/render/partial-preview";
import type { WorkbenchReportContext } from "#/render/report";
import type { RenderRequest, RenderResources } from "#/render/request";
import type { TemplateRenderResult } from "#/render/result";
import type { AnnotationExample } from "#/render/sample-annotations";
import type { ItemSnapshot } from "#/snapshot/index";
import { Cause, Effect } from "effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { DEFAULT_CITATION_VARIANT } from "@zotlit/db";
import type { CitationVariant } from "@zotlit/db";
import type { MatchTree } from "@zotlit/templates/facade";

import {
  annotationExamples,
  sampleAnnotationParent,
} from "./annotation-samples";
import type { AnnotationExamples } from "./annotation-samples";
import type {
  WorkbenchClipboardError,
  WorkbenchHostError,
  WorkbenchMatchData,
  WorkbenchMatchResult,
} from "./host";
import type { WorkbenchInsertTarget } from "./host";
import { INITIAL_PANELS, placePanels } from "./panel-layout";
import type {
  FieldsAction,
  PanelHandle,
  PanelPlacement,
  ViewSize,
  WorkbenchPanels,
} from "./panel-layout";
import { patch, patchAt } from "./patch";
import { makeRenderSchedulerAtoms } from "./scheduler-atoms";
import type {
  RenderSchedulerAtoms,
  RenderSchedulerInput,
} from "./scheduler-atoms";
import type { SliceReveal } from "./slice-editor";
import type { WorkbenchTab } from "./tabs";

import { workbenchDocumentAtoms } from "#/document/atoms";
import {
  CITATION_EXAMPLE_ITEM,
  DEFAULT_CITATION_EXAMPLE,
} from "#/render/citation-examples";
import { isPartialContext } from "#/render/partial-preview";

/** The template root a pane edits, which the Explorer and the preview follow. */
export type TemplateRoot = "note" | "annotation" | "filename" | "citation";

/** What the preview shows: a new note, or an existing note after Update. */
export type PreviewMode = "create" | "update";

export interface PreviewSettings {
  readonly mode: PreviewMode;
  readonly live: boolean;
}

/** The Item the editor is shown against, as the host names it. */
export interface WorkbenchItemChoice {
  /** A Sample Item's id, or the host's Item key. */
  readonly id: string;
  readonly title: string | null;
}

export interface EditorPresentation {
  restoreVersion: number;
  restoring: boolean;
  selection: WorkbenchInsertTarget | null;
  selected: number | null;
  reveal: SliceReveal | null;
  fieldFocus: {
    field: string;
    focus?: boolean;
    scrollIntoView?: boolean;
  } | null;
  scroll: Record<string, { top: number; left: number }>;
}

/** The view state of one editor instance: what is shown, not what the document says. */
export interface WorkbenchViewState {
  readonly presentation: EditorPresentation;
  readonly tab: WorkbenchTab;
  readonly item: WorkbenchItemChoice | null;
  /** The root the focused editor writes. */
  readonly root: TemplateRoot;
  /** Whether the whole document is open in the Advanced editor. */
  readonly advanced: boolean;
}

/** How the preview renders and shows its result. */
export interface WorkbenchPreviewSettings {
  readonly mode: PreviewMode;
  /** Renders after the quiet time when on; only on Run when off. */
  readonly live: boolean;
  readonly showMarkdown: boolean;
  readonly showManaged: boolean;
}

/**
 * What the reader chose to render the document against, beside the Item, as
 * both hosts name it. The model derives the example, the Citation set, and
 * the partial selection from these and the chosen Item's data.
 */
export interface WorkbenchChoices {
  /** The annotation the examples render, by id; null for the first one. */
  readonly annotationId: string | null;
  /** The Citation Variant a Citation set renders under. */
  readonly variant: CitationVariant;
  /**
   * The built-in Citation example set, or null while the chosen Item supplies
   * the set. It outranks the Item: a reader who picks an example looks at it.
   */
  readonly citationExample: CitationExampleId | null;
  /** The Profile a Shared Partial preview reads bindings from; null is the default one. */
  readonly partialProfile: string | null;
  readonly preview: WorkbenchPreviewSettings;
}

/**
 * The chosen Item's data. A host derives it from its read of the chosen Item
 * through `itemData`; otherwise it is a writable atom of the model.
 */
export interface WorkbenchItemData {
  /** The chosen Item's own data, as the host's read answers it. */
  readonly snapshot: ItemSnapshot | null;
  readonly document?: string | undefined;
  readonly resources?: RenderResources | undefined;
  readonly hold?: boolean | "invalid" | undefined;
}

/** The document in use, which a host's derived Item data reads beside its own read. */
export interface WorkbenchItemDataInput {
  readonly controller: Atom.Atom<WorkbenchDocumentController>;
  readonly document: WorkbenchDocumentAtoms;
}

export const INITIAL_VIEW: WorkbenchViewState = {
  presentation: {
    restoreVersion: 0,
    restoring: false,
    selection: null,
    selected: null,
    reveal: null,
    fieldFocus: null,
    scroll: {},
  },
  tab: "note",
  item: null,
  root: "note",
  advanced: false,
};

export const INITIAL_CHOICES: WorkbenchChoices = {
  annotationId: null,
  variant: DEFAULT_CITATION_VARIANT,
  citationExample: DEFAULT_CITATION_EXAMPLE,
  partialProfile: null,
  preview: {
    mode: "create",
    live: true,
    showMarkdown: false,
    showManaged: false,
  },
};

export { patch, patchAt };

export const setTab = (tab: WorkbenchTab) => patch<WorkbenchViewState>({ tab });
export const chooseItem = (item: WorkbenchItemChoice | null) =>
  patch<WorkbenchViewState>({ item });
export const setRoot = (root: TemplateRoot) =>
  patch<WorkbenchViewState>({ root });
export const setAdvanced = (advanced: boolean) =>
  patch<WorkbenchViewState>({ advanced });
export const chooseAnnotation = (annotationId: string | null) =>
  patch<WorkbenchChoices>({ annotationId });
export const chooseCitation = (
  value: Partial<Pick<WorkbenchChoices, "variant" | "citationExample">>,
) => patch<WorkbenchChoices>(value);
export const choosePartialProfile = (partialProfile: string | null) =>
  patch<WorkbenchChoices>({ partialProfile });
export const setPreview = (settings: Partial<WorkbenchPreviewSettings>) =>
  patchAt<WorkbenchChoices, "preview">("preview", settings);

/** Whether two flat selections name the same thing, so a re-derived one keeps its readers still. */
function sameFields<A extends object>(a: A | null, b: A | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const keys = Object.keys(a) as (keyof A)[];
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}

/** An example re-derived from the same data is the same example. */
function sameExample(
  a: AnnotationExample | null,
  b: AnnotationExample | null,
): boolean {
  return a === b || (a?.id === b?.id && a?.revision === b?.revision);
}

/** The runtime every read, render, and command of one host runs on. */
export type WorkbenchRuntime = Atom.AtomRuntime<never, unknown>;

export interface WorkbenchModelOptions<R extends TemplateRenderResult> {
  readonly controller: WorkbenchDocumentController;
  /** The view state to start from. */
  readonly initial?: Partial<WorkbenchViewState>;
  /** The view state, when a host keeps it in an atom of its own. */
  readonly view?: Atom.Writable<WorkbenchViewState>;
  /** The choices to start from. */
  readonly choices?: Partial<WorkbenchChoices>;
  /** A Shared Partial's own name, which its preview renders; null for any other document. */
  readonly partialName?: Atom.Atom<string | null>;
  /**
   * The chosen Item's data, when the host derives it from its own read and
   * from the document in use.
   */
  readonly itemData?: (
    input: WorkbenchItemDataInput,
  ) => Atom.Atom<WorkbenchItemData>;
  /** The panels to start from; a new editor shows neither. */
  readonly panels?: WorkbenchPanels;
  /**
   * The size of the view the panels and the editor share, which the host
   * measures from its own container; null until it has.
   */
  readonly viewSize?: Atom.Atom<ViewSize | null>;
  /** The host's one runtime; a host never builds one per editor. */
  readonly runtime: WorkbenchRuntime;
  /** The host whose Match reads the model runs, read at each read. */
  readonly host: { readonly matchData: WorkbenchMatchData };
  readonly render: (
    request: RenderRequest,
  ) => Effect.Effect<R, WorkbenchHostError>;
  readonly failed: (result: TemplateRenderResult) => R;
  readonly retain?: (kept: R, result: R) => R;
  readonly reportContext?: () => WorkbenchReportContext;
  readonly debounceMs?: number;
}

/** The vocabulary a Match condition offers, as the host read it. */
export interface WorkbenchMatchVocabulary {
  readonly tags: readonly string[];
  readonly collections: readonly string[];
  readonly libraries: readonly {
    readonly id: string;
    readonly name: string | null;
  }[];
}

/** A copy a reader asked for, and what the surface shows when it ends. */
export interface CopyJob {
  readonly copy: Effect.Effect<void, WorkbenchClipboardError>;
  readonly copied: () => void;
  readonly failed: () => void;
}

/** A chooser a reader opened, and what takes the choice. */
export interface ChooseJob {
  readonly choose: Effect.Effect<string | null>;
  readonly chosen: (id: string) => void;
}

/** A Shared Partial the reader names and creates from a completion. */
export interface CreatePartialJob {
  readonly create: Effect.Effect<string | null, WorkbenchHostError>;
  readonly created: (insert: string | null) => void;
}

export interface WorkbenchModel<
  R extends TemplateRenderResult = TemplateRenderResult,
> {
  readonly runtime: WorkbenchRuntime;
  readonly view: Atom.Writable<WorkbenchViewState>;
  readonly choices: Atom.Writable<WorkbenchChoices>;
  /** Which side panels the editor shows, and how wide and tall; the host saves them. */
  readonly panels: Atom.Writable<WorkbenchPanels>;
  /** The panels the editor started from, whose sizes a reset returns to. */
  readonly panelDefaults: WorkbenchPanels;
  /**
   * The handle a size menu entry last sized, whose new size the panels
   * announce; null once the reader sizes a panel with its handle, whose own
   * value a screen reader reads. Never saved.
   */
  readonly sizedFromMenu: Atom.Writable<PanelHandle | null>;
  /** The size of the view the host measured, or null until it has. */
  readonly viewSize: Atom.Atom<ViewSize | null>;
  /** Where each panel goes in the view as it is now; never saved. */
  readonly placement: Atom.Atom<PanelPlacement>;
  /**
   * Whether the Fields sheet stands open over the editor. Only the reader
   * opens it, at every width; never saved.
   */
  readonly fieldsSheet: Atom.Writable<boolean>;
  /**
   * Whether the Fields sheet the action opens stands open. A write presses
   * the action: it opens or closes the sheet.
   */
  readonly fieldsAction: Atom.Writable<FieldsAction, void>;
  /**
   * Makes an Item the choice. An Item the reader picked is the Citation set
   * they asked to see, so the built-in example that outranks it stands down.
   */
  readonly pick: Atom.Writable<WorkbenchItemChoice | null, WorkbenchItemChoice>;
  /** Writable unless the host derives it. */
  readonly itemData: Atom.Atom<WorkbenchItemData>;
  /** The chosen Item's annotations, and the one the examples render. */
  readonly examples: Atom.Atom<AnnotationExamples>;
  /** The Citation set the render reads, when the document reads one. */
  readonly citation: Atom.Atom<CitationPreviewSelection | null>;
  /** The Shared Partial the render draws, under its caller and Profile. */
  readonly partial: Atom.Atom<PartialPreviewSelection | null>;
  /**
   * The paper one render reads. A chosen Citation example carries its own
   * data and outranks the Item; otherwise the Item's data stands, and with
   * no Item at all the Sample Annotation's own parent does.
   */
  readonly snapshot: Atom.Atom<ItemSnapshot | null>;
  /** The controller in use; a host that loads another document sets it. */
  readonly controller: Atom.Writable<WorkbenchDocumentController>;
  readonly document: WorkbenchDocumentAtoms;
  /** The last Match filter that parsed, which stands while the draft does not. */
  readonly match: Atom.Atom<MatchTree | undefined>;
  readonly tab: Atom.Atom<WorkbenchTab>;
  readonly item: Atom.Atom<WorkbenchItemChoice | null>;
  readonly root: Atom.Atom<TemplateRoot>;
  readonly advanced: Atom.Atom<boolean>;
  readonly preview: Atom.Atom<WorkbenchPreviewSettings>;
  readonly input: Atom.Atom<RenderSchedulerInput>;
  readonly scheduler: RenderSchedulerAtoms<R>;
  /** The render's result when it is for the chosen annotation example, or null. */
  readonly annotationResult: Atom.Atom<R | null>;
  /** Counts the reader's retries of the Match reads; each one reads again. */
  readonly matchRetry: Atom.Writable<number>;
  /** The Match vocabulary, read again for each host vocabulary revision. */
  readonly matchVocabulary: (
    revision: string,
  ) => Atom.Atom<AsyncResult.AsyncResult<WorkbenchMatchVocabulary, unknown>>;
  /** The source's custom field names, read again for each revision. */
  readonly customFields: (
    revision: string,
  ) => Atom.Atom<AsyncResult.AsyncResult<readonly string[], unknown>>;
  /**
   * The Match test of one Item against one filter. The key is the JSON of
   * `[indexedKey, filter, revision]`; a failure or defect answers `failed`.
   */
  readonly matchTest: (
    key: string,
  ) => Atom.Atom<
    AsyncResult.AsyncResult<WorkbenchMatchResult | "failed", unknown>
  >;
  /** Copies for one surface; the surface's unmount interrupts its copy. */
  readonly copy: (surface: string) => Atom.AtomResultFn<CopyJob, void, unknown>;
  /** A chooser for one surface; it is open while the command runs. */
  readonly choose: (
    surface: string,
  ) => Atom.AtomResultFn<ChooseJob, void, unknown>;
  /** "New partial…" for one pane; the pane's unmount interrupts it. */
  readonly createPartial: (
    surface: string,
  ) => Atom.AtomResultFn<CreatePartialJob, void, unknown>;
}

export function makeWorkbenchModel<R extends TemplateRenderResult>({
  controller: initialController,
  initial,
  view = Atom.make<WorkbenchViewState>({ ...INITIAL_VIEW, ...initial }),
  choices: initialChoices,
  partialName = Atom.make<string | null>(null),
  itemData: deriveItemData,
  panels: initialPanels = INITIAL_PANELS,
  viewSize = Atom.make<ViewSize | null>(null),
  runtime,
  host,
  render,
  failed,
  retain,
  reportContext,
  debounceMs,
}: WorkbenchModelOptions<R>): WorkbenchModel<R> {
  const controller = Atom.make(initialController);
  const document = workbenchDocumentAtoms(controller);
  const itemData = deriveItemData
    ? deriveItemData({ controller, document })
    : Atom.make<WorkbenchItemData>({ snapshot: null });
  const field = <K extends keyof WorkbenchViewState>(key: K) =>
    Atom.map(view, (state) => state[key]);
  const choices = Atom.make<WorkbenchChoices>({
    ...INITIAL_CHOICES,
    ...initialChoices,
  });
  // Narrow reads, so a change to one choice re-runs only what reads it.
  const pick = <K extends keyof WorkbenchChoices>(key: K) =>
    Atom.map(choices, (state) => state[key]);
  const preview = pick("preview");
  const item = field("item");
  const root = field("root");
  const kind = Atom.map(controller, (current) => current.kind);
  const itemSnapshot = Atom.map(itemData, (data) => data.snapshot);
  const examples = Atom.make((get) =>
    annotationExamples(
      get(item) !== null,
      get(itemSnapshot),
      get(pick("annotationId")),
    ),
  );
  const example = Atom.withEquality(
    Atom.make((get) => get(examples).example),
    sameExample,
  );
  const citation = Atom.withEquality(
    Atom.make((get): CitationPreviewSelection | null => {
      const current = get(kind);
      const set =
        current === "citation" ||
        (current === "partial" && get(root) === "citation");
      if (!set) return null;
      return {
        variant: get(pick("variant")),
        example: get(pick("citationExample")),
      };
    }),
    sameFields,
  );
  const partial = Atom.withEquality(
    Atom.make((get): PartialPreviewSelection | null => {
      const name = get(partialName);
      if (get(kind) !== "partial" || name === null) return null;
      const context = get(root);
      return {
        name,
        context: isPartialContext(context) ? context : "note",
        profile: get(pick("partialProfile")),
      };
    }),
    sameFields,
  );
  const snapshot = Atom.make((get): ItemSnapshot | null => {
    if (get(citation)?.example) return CITATION_EXAMPLE_ITEM;
    const loaded = get(itemSnapshot);
    if (loaded) return loaded;
    const chosen = get(example);
    return get(item) === null && chosen
      ? sampleAnnotationParent(chosen.id)
      : null;
  });
  const input = Atom.make((get): RenderSchedulerInput => {
    const { mode, live } = get(preview);
    return {
      source: get(document.source),
      mode,
      live,
      annotation: get(example),
      citation: get(citation),
      partial: get(partial),
      ...get(itemData),
      snapshot: get(snapshot),
    };
  });
  const panels = Atom.make(initialPanels);
  const fieldsSheet = Atom.make(false);
  const placement = Atom.withEquality(
    Atom.make((get) =>
      placePanels(get(panels), get(viewSize), get(fieldsSheet)),
    ),
    sameFields,
  );
  const matchRetry = Atom.make(0);
  const scheduler = makeRenderSchedulerAtoms({
    runtime,
    input,
    render,
    failed,
    ...(retain ? { retain } : {}),
    ...(reportContext ? { reportContext } : {}),
    ...(debounceMs === undefined ? {} : { debounceMs }),
  });
  return {
    runtime,
    view,
    choices,
    panels,
    panelDefaults: initialPanels,
    sizedFromMenu: Atom.make<PanelHandle | null>(null),
    viewSize,
    placement,
    fieldsSheet,
    fieldsAction: Atom.writable(
      (get): FieldsAction => ({ open: get(fieldsSheet) }),
      (ctx) => ctx.set(fieldsSheet, !ctx.get(fieldsSheet)),
    ),
    pick: Atom.writable(
      (get) => get(item),
      (ctx, choice: WorkbenchItemChoice) => {
        ctx.set(view, chooseItem(choice)(ctx.get(view)));
        if (ctx.get(view).root === "citation")
          ctx.set(
            choices,
            chooseCitation({ citationExample: null })(ctx.get(choices)),
          );
      },
    ),
    itemData,
    examples,
    citation,
    partial,
    snapshot,
    controller,
    document,
    match: Atom.map(document.manifest, (manifest) => manifest?.match),
    tab: field("tab"),
    item,
    root,
    advanced: field("advanced"),
    preview,
    input,
    scheduler,
    annotationResult: Atom.make((get) => {
      const { result } = get(scheduler.state);
      const chosen = get(example);
      return chosen !== null &&
        result?.annotationId === chosen.id &&
        result.annotationRevision === chosen.revision
        ? result
        : null;
    }),
    matchRetry,
    matchVocabulary: Atom.family((_revision: string) =>
      runtime.atom((get) => {
        get(matchRetry);
        const { matchData } = host;
        return Effect.all(
          [matchData.tags, matchData.collections, matchData.libraries],
          { concurrency: "unbounded" },
        ).pipe(
          Effect.map(
            ([tags, collections, libraries]): WorkbenchMatchVocabulary => ({
              tags,
              collections: collections.map((path) => path.join("/")),
              libraries: libraries.map(({ id, name }) => ({
                id,
                name: name ?? null,
              })),
            }),
          ),
        );
      }),
    ),
    customFields: Atom.family((_revision: string) =>
      runtime.atom(Effect.suspend(() => host.matchData.customFields)),
    ),
    matchTest: Atom.family((key: string) =>
      runtime.atom((get) => {
        get(matchRetry);
        const [indexedKey, filter] = JSON.parse(key) as [string, string];
        return host.matchData.matches(indexedKey, filter).pipe(
          // A defect fails the test as a failure does.
          Effect.catchCause(() => Effect.succeed("failed" as const)),
        );
      }),
    ),
    copy: Atom.family((_surface: string) =>
      runtime.fn((job: CopyJob) =>
        job.copy.pipe(
          Effect.matchEffect({
            onSuccess: () => Effect.sync(job.copied),
            onFailure: () => Effect.sync(job.failed),
          }),
        ),
      ),
    ),
    choose: Atom.family((_surface: string) =>
      runtime.fn((job: ChooseJob) =>
        job.choose.pipe(
          Effect.flatMap((id) =>
            id === null ? Effect.void : Effect.sync(() => job.chosen(id)),
          ),
          // A chooser the host could not open closes as a dismissal does.
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.void,
          ),
        ),
      ),
    ),
    createPartial: Atom.family((_surface: string) =>
      runtime.fn((job: CreatePartialJob) =>
        job.create.pipe(
          Effect.flatMap((insert) => Effect.sync(() => job.created(insert))),
          // A flow that fails writes nothing.
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.void,
          ),
        ),
      ),
    ),
  };
}

/**
 * Presses the Fields action: opens or closes the Fields sheet. The view
 * action, the pane menu and the web View menu each press it.
 */
export function pressFieldsAction(
  registry: AtomRegistry.AtomRegistry,
  model: Pick<WorkbenchModel, "fieldsAction">,
): void {
  registry.set(model.fieldsAction, undefined);
}

/**
 * Keeps the model's writable state and its render alive in `registry`.
 * @returns Releases them.
 */
export function holdWorkbenchModel<R extends TemplateRenderResult>(
  registry: AtomRegistry.AtomRegistry,
  model: WorkbenchModel<R>,
): () => void {
  const releases = [
    model.view,
    model.choices,
    model.panels,
    model.sizedFromMenu,
    model.viewSize,
    model.fieldsSheet,
    model.itemData,
    model.controller,
    model.document.source,
    model.document.revision,
    model.scheduler.state,
  ].map((atom) => registry.mount(atom as Atom.Atom<unknown>));
  return () => {
    for (const release of releases.reverse()) release();
  };
}
