// The view state of one editor instance: what is shown, not what the document
// says. The `WorkbenchDocumentController` remains the document authority; this
// store is the object a host hands across its leaves (ADR 0044).

import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import type { WorkbenchTab } from "./tabs";

/** The template root a pane edits, which the Explorer and the preview follow. */
export type TemplateRoot = "note" | "annotation" | "filename";

/** The Data Explorer's two renderings. */
export type ExplorerVariant = "simple" | "all";

/** What the preview shows: a new note, or an existing note after Update. */
export type PreviewMode = "create" | "update";

/** The Item the editor is shown against, as the host names it. */
export interface WorkbenchItemChoice {
  /** A Sample Item's id, or the host's Item key. */
  readonly id: string;
  readonly title: string | null;
}

export interface WorkbenchViewState {
  readonly tab: WorkbenchTab;
  readonly item: WorkbenchItemChoice | null;
  /** The root the focused editor writes. */
  readonly root: TemplateRoot;
  readonly preview: {
    readonly mode: PreviewMode;
    /** Whether the preview renders as the reader types. */
    readonly live: boolean;
  };
  readonly explorer: ExplorerVariant;
  /** Whether the whole document is open in the Advanced editor. */
  readonly advanced: boolean;
  readonly startHereDismissed: boolean;
  /** Progress of the explicit action that creates the built-in Profile document. */
  readonly customization: "idle" | "pending" | "failed";
}

export interface WorkbenchViewActions {
  readonly setTab: (tab: WorkbenchTab) => void;
  readonly setItem: (item: WorkbenchItemChoice | null) => void;
  readonly setRoot: (root: TemplateRoot) => void;
  readonly setPreview: (
    preview: Partial<WorkbenchViewState["preview"]>,
  ) => void;
  readonly setExplorer: (explorer: ExplorerVariant) => void;
  readonly setAdvanced: (advanced: boolean) => void;
  readonly dismissStartHere: () => void;
}

export type WorkbenchStore = StoreApi<
  WorkbenchViewState & WorkbenchViewActions
>;

const INITIAL: WorkbenchViewState = {
  tab: "note",
  item: null,
  root: "note",
  preview: { mode: "create", live: true },
  explorer: "simple",
  advanced: false,
  startHereDismissed: false,
  customization: "idle",
};

export function createWorkbenchStore(
  initial: Partial<WorkbenchViewState> = {},
): WorkbenchStore {
  return createStore<WorkbenchViewState & WorkbenchViewActions>()((set) => ({
    ...INITIAL,
    ...initial,
    setTab: (tab) => set({ tab }),
    setItem: (item) => set({ item }),
    setRoot: (root) => set({ root }),
    setPreview: (preview) =>
      set((state) => ({ preview: { ...state.preview, ...preview } })),
    setExplorer: (explorer) => set({ explorer }),
    setAdvanced: (advanced) => set({ advanced }),
    dismissStartHere: () => set({ startHereDismissed: true }),
  }));
}
