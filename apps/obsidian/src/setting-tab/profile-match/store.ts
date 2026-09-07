// One store per open match editor: the draft, and the deps the editor reads
// while open. Every edit replaces the condition tree whole.
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { MatchTree } from "@zotlit/templates/facade";

import { initialDraft } from "./draft";
import type { ConditionGroup, MatchDraft, MatchEditorDeps } from "./draft";

export interface MatchEditorState {
  draft: MatchDraft;
  deps: MatchEditorDeps;
  setRoot: (root: ConditionGroup) => void;
}

export type MatchEditorStore = ReturnType<typeof createMatchEditorStore>;

export function createMatchEditorStore(
  deps: MatchEditorDeps,
  match?: MatchTree,
) {
  return createStore<MatchEditorState>()((set, get) => ({
    draft: initialDraft(match),
    deps,
    setRoot: (root) => set({ draft: { ...get().draft, root } }),
  }));
}

const MatchEditorStoreContext = createContext<MatchEditorStore | null>(null);
export const MatchEditorStoreProvider = MatchEditorStoreContext.Provider;

export function useMatchEditorStore<T>(
  selector: (state: MatchEditorState) => T,
): T {
  const store = useContext(MatchEditorStoreContext);
  if (!store) {
    throw new Error(
      "useMatchEditorStore must be used within MatchEditorStoreProvider",
    );
  }
  return useStore(store, selector);
}
