import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

import {
  type AnnotViewAttachment,
  type AnnotViewItem,
  type ItemRef,
} from "@zotlit/db";

import { type ReaderTarget } from "@/services/server/service";

/**
 * What the view tracks: the active literature note (default), the active Zotero
 * reader (push-driven, server-gated), or a manually pinned item.
 */
export type FollowMode = "note" | "reader" | "linked";

export interface AnnotState {
  attachments: AnnotViewAttachment[] | null;
  selectedAttachmentID: number | null;
  annotations: AnnotViewItem[] | null;
  /** Synced mirror of {@link ServerService.readerTarget} for reactive rendering. */
  readerTarget: ReaderTarget | null;
  /** Indexed key of the item currently displayed; `null` when none resolves. */
  itemKey: string | null;
  /** Pre-formatted identity label for reader/linked modes (e.g. "Title — Author (2024)"). */
  itemDisplayLabel: string | null;
  /** Group library ID for the current item; `null` for user library. */
  groupID: number | null;
  followMode: FollowMode;
  /** Item pinned via manual-link mode; persists across mode switches. */
  linked: { target: ItemRef; displayLabel: string } | null;
  /** Whether the Zotero reader can be followed (server enabled and listening). */
  serverAvailable: boolean;
}

export type AnnotStore = ReturnType<typeof createAnnotStore>;

export function createAnnotStore() {
  return createStore<AnnotState>()(
    subscribeWithSelector(
      (): AnnotState => ({
        attachments: null,
        selectedAttachmentID: null,
        annotations: null,
        readerTarget: null,
        itemKey: null,
        itemDisplayLabel: null,
        groupID: null,
        followMode: "note",
        linked: null,
        serverAvailable: false,
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
    s.attachments.find((a) => a.itemID === s.selectedAttachmentID) ??
    s.attachments[0]!
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

export function useSetSelectedAttachmentID(): (id: number) => void {
  const store = useAnnotStoreApi();
  return (id) => store.setState({ selectedAttachmentID: id });
}
