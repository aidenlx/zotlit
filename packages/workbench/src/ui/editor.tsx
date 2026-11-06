// One editor owns its document, view state, and compact render examples, all
// in the Workbench model.

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
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import { useUniqueId } from "@zotlit/ui";

import { NO_MATCH_DATA } from "./host";
import type { WorkbenchHost, WorkbenchHostError } from "./host";
import { holdWorkbenchModel, makeWorkbenchModel } from "./model";
import type {
  WorkbenchModel,
  WorkbenchModelOptions,
  WorkbenchRuntime,
  WorkbenchViewState,
} from "./model";

import { WorkbenchDocumentController as Controller } from "#/document/controller";

export interface WorkbenchEditorInstance<
  R extends TemplateRenderResult = TemplateRenderResult,
> extends Disposable {
  readonly model: WorkbenchModel<R>;
  /** The registry the model lives in. */
  readonly registry: AtomRegistry.AtomRegistry;
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
  /** What names this editor in the report a failed example is copied as. */
  reportContext?: () => WorkbenchReportContext;
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
  const model = makeWorkbenchModel<R>({
    controller,
    ...(providedView ? { view: providedView } : {}),
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
  const { registry, model } = editor;
  return (
    <RegistryContext.Provider value={registry}>
      <EditorContext.Provider value={{ model, registry, id }}>
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
