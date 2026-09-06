// One store per open rule editor: the draft, and the deps the editor reads
// while open. The visual surface writes the canonical expression on every
// tree change; the expression surface writes the text as typed.
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { ProfileSelector } from "@/lib/profile-stamp";
import type { LibraryScope } from "@/services/library-scope/scope";
import {
  compileCondition,
  formatCondition,
} from "@/services/profile-selection";
import type { ProfileSelectionRule } from "@/services/profile-selection";

import { asGroup, expressionIssue, initialDraft } from "./draft";
import type { ConditionGroup, RuleDraft, RuleEditorDeps } from "./draft";

export interface RuleEditorState {
  draft: RuleDraft;
  deps: RuleEditorDeps;
  setProfile: (profile: ProfileSelector) => void;
  setScope: (scope: LibraryScope) => void;
  /** Replace the condition tree and write its canonical expression. */
  setRoot: (root: ConditionGroup) => void;
  setExpression: (expression: string) => void;
  /** The expression is already current: every visual edit wrote it. */
  editAsExpression: () => void;
  /** Refused while the expression is outside the contract. */
  editVisually: () => void;
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
    setScope: (scope) => set({ draft: { ...get().draft, scope } }),
    setRoot: (root) =>
      set({
        draft: { ...get().draft, root, expression: formatCondition(root) },
      }),
    setExpression: (expression) =>
      set({ draft: { ...get().draft, expression } }),
    editAsExpression: () => set({ draft: { ...get().draft, root: null } }),
    editVisually: () => {
      const { draft, deps } = get();
      if (expressionIssue(draft, deps) !== null) return;
      const { condition } = compileCondition(draft.expression);
      set({ draft: { ...draft, root: asGroup(condition!) } });
    },
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
