import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

import { type AnnotViewAttachment, type AnnotViewItem } from "@zotlit/db";

export interface AnnotState {
  attachments: AnnotViewAttachment[] | null;
  attachmentID: number | null;
  annotations: AnnotViewItem[] | null;
  /** Item key extracted from the active literature note's frontmatter. */
  itemKey: string | null;
  /** Group library ID for the current item; `null` for user library. */
  groupID: number | null;
}

export type AnnotStore = ReturnType<typeof createAnnotStore>;

export function createAnnotStore() {
  return createStore<AnnotState>()(
    subscribeWithSelector(
      (): AnnotState => ({
        attachments: null,
        attachmentID: null,
        annotations: null,
        itemKey: null,
        groupID: null,
      }),
    ),
  );
}

/** Selected attachment, falling back to the first when none is chosen. */
export function selectActiveAttachment(
  s: AnnotState,
): AnnotViewAttachment | null {
  if (!s.attachments || s.attachments.length === 0) return null;
  return (
    s.attachments.find((a) => a.itemID === s.attachmentID) ?? s.attachments[0]!
  );
}

const AnnotStoreContext = createContext<AnnotStore | null>(null);
export const AnnotStoreProvider = AnnotStoreContext.Provider;

function useAnnotStoreApi(): AnnotStore {
  const store = useContext(AnnotStoreContext);
  if (!store) {
    throw new Error("useAnnotStore must be used within AnnotStoreProvider");
  }
  return store;
}

export function useAnnotStore<T>(selector: (s: AnnotState) => T): T {
  return useStore(useAnnotStoreApi(), selector);
}

export function useSetAttachmentID(): (id: number) => void {
  const store = useAnnotStoreApi();
  return (attachmentID) => store.setState({ attachmentID });
}
