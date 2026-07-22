import { createContext, useContext, useMemo } from "react";
import { useStore } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

import {
  type AnnotViewAttachment,
  type AnnotViewItem,
  type ItemRef,
} from "@zotlit/db";

import { type ReaderTarget } from "@/services/live-update/service";

import { type AnnotFilter } from "./filter";

/**
 * What the view tracks: the active literature note (default), the active Zotero
 * reader (push-driven, server-gated), or a manually pinned item.
 */
export type FollowMode = "note" | "reader" | "linked";

export interface AnnotState {
  attachments: AnnotViewAttachment[] | null;
  selectedAttachmentID: number | null;
  annotations: AnnotViewItem[] | null;
  /** Synced mirror of {@link LiveUpdateService.readerTarget} for reactive rendering. */
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
  /** Search row visible. */
  searchOpen: boolean;
  /** Case-insensitive substring query typed into the search row. */
  filterQuery: string;
  /** Selected swatch colors, canonical uppercase "#RRGGBB". */
  selectedColors: string[];
  /** Selected tag IDs. */
  selectedTagIDs: number[];
  /** Inline tag panel (below the filter bar) open. */
  panelOpen: boolean;
}

/** Search & filter defaults, not persisted; reset whenever the displayed item changes. */
export const INITIAL_FILTER_STATE: Pick<
  AnnotState,
  | "searchOpen"
  | "filterQuery"
  | "selectedColors"
  | "selectedTagIDs"
  | "panelOpen"
> = {
  searchOpen: false,
  filterQuery: "",
  selectedColors: [],
  selectedTagIDs: [],
  panelOpen: false,
};

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
        ...INITIAL_FILTER_STATE,
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

/**
 * Toggle the search row. Closing must also clear the query so a hidden row
 * never keeps filtering the list.
 */
export function useToggleSearchOpen(): () => void {
  const store = useAnnotStoreApi();
  return () => {
    const { searchOpen } = store.getState();
    store.setState(
      searchOpen
        ? { searchOpen: false, filterQuery: "" }
        : { searchOpen: true },
    );
  };
}

export function useSetFilterQuery(): (query: string) => void {
  const store = useAnnotStoreApi();
  return (query) => store.setState({ filterQuery: query });
}

/** Clears filterQuery/selectedColors/selectedTagIDs; leaves searchOpen/panelOpen untouched. */
export function useClearFilters(): () => void {
  const store = useAnnotStoreApi();
  return () =>
    store.setState({ filterQuery: "", selectedColors: [], selectedTagIDs: [] });
}

export function useTogglePanel(): () => void {
  const store = useAnnotStoreApi();
  return () => {
    const { panelOpen } = store.getState();
    store.setState({ panelOpen: !panelOpen });
  };
}

export function useToggleSelectedColor(): (color: string) => void {
  const store = useAnnotStoreApi();
  return (color) => {
    const { selectedColors } = store.getState();
    store.setState({
      selectedColors: selectedColors.includes(color)
        ? selectedColors.filter((c) => c !== color)
        : [...selectedColors, color],
    });
  };
}

/** Assembles the {@link AnnotFilter} from the store's query/colors/tagIDs slices. */
export function useAnnotFilter(): AnnotFilter {
  const query = useAnnotStore((s) => s.filterQuery);
  const colors = useAnnotStore((s) => s.selectedColors);
  const tagIDs = useAnnotStore((s) => s.selectedTagIDs);
  return useMemo(() => ({ query, colors, tagIDs }), [query, colors, tagIDs]);
}

export function useToggleSelectedTagID(): (tagID: number) => void {
  const store = useAnnotStoreApi();
  return (tagID) => {
    const { selectedTagIDs } = store.getState();
    store.setState({
      selectedTagIDs: selectedTagIDs.includes(tagID)
        ? selectedTagIDs.filter((id) => id !== tagID)
        : [...selectedTagIDs, tagID],
    });
  };
}
