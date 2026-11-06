// One editor owns its document, view state, and compact render examples, all
// in the Workbench model. The store and scheduler objects it also hands out
// are a facade over that model for the hosts that still read them (#1946).

import type { WorkbenchDocumentController } from "#/document/controller";
import type { WorkbenchReportContext } from "#/render/report";
import type { TemplateRenderResult } from "#/render/result";
import {
  RegistryContext,
  RegistryProvider,
  useAtomValue,
} from "@effect/atom-react";
import { Effect, Layer } from "effect";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";

import { useUniqueId } from "@zotlit/ui";

import { NO_MATCH_DATA } from "./host";
import type { WorkbenchHost, WorkbenchHostError } from "./host";
import {
  chooseAnnotation,
  chooseCitation,
  choosePartial,
  holdWorkbenchModel,
  makeWorkbenchModel,
  patch,
  setPreview,
} from "./model";
import type {
  WorkbenchItemData,
  WorkbenchModel,
  WorkbenchModelOptions,
  WorkbenchRuntime,
} from "./model";
import type {
  RenderScheduler,
  RenderSchedulerInput,
  RenderSchedulerState,
} from "./scheduler";
import { createWorkbenchStore } from "./store";
import type {
  WorkbenchStore,
  WorkbenchViewActions,
  WorkbenchViewState,
} from "./store";

import { WorkbenchDocumentController as Controller } from "#/document/controller";

export interface WorkbenchEditorInstance<
  R extends TemplateRenderResult = TemplateRenderResult,
> extends Disposable {
  readonly model: WorkbenchModel<R>;
  /** The registry the model lives in. */
  readonly registry: AtomRegistry.AtomRegistry;
  /** Facade over `model.view` for hosts; deleted in #1946. */
  readonly store: WorkbenchStore;
  /** Facade over `model.scheduler` for hosts; deleted in #1946. */
  readonly scheduler: RenderScheduler<R>;
  /** Sets the controller in use to one the host loaded. */
  attach(controller: WorkbenchDocumentController): void;
}

interface WorkbenchEditorOptions {
  controller: WorkbenchDocumentController;
  /** The host members the model reads: its render and its Match data. */
  host: Pick<WorkbenchHost, "render" | "matchData">;
  state?: Partial<WorkbenchViewState>;
  /**
   * The registry to keep the model in, which the host disposes. Without one
   * the editor keeps a registry of its own and disposes it with itself.
   */
  registry?: AtomRegistry.AtomRegistry;
  /** The host's one runtime, which every editor of the host shares. */
  runtime: WorkbenchRuntime;
  /** The view state, when the host keeps it in an atom of its own. */
  view?: Atom.Writable<WorkbenchViewState>;
  /** The chosen Item's data, when the host derives it from its own read. */
  itemData?: WorkbenchModelOptions<TemplateRenderResult>["itemData"];
  /** {@link WorkbenchModelOptions.choices} */
  choices?: WorkbenchModelOptions<TemplateRenderResult>["choices"];
  /**
   * A view store the host made before the editor, which the model reads and
   * writes. Facade for the web Workbench; deleted in #1946.
   */
  store?: WorkbenchStore;
  /** What names this editor in the report a failed example is copied as. */
  reportContext?: () => WorkbenchReportContext;
}

/** The view fields of a store state, without its actions. */
function viewOf(state: WorkbenchViewState): WorkbenchViewState {
  const { presentation, tab, item, root, advanced, customization } = state;
  return { presentation, tab, item, root, advanced, customization };
}

/** An atom over a store the host owns: reads follow it, writes go to it. */
function storeAtom(store: WorkbenchStore): Atom.Writable<WorkbenchViewState> {
  const view: Atom.Writable<WorkbenchViewState> = Atom.writable(
    (get) => {
      get.addFinalizer(store.subscribe((state) => get.setSelf(viewOf(state))));
      return viewOf(store.getState());
    },
    (ctx, value) => {
      if (value !== ctx.get(view)) store.setState(value);
    },
  );
  return view;
}

/** A store-shaped facade over the model's view atom. */
function storeOver(
  registry: AtomRegistry.AtomRegistry,
  view: Atom.Writable<WorkbenchViewState>,
): WorkbenchStore {
  const update = (changes: Partial<WorkbenchViewState>) =>
    registry.update(view, patch(changes));
  const actions: WorkbenchViewActions = {
    setTab: (tab) => update({ tab }),
    setItem: (item) => update({ item }),
    setRoot: (root) => update({ root }),
    setAdvanced: (advanced) => update({ advanced }),
  };
  const state = Atom.map(view, (state) => ({ ...state, ...actions }));
  const initial = { ...registry.get(view), ...actions };
  return {
    getState: () => registry.get(state),
    getInitialState: () => initial,
    setState: (patch) => {
      const current = registry.get(state);
      update(typeof patch === "function" ? patch(current) : patch);
    },
    subscribe: (listener) => {
      let previous = registry.get(state);
      return registry.subscribe(state, (next) => {
        const before = previous;
        previous = next;
        listener(next, before);
      });
    },
  };
}

/** A scheduler-shaped facade over the model's scheduler atoms. */
function schedulerOver<R extends TemplateRenderResult>(
  registry: AtomRegistry.AtomRegistry,
  model: WorkbenchModel<R>,
  closed: () => boolean,
): RenderScheduler<R> {
  const command = (atom: Atom.Writable<void, void>) => () => {
    if (!closed()) registry.set(atom, undefined);
  };
  return {
    getState: () => registry.get(model.scheduler.state),
    subscribe: (listener) =>
      registry.subscribe(model.scheduler.state, () => listener()),
    setInput(input: Partial<RenderSchedulerInput>) {
      if (closed()) return;
      // The controller in use owns the source; the rest is the reader's
      // choice or the chosen Item's data.
      const { mode, live, annotation, citation, partial } = input;
      const data: Partial<WorkbenchItemData> = {
        ...("snapshot" in input ? { snapshot: input.snapshot ?? null } : {}),
        ...("document" in input ? { document: input.document } : {}),
        ...("resources" in input ? { resources: input.resources } : {}),
        ...("hold" in input ? { hold: input.hold } : {}),
      };
      Atom.batch(() => {
        registry.update(
          model.choices,
          setPreview({
            ...(mode === undefined ? {} : { mode }),
            ...(live === undefined ? {} : { live }),
          }),
        );
        if ("annotation" in input)
          registry.update(model.choices, chooseAnnotation(annotation ?? null));
        if ("citation" in input)
          registry.update(model.choices, chooseCitation(citation ?? null));
        if ("partial" in input)
          registry.update(model.choices, choosePartial(partial ?? null));
        // A host that derives the Item's data supplies none here.
        if (Atom.isWritable(model.itemData))
          registry.update(model.itemData, patch(data));
      });
    },
    invalidate: command(model.scheduler.invalidate),
    run: command(model.scheduler.run),
    pause: command(model.scheduler.pause),
    fail: (diagnostic) => {
      if (!closed()) registry.set(model.scheduler.fail, diagnostic);
    },
    // The editor owns the scheduler; disposing the editor stops it.
    [Symbol.dispose]() {},
  };
}

/** Own one editor's view state and rendering through its host adapter. */
export function createWorkbenchEditor<R extends TemplateRenderResult>(
  options: WorkbenchEditorOptions & {
    mapResult: (result: TemplateRenderResult) => R;
    retain?: (kept: R, result: R) => R;
  },
): WorkbenchEditorInstance<R>;
export function createWorkbenchEditor(
  options: WorkbenchEditorOptions,
): WorkbenchEditorInstance;
export function createWorkbenchEditor<R extends TemplateRenderResult>({
  controller,
  host,
  state,
  registry: providedRegistry,
  runtime,
  view: providedView,
  choices,
  itemData,
  store: providedStore,
  reportContext,
  mapResult,
  retain,
}: WorkbenchEditorOptions & {
  mapResult?: (result: TemplateRenderResult) => R;
  retain?: (kept: R, result: R) => R;
}): WorkbenchEditorInstance<R> {
  const registry =
    providedRegistry ?? AtomRegistry.make({ defaultIdleTTL: 400 });
  const initial =
    controller.document?.manifest.id === "default" && state?.tab === "match"
      ? { ...state, tab: "note" as const }
      : state;
  const view = providedView ?? (providedStore && storeAtom(providedStore));
  const model = makeWorkbenchModel<R>({
    controller,
    ...(view ? { view } : {}),
    ...(choices ? { choices } : {}),
    ...(itemData ? { itemData } : {}),
    ...(initial ? { initial } : {}),
    runtime,
    host,
    render: (request) => {
      const result = host.render(request);
      return mapResult
        ? Effect.map(result, mapResult)
        : (result as Effect.Effect<R, WorkbenchHostError>);
    },
    failed: mapResult ?? ((result) => result as R),
    ...(retain ? { retain } : {}),
    ...(reportContext ? { reportContext } : {}),
  });
  const release = holdWorkbenchModel(registry, model);
  let closed = false;
  return {
    model,
    registry,
    store: providedStore ?? storeOver(registry, model.view),
    scheduler: schedulerOver(registry, model, () => closed),
    attach(next) {
      registry.set(model.controller, next);
    },
    [Symbol.dispose]() {
      if (closed) return;
      closed = true;
      release();
      if (providedRegistry === undefined) registry.dispose();
    },
  };
}

export interface WorkbenchEditor {
  readonly model: WorkbenchModel;
  readonly registry: AtomRegistry.AtomRegistry;
  /** Facade for hosts; deleted in #1946. */
  readonly store: WorkbenchStore;
  /** Facade for hosts; deleted in #1946. */
  readonly scheduler: RenderScheduler;
  /** The prefix of this instance's element ids. */
  readonly id: string;
}

const EditorContext = createContext<WorkbenchEditor | null>(null);

let inert: WorkbenchModel | undefined;
/**
 * Never renders and is never written: what the tree reads where no editor is
 * in context. Made on first read, so importing the package builds nothing.
 */
function inertModel(): WorkbenchModel {
  inert ??= makeWorkbenchModel({
    controller: new Controller(""),
    runtime: Atom.runtime(Layer.empty),
    host: { matchData: NO_MATCH_DATA },
    render: () => Effect.die("An inert Workbench never renders."),
    failed: (result) => result,
  });
  return inert;
}

/** A browser task, as the registry schedules its notifications. */
function scheduleTask(task: () => void): () => void {
  const timeout = setTimeout(task, 0);
  return () => clearTimeout(timeout);
}

/**
 * Puts `editor` and its registry in context. `null` paints the tree inert in
 * a registry of its own, which goes with the provider.
 */
export function WorkbenchEditorProvider<R extends TemplateRenderResult>({
  editor,
  children,
}: {
  editor: WorkbenchEditorInstance<R> | null;
  children?: ReactNode;
}) {
  const id = useUniqueId();
  if (editor === null)
    return (
      <RegistryProvider scheduleTask={scheduleTask} defaultIdleTTL={400}>
        {children}
      </RegistryProvider>
    );
  const { registry, model, store, scheduler } = editor;
  return (
    <RegistryContext.Provider value={registry}>
      <EditorContext.Provider value={{ model, registry, store, scheduler, id }}>
        {children}
      </EditorContext.Provider>
    </RegistryContext.Provider>
  );
}

/** The editor in context, or `null` where the tree paints inert. */
export function useOptionalEditor(): WorkbenchEditor | null {
  return useContext(EditorContext);
}

export function useWorkbenchEditor(): WorkbenchEditor {
  const editor = useContext(EditorContext);
  if (editor === null) {
    throw new Error(
      "The Workbench UI needs a WorkbenchEditorProvider above it.",
    );
  }
  return editor;
}

/** The model in context, or an inert one where the tree paints inert. */
export function useWorkbenchModel(): WorkbenchModel {
  return useContext(EditorContext)?.model ?? inertModel();
}

/** The controller in use, which follows a replacement the host attaches. */
export function useWorkbenchController(): WorkbenchDocumentController {
  return useAtomValue(useWorkbenchEditor().model.controller);
}

// Facade hooks: hosts read them until #1941 and #1942 move them to the model.

/** Never written: what `useWorkbenchStore` reads where no editor is in context. */
const INERT_STORE = createWorkbenchStore();

const INERT_STATE: RenderSchedulerState = {
  result: null,
  retained: null,
  busy: false,
  staleReason: null,
  trigger: null,
  attempt: 0,
};

/** Never renders: what the tree reads where no editor is in context. */
const INERT_SCHEDULER: RenderScheduler = {
  getState: () => INERT_STATE,
  subscribe: () => () => {},
  setInput() {},
  invalidate() {},
  run() {},
  pause() {},
  fail() {},
  [Symbol.dispose]() {},
};

/** Facade for hosts; components read `useWorkbenchModel`. Deleted in #1946. */
export function useWorkbenchStore<T>(
  selector: (state: WorkbenchViewState & WorkbenchViewActions) => T,
): T {
  return useStore(useContext(EditorContext)?.store ?? INERT_STORE, selector);
}

/** The scheduler facade in context, or an inert one. Deleted in #1946. */
export function useRenderScheduler(): RenderScheduler {
  return useContext(EditorContext)?.scheduler ?? INERT_SCHEDULER;
}

/**
 * What a host's own result surface paints, from a scheduler it holds; a null
 * owner reads the inert state. Facade for hosts; deleted in #1946.
 */
export function useRenderState(
  scheduler?: RenderScheduler | null,
): RenderSchedulerState {
  const inContext = useRenderScheduler();
  const read = scheduler === null ? INERT_SCHEDULER : (scheduler ?? inContext);
  return useSyncExternalStore(read.subscribe, read.getState);
}

/**
 * Re-renders the caller on every document update. Facade for hosts;
 * components read `model.document.revision`. Deleted in #1946.
 */
export function useDocumentRevision(
  controller: WorkbenchDocumentController | null,
): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (controller === null) return;
    return controller.subscribe(() => setRevision((count) => count + 1));
  }, [controller]);
  return revision;
}
