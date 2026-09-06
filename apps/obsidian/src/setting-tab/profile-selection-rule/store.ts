// One store per open rule editor: the draft, and the deps the editor reads
// while open. Every edit replaces the condition tree whole.
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { ProfileSelector } from "@/lib/profile-stamp";
import type { ProfileSelectionRule } from "@/services/profile-selection";

import { initialDraft } from "./draft";
import type { ConditionGroup, RuleDraft, RuleEditorDeps } from "./draft";

export interface RuleEditorState {
  draft: RuleDraft;
  deps: RuleEditorDeps;
  setProfile: (profile: ProfileSelector) => void;
  setRoot: (root: ConditionGroup) => void;
}

export type RuleEditorStore = ReturnType<typeof createRuleEditorStore>;

export function createRuleEditorStore(
  deps: RuleEditorDeps,
  rule?: ProfileSelectionRule,
) {
  return createStore<RuleEditorState>()((set, get) => ({
    draft: initialDraft(rule),
    deps,
    setProfile: (profile) => set({ draft: { ...get().draft, profile } }),
    setRoot: (root) => set({ draft: { ...get().draft, root } }),
  }));
}

const RuleEditorStoreContext = createContext<RuleEditorStore | null>(null);
export const RuleEditorStoreProvider = RuleEditorStoreContext.Provider;

export function useRuleEditorStore<T>(
  selector: (state: RuleEditorState) => T,
): T {
  const store = useContext(RuleEditorStoreContext);
  if (!store) {
    throw new Error(
      "useRuleEditorStore must be used within RuleEditorStoreProvider",
    );
  }
  return useStore(store, selector);
}
