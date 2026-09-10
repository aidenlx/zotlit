// The view state of one editor instance: what is shown, not what the document
// says. The `WorkbenchDocumentController` remains the document authority; this
// store stays with this editor; companions own their separate view state.

import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import type { WorkbenchInsertTarget } from "./host";
import type { SliceReveal } from "./slice-editor";
import type { WorkbenchTab } from "./tabs";

/** The template root a pane edits, which the Explorer and the preview follow. */
export type TemplateRoot = "note" | "annotation" | "filename";

/** The Data Explorer's two renderings. */

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

export interface WorkbenchViewState {
  readonly presentation: EditorPresentation;
  readonly tab: WorkbenchTab;
  readonly item: WorkbenchItemChoice | null;
  /** The root the focused editor writes. */
  readonly root: TemplateRoot;
  /** Whether the whole document is open in the Advanced editor. */
  readonly advanced: boolean;
  /** Progress of the explicit action that creates the built-in Profile document. */
  readonly customization: "idle" | "pending" | "failed";
}

export interface WorkbenchViewActions {
  readonly setTab: (tab: WorkbenchTab) => void;
  readonly setItem: (item: WorkbenchItemChoice | null) => void;
  readonly setRoot: (root: TemplateRoot) => void;
  readonly setAdvanced: (advanced: boolean) => void;
}

export type WorkbenchStore = StoreApi<
  WorkbenchViewState & WorkbenchViewActions
>;

const INITIAL: WorkbenchViewState = {
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

export function createWorkbenchStore(
  initial: Partial<WorkbenchViewState> = {},
): WorkbenchStore {
  return createStore<WorkbenchViewState & WorkbenchViewActions>()((set) => ({
    ...INITIAL,
    ...initial,
    setTab: (tab) => set({ tab }),
    setItem: (item) => set({ item }),
    setRoot: (root) => set({ root }),
    setAdvanced: (advanced) => set({ advanced }),
  }));
}
