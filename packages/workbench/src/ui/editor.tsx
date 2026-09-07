// One editor instance in context: its view store and the document controller
// that is the authority on the document. Outside the provider the tree paints
// inert, which is how the web's skeleton shows the chrome before the editor
// bundle arrives.

import type { WorkbenchDocumentController } from "#/document/controller";
import { createContext, useContext, useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";

import { createWorkbenchStore } from "./store";
import type {
  WorkbenchStore,
  WorkbenchViewActions,
  WorkbenchViewState,
} from "./store";

export interface WorkbenchEditor {
  readonly store: WorkbenchStore;
  readonly controller: WorkbenchDocumentController;
  /** The prefix of this instance's element ids. */
  readonly id: string;
}

const EditorContext = createContext<WorkbenchEditor | null>(null);

/** Never written: what the tree reads where no editor is in context. */
const INERT_STORE = createWorkbenchStore();

export function WorkbenchEditorProvider({
  store,
  controller,
  children,
}: {
  store: WorkbenchStore;
  controller: WorkbenchDocumentController;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <EditorContext.Provider value={{ store, controller, id }}>
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
