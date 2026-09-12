// One editor owns its document, view state, and compact render examples.
// Companion views consume source values through their own render owners.

import type { WorkbenchDocumentController } from "#/document/controller";
import type { TemplateRenderResult } from "#/render/result";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";

import type { WorkbenchHost } from "./host";
import { createRenderScheduler } from "./scheduler";
import type { RenderScheduler, RenderSchedulerState } from "./scheduler";
import { createWorkbenchStore } from "./store";
import type {
  WorkbenchStore,
  WorkbenchViewActions,
  WorkbenchViewState,
} from "./store";

export interface WorkbenchEditorInstance<
  R extends TemplateRenderResult = TemplateRenderResult,
> extends Disposable {
  readonly store: WorkbenchStore;
  readonly scheduler: RenderScheduler<R>;
  attach(controller: WorkbenchDocumentController): void;
}

interface WorkbenchEditorOptions {
  controller: WorkbenchDocumentController;
  host: WorkbenchHost;
  state?: Partial<WorkbenchViewState>;
  /** A host may initialize its pure view store before acquiring render resources. */
  store?: WorkbenchStore;
}

/** Own one editor's view state and rendering through its host adapter. */
export function createWorkbenchEditor<R extends TemplateRenderResult>(
  options: WorkbenchEditorOptions & {
    mapResult: (result: TemplateRenderResult) => R;
  },
): WorkbenchEditorInstance<R>;
export function createWorkbenchEditor(
  options: WorkbenchEditorOptions,
): WorkbenchEditorInstance;
export function createWorkbenchEditor({
  controller,
  host,
  state,
  store: providedStore,
  mapResult,
}: WorkbenchEditorOptions & {
  mapResult?: (result: TemplateRenderResult) => TemplateRenderResult;
}): WorkbenchEditorInstance {
  const store =
    providedStore ??
    createWorkbenchStore(
      controller.document?.manifest.id === "default" && state?.tab === "match"
        ? { ...state, tab: "note" }
        : state,
    );
  const scheduler = createRenderScheduler({
    input: {
      source: controller.source,
      snapshot: null,
      mode: "create",
      live: true,
    },
    render: (request) => {
      const result = host.render(request);
      return mapResult ? result.then(mapResult) : result;
    },
    failed: mapResult ?? ((result) => result),
  });
  function follow(next: WorkbenchDocumentController) {
    scheduler.setInput({ source: next.source });
    return next.subscribe(({ docChanged }) => {
      if (docChanged) scheduler.setInput({ source: next.source });
    });
  }
  let unfollow = follow(controller);
  return {
    store,
    scheduler,
    attach(next) {
      unfollow();
      unfollow = follow(next);
    },
    [Symbol.dispose]() {
      unfollow();
      scheduler[Symbol.dispose]();
    },
  };
}

export interface WorkbenchEditor {
  readonly store: WorkbenchStore;
  readonly controller: WorkbenchDocumentController;
  /** The scheduler for this editor's compact examples. */
  readonly scheduler: RenderScheduler;
  /** The prefix of this instance's element ids. */
  readonly id: string;
}

const EditorContext = createContext<WorkbenchEditor | null>(null);

/** Never written: what the tree reads where no editor is in context. */
const INERT_STORE = createWorkbenchStore();

const INERT_STATE: RenderSchedulerState = {
  result: null,
  retained: null,
  busy: false,
  stale: false,
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

export function WorkbenchEditorProvider({
  store,
  controller,
  scheduler,
  children,
}: {
  store: WorkbenchStore;
  controller: WorkbenchDocumentController;
  scheduler: RenderScheduler;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <EditorContext.Provider value={{ store, controller, scheduler, id }}>
      {children}
    </EditorContext.Provider>
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

export function useWorkbenchStore<T>(
  selector: (state: WorkbenchViewState & WorkbenchViewActions) => T,
): T {
  return useStore(useContext(EditorContext)?.store ?? INERT_STORE, selector);
}

export function useWorkbenchController(): WorkbenchDocumentController {
  return useWorkbenchEditor().controller;
}

/** The scheduler in context, or an inert one where the tree paints inert. */
export function useRenderScheduler(): RenderScheduler {
  return useContext(EditorContext)?.scheduler ?? INERT_SCHEDULER;
}

/**
 * What the result surfaces paint. A host that holds its scheduler above the
 * editor provider, as the web page does, passes it rather than the context one.
 * A null owner has not acquired its scheduler yet and reads the inert state.
 */
export function useRenderState(
  scheduler?: RenderScheduler | null,
): RenderSchedulerState {
  const inContext = useRenderScheduler();
  const read = scheduler === null ? INERT_SCHEDULER : (scheduler ?? inContext);
  return useSyncExternalStore(read.subscribe, read.getState);
}

/**
 * Re-renders the caller on every document update, and hands back the count
 * so a memo can key on it. Without a controller the count stays at zero.
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
