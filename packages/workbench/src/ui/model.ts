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
import { Cause, Effect, Option } from "effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type { MatchTree } from "@zotlit/templates/facade";

import type {
  WorkbenchClipboardError,
  WorkbenchHostError,
  WorkbenchMatchData,
  WorkbenchMatchResult,
} from "./host";
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
 * The chosen Item's data. A host that reads it derives it from the chosen
 * Item (`itemData` option); otherwise it is the value the scheduler facade's
 * `setInput` writes (#1946).
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

/** Applies `changes`, or keeps `state` itself when every field already holds. */
export const patch =
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

/** The runtime every read, render, and command of one host runs on. */
export type WorkbenchRuntime = Atom.AtomRuntime<never, unknown>;

export interface WorkbenchModelOptions<R extends TemplateRenderResult> {
  readonly controller: WorkbenchDocumentController;
  /** The view state to start from. */
  readonly initial?: Partial<WorkbenchViewState>;
  /** The view state, when a host keeps it in an atom of its own. */
  readonly view?: Atom.Writable<WorkbenchViewState>;
  /** The reader's choices, when a host derives them from atoms of its own. */
  readonly choices?: Atom.Atom<WorkbenchChoices>;
  /**
   * The chosen Item's data, when a host derives it from its own read of the
   * chosen Item. It reads the document's atoms for what the draft decides,
   * such as a draft that does not parse.
   */
  readonly itemData?: (
    document: WorkbenchDocumentAtoms,
  ) => Atom.Atom<WorkbenchItemData>;
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
  readonly choices: Atom.Atom<WorkbenchChoices>;
  readonly itemData: Atom.Atom<WorkbenchItemData>;
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
  choices: hostChoices,
  itemData: deriveItemData,
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
  const choices = hostChoices ?? Atom.make(INITIAL_CHOICES);
  const itemData =
    deriveItemData?.(document) ??
    Atom.make<WorkbenchItemData>({ snapshot: null });
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
  const match = Atom.make((get) => {
    get(document.revision);
    const current = get(controller);
    const parsed = current.document;
    const previous = Option.getOrUndefined(
      get.self<{
        readonly controller: WorkbenchDocumentController;
        readonly match: MatchTree | undefined;
      }>(),
    );
    return {
      controller: current,
      match: parsed
        ? parsed.manifest.match
        : previous?.controller === current
          ? previous.match
          : undefined,
    };
  });
  const matchRetry = Atom.make(0);
  return {
    runtime,
    view,
    choices,
    itemData,
    controller,
    document,
    match: Atom.map(match, (state) => state.match),
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
