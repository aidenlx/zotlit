// One editor instance in context: its view store, the document controller that
// is the authority on the document, and the one Render Scheduler every result
// surface reads. Outside the provider the tree paints inert, which is how the
// web's skeleton shows the chrome before the editor bundle arrives.

import type { WorkbenchDocumentController } from "#/document/controller";
import type { ProfileRenderResult } from "#/render/result";
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
  R extends ProfileRenderResult = ProfileRenderResult,
> extends Disposable {
  readonly store: WorkbenchStore;
  readonly scheduler: RenderScheduler<R>;
}

interface WorkbenchEditorOptions {
  controller: WorkbenchDocumentController;
  host: WorkbenchHost;
  state?: Partial<WorkbenchViewState>;
}

/** Own one editor's view state and rendering through its host adapter. */
export function createWorkbenchEditor<R extends ProfileRenderResult>(
  options: WorkbenchEditorOptions & {
    mapResult: (result: ProfileRenderResult) => R;
  },
): WorkbenchEditorInstance<R>;
export function createWorkbenchEditor(
  options: WorkbenchEditorOptions,
): WorkbenchEditorInstance;
export function createWorkbenchEditor({
  controller,
  host,
  state,
  mapResult,
}: WorkbenchEditorOptions & {
  mapResult?: (result: ProfileRenderResult) => ProfileRenderResult;
}): WorkbenchEditorInstance {
  const store = createWorkbenchStore(state);
  const scheduler = createRenderScheduler({
    controller,
    store,
    render: (request) => {
      const result = host.render(request);
      return mapResult ? result.then(mapResult) : result;
    },
    failed: mapResult ?? ((result) => result),
  });
  return {
    store,
    scheduler,
    [Symbol.dispose]() {
      scheduler[Symbol.dispose]();
    },
  };
}

export interface WorkbenchEditor {
  readonly store: WorkbenchStore;
  readonly controller: WorkbenchDocumentController;
  /** The one scheduler this instance's result surfaces share. */
  readonly scheduler: RenderScheduler;
  /** The prefix of this instance's element ids. */
  readonly id: string;
}

const EditorContext = createContext<WorkbenchEditor | null>(null);

/** Never written: what the tree reads where no editor is in context. */
const INERT_STORE = createWorkbenchStore();

const INERT_STATE: RenderSchedulerState = {
  result: null,
  busy: false,
  stale: false,
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
  attach() {},
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
 */
export function useRenderState(
  scheduler?: RenderScheduler,
): RenderSchedulerState {
  const inContext = useRenderScheduler();
  const read = scheduler ?? inContext;
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
