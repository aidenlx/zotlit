// The Workbench model: what one editor shows, as atoms that pure transitions change.
// The document controller stays the authority on the document's text; the model
// holds the controller in use, the reader's choices, and the render scheduler.

import type { WorkbenchDocumentAtoms } from "#/document/atoms";
import type { WorkbenchDocumentController } from "#/document/controller";
import type { CitationPreviewSelection } from "#/render/citation-examples";
import type { PartialPreviewSelection } from "#/render/partial-preview";
import type { WorkbenchReportContext } from "#/render/report";
import type { RenderRequest, RenderResources } from "#/render/request";
import type { TemplateRenderResult } from "#/render/result";
import type { AnnotationExample } from "#/render/sample-annotations";
import type { ItemSnapshot } from "#/snapshot/index";
import { Layer } from "effect";
import type { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type { WorkbenchHostError } from "./host";
import type { RenderSchedulerInput } from "./scheduler";
import { makeRenderSchedulerAtoms } from "./scheduler-atoms";
import type { RenderSchedulerAtoms } from "./scheduler-atoms";
import type {
  PreviewMode,
  TemplateRoot,
  WorkbenchItemChoice,
  WorkbenchViewState,
} from "./store";
import type { WorkbenchTab } from "./tabs";

import { workbenchDocumentAtoms } from "#/document/atoms";

/** How the preview renders and shows its result. */
export interface WorkbenchPreviewSettings {
  readonly mode: PreviewMode;
  /** Renders after the quiet time when on; only on Run when off. */
  readonly live: boolean;
  readonly showMarkdown: boolean;
  readonly showManaged: boolean;
}

/** What the reader chose to render the document against, beside the Item. */
export interface WorkbenchChoices {
  readonly annotation: AnnotationExample | null;
  readonly citation: CitationPreviewSelection | null;
  /** A Shared Partial's caller and Profile. */
  readonly partial: PartialPreviewSelection | null;
  readonly preview: WorkbenchPreviewSettings;
}

/**
 * The chosen Item's data, which the host still supplies through the
 * scheduler facade's `setInput`. Expand step only: the derived read of the
 * chosen Item replaces it (#1942).
 */
export interface WorkbenchItemData {
  readonly snapshot: ItemSnapshot | null;
  readonly document?: string | undefined;
  readonly resources?: RenderResources | undefined;
  readonly hold?: boolean | "invalid" | undefined;
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
  customization: "idle",
};

export const INITIAL_CHOICES: WorkbenchChoices = {
  annotation: null,
  citation: null,
  partial: null,
  preview: {
    mode: "create",
    live: true,
    showMarkdown: false,
    showManaged: false,
  },
};

/** Applies `patch`, or keeps `state` itself when every field already holds. */
const patch =
  <S extends object>(changes: Partial<S>) =>
  (state: S): S =>
    (Object.keys(changes) as (keyof S)[]).every(
      (key) => state[key] === changes[key],
    )
      ? state
      : { ...state, ...changes };

export const setTab = (tab: WorkbenchTab) => patch<WorkbenchViewState>({ tab });
export const chooseItem = (item: WorkbenchItemChoice | null) =>
  patch<WorkbenchViewState>({ item });
export const setRoot = (root: TemplateRoot) =>
  patch<WorkbenchViewState>({ root });
export const setAdvanced = (advanced: boolean) =>
  patch<WorkbenchViewState>({ advanced });
export const chooseAnnotation = (annotation: AnnotationExample | null) =>
  patch<WorkbenchChoices>({ annotation });
export const chooseCitation = (citation: CitationPreviewSelection | null) =>
  patch<WorkbenchChoices>({ citation });
export const choosePartial = (partial: PartialPreviewSelection | null) =>
  patch<WorkbenchChoices>({ partial });
export const setPreview =
  (settings: Partial<WorkbenchPreviewSettings>) =>
  (state: WorkbenchChoices): WorkbenchChoices => {
    const preview = patch<WorkbenchPreviewSettings>(settings)(state.preview);
    return preview === state.preview ? state : { ...state, preview };
  };

export interface WorkbenchModelOptions<R extends TemplateRenderResult> {
  readonly controller: WorkbenchDocumentController;
  /** The view state to start from. */
  readonly initial?: Partial<WorkbenchViewState>;
  /** The view state, when a host keeps it in an atom of its own. */
  readonly view?: Atom.Writable<WorkbenchViewState>;
  /** The runtime every render and command of this editor runs on. */
  readonly runtime?: Atom.AtomRuntime<never>;
  readonly render: (
    request: RenderRequest,
  ) => Effect.Effect<R, WorkbenchHostError>;
  readonly failed: (result: TemplateRenderResult) => R;
  readonly retain?: (kept: R, result: R) => R;
  readonly reportContext?: () => WorkbenchReportContext;
  readonly debounceMs?: number;
}

export interface WorkbenchModel<
  R extends TemplateRenderResult = TemplateRenderResult,
> {
  readonly runtime: Atom.AtomRuntime<never>;
  readonly view: Atom.Writable<WorkbenchViewState>;
  readonly choices: Atom.Writable<WorkbenchChoices>;
  readonly itemData: Atom.Writable<WorkbenchItemData>;
  /** The controller in use; a host that loads another document sets it. */
  readonly controller: Atom.Writable<WorkbenchDocumentController>;
  readonly document: WorkbenchDocumentAtoms;
  readonly tab: Atom.Atom<WorkbenchTab>;
  readonly item: Atom.Atom<WorkbenchItemChoice | null>;
  readonly root: Atom.Atom<TemplateRoot>;
  readonly advanced: Atom.Atom<boolean>;
  readonly preview: Atom.Atom<WorkbenchPreviewSettings>;
  readonly input: Atom.Atom<RenderSchedulerInput>;
  readonly scheduler: RenderSchedulerAtoms<R>;
}

export function makeWorkbenchModel<R extends TemplateRenderResult>({
  controller: initialController,
  initial,
  view = Atom.make<WorkbenchViewState>({ ...INITIAL_VIEW, ...initial }),
  runtime = Atom.runtime(Layer.empty),
  render,
  failed,
  retain,
  reportContext,
  debounceMs,
}: WorkbenchModelOptions<R>): WorkbenchModel<R> {
  const choices = Atom.make(INITIAL_CHOICES);
  const itemData = Atom.make<WorkbenchItemData>({ snapshot: null });
  const controller = Atom.make(initialController);
  const document = workbenchDocumentAtoms(controller);
  const field = <K extends keyof WorkbenchViewState>(key: K) =>
    Atom.map(view, (state) => state[key]);
  const preview = Atom.map(choices, (state) => state.preview);
  const input = Atom.make((get): RenderSchedulerInput => {
    const { annotation, citation, partial, preview } = get(choices);
    return {
      source: get(document.source),
      mode: preview.mode,
      live: preview.live,
      annotation,
      citation,
      partial,
      ...get(itemData),
    };
  });
  return {
    runtime,
    view,
    choices,
    itemData,
    controller,
    document,
    tab: field("tab"),
    item: field("item"),
    root: field("root"),
    advanced: field("advanced"),
    preview,
    input,
    scheduler: makeRenderSchedulerAtoms({
      runtime,
      input,
      render,
      failed,
      ...(retain ? { retain } : {}),
      ...(reportContext ? { reportContext } : {}),
      ...(debounceMs === undefined ? {} : { debounceMs }),
    }),
  };
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
