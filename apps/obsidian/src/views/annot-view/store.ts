import { createContext, useCallback, useContext, useMemo } from "react";
import { useStore } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

import type { AnnotViewAttachment } from "@zotlit/db";

import { toggledValues } from "@/components/chooser-logic";
import type { ItemSummary } from "@/lib/item-summary";
import type {
  AnnotationRecord,
  AnnotationSource,
  CommentDraft,
  EditingCapability,
  MutationState,
} from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";

import type { AnnotFilter } from "./filter";

/**
 * What one Annotation View instance follows: the active tab (default), the
 * Zotero Reader, or an Item the user pinned. It changes on a user gesture
 * alone — never because a source stopped answering.
 *
 * @see apps/obsidian/docs/adr/0041-the-annotation-view-changes-its-follow-mode-only-on-a-user-gesture.md
 */
export type FollowMode = "active-tab" | "zotero-reader" | "pinned";

/**
 * Why the view cannot change the Attachment on screen: an Obsidian PDF view or
 * the Zotero Reader chose it, and the picker stands down while it does.
 */
export type AttachmentLock = "obsidian-pdf" | "zotero-reader" | null;

export interface AnnotState {
  attachments: AnnotViewAttachment[] | null;
  /** Indexed Key of the Attachment on screen. */
  selectedAttachmentKey: string | null;
  /** Why the Attachment cannot be chosen here; `null` while the picker is live. */
  attachmentLock: AttachmentLock;
  annotations: readonly AnnotationRecord[] | null;
  /** Which Annotation Source answered for {@link annotations}. */
  annotationSource: AnnotationSource | null;
  annotationSourceScope: string | null;
  /** What the cards may do to the Attachment on screen. */
  capability: EditingCapability;
  /**
   * What the last write left on each Annotation, by Indexed Key. A key with no
   * entry is idle, so the map holds only the few this session has edited.
   */
  mutations: ReadonlyMap<string, MutationState>;
  /** Shared comment drafts currently observed by this view. */
  commentDrafts: ReadonlyMap<string, CommentDraft>;
  /**
   * The Annotation whose comment is open in its card's editor; `null` while
   * none is. One at a time: the editor takes the caret.
   */
  editingCommentKey: string | null;
  /** Indexed Keys of the Annotations selected in the reader the view follows. */
  selectedAnnotationKeys: readonly string[];
  /**
   * Indexed Key of the Item on screen; `null` for a standalone Attachment and
   * while nothing resolves. An Attachment can stand without one.
   */
  itemKey: string | null;
  /**
   * The Item on screen as the header names it: its own title, the creators and
   * year the byline carries, and the one line built from both. `null` while
   * nothing resolves.
   */
  itemDisplay: ItemSummary | null;
  /** Group library ID for the current item; `null` for user library. */
  groupID: number | null;
  followMode: FollowMode;
  /** The mode a pin interrupted; Unpin returns the view here. */
  previousMode: FollowMode;
  /** Indexed Key of the pinned Item; `null` when nothing is pinned. */
  pinnedItemKey: string | null;
  /**
   * The Item a pin would take, and why it cannot: a standalone Attachment has
   * no Item to pin, and an unresolved leaf names none.
   */
  pinnable: string | null;
  /** Whether Live updates is on and the listener answers. */
  liveUpdatesOn: boolean;
  /** Whether the Zotero Reader closed, its last Attachment still on screen. */
  zoteroReaderClosed: boolean;
  /** Search row visible. */
  searchOpen: boolean;
  /** Case-insensitive substring query typed into the search row. */
  filterQuery: string;
  /** Selected swatch colors, canonical uppercase "#RRGGBB". */
  selectedColors: string[];
  /** Selected tags, by name. */
  selectedTags: string[];
}

/**
 * Search and filter defaults, not persisted; reset whenever the displayed item
 * changes.
 */
export const INITIAL_FILTER_STATE: Pick<
  AnnotState,
  "searchOpen" | "filterQuery" | "selectedColors" | "selectedTags"
> = {
  searchOpen: false,
  filterQuery: "",
  selectedColors: [],
  selectedTags: [],
};

export type AnnotStore = ReturnType<typeof createAnnotStore>;

export function createAnnotStore() {
  return createStore<AnnotState>()(
    subscribeWithSelector(
      (): AnnotState => ({
        attachments: null,
        selectedAttachmentKey: null,
        attachmentLock: null,
        annotations: null,
        annotationSource: null,
        annotationSourceScope: null,
        // Nothing has probed Zotero yet, which is exactly what "probing" says.
        capability: { kind: "read-only", reason: "probing" },
        mutations: new Map(),
        commentDrafts: new Map(),
        editingCommentKey: null,
        selectedAnnotationKeys: [],
        itemKey: null,
        itemDisplay: null,
        groupID: null,
        followMode: "active-tab",
        previousMode: "active-tab",
        pinnedItemKey: null,
        pinnable: null,
        liveUpdatesOn: false,
        zoteroReaderClosed: false,
        ...INITIAL_FILTER_STATE,
      }),
    ),
  );
}

/** Selected attachment, falling back to the first when none is chosen. */
export function selectActiveAttachment(
  s: Pick<AnnotState, "attachments" | "selectedAttachmentKey">,
): AnnotViewAttachment | null {
  if (!s.attachments || s.attachments.length === 0) return null;
  return (
    s.attachments.find((a) => a.indexedKey === s.selectedAttachmentKey) ??
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

/**
 * What the last write left on one Annotation. The stored states are stable
 * objects and {@link IDLE} is a constant, so this selector never builds one —
 * a fresh object would never compare equal to the last snapshot.
 */
export function useMutation(annotationKey: string): MutationState {
  return useAnnotStore((s) => s.mutations.get(annotationKey) ?? IDLE);
}

/** Opens one card's comment editor, or closes the one that is open. */
export function useSetEditingComment(): (key: string | null) => void {
  const store = useAnnotStoreApi();
  return (key) => store.setState({ editingCommentKey: key });
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

/** Clears filterQuery/selectedColors/selectedTags; leaves searchOpen untouched. */
export function useClearFilters(): () => void {
  const store = useAnnotStoreApi();
  return () =>
    store.setState({ filterQuery: "", selectedColors: [], selectedTags: [] });
}

/**
 * The colour filter after one colour is toggled. Unchanged by the Chooser
 * migration: aidenlx/zotlit#1194 asks for this action to be reused as it
 * stands, so the filter bar names the one colour that moved rather than the
 * store taking a whole selection.
 */
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

/**
 * Takes a whole colour selection, for the Chooser's own action row: clearing
 * names no single colour, so {@link useToggleSelectedColor} has nothing to be
 * handed. Memoised on the store, as {@link useSetSelectedTags} is.
 */
export function useSetSelectedColors(): (colors: string[]) => void {
  const store = useAnnotStoreApi();
  return useCallback(
    (colors) => store.setState({ selectedColors: colors }),
    [store],
  );
}

/** Assembles the {@link AnnotFilter} from the store's query/colors/tags slices. */
export function useAnnotFilter(): AnnotFilter {
  const query = useAnnotStore((s) => s.filterQuery);
  const colors = useAnnotStore((s) => s.selectedColors);
  const tags = useAnnotStore((s) => s.selectedTags);
  return useMemo(() => ({ query, colors, tags }), [query, colors, tags]);
}

/**
 * The tag filter after one tag is toggled. Named apart from the hook because
 * the card's tag menu is built outside React, from the view's own store handle.
 *
 * The rule itself is {@link toggledValues}, which the Chooser's rows tick
 * through as well, so the two paths into the tag filter cannot drift.
 */
export function toggledTags(selectedTags: string[], tag: string): string[] {
  return toggledValues(selectedTags, tag);
}

/** Memoised on the store, as {@link useSetSelectedTags} is. */
export function useToggleSelectedTag(): (tag: string) => void {
  const store = useAnnotStoreApi();
  return useCallback(
    (tag) =>
      store.setState({
        selectedTags: toggledTags(store.getState().selectedTags, tag),
      }),
    [store],
  );
}

/**
 * Takes a whole tag selection, for a surface that decides the next one itself
 * — the Chooser reports what a tick leaves behind rather than which tag moved.
 *
 * Memoised on the store: the Chooser's row groups are built in a memo over it,
 * and a fresh closure per render would rebuild them on every render of the
 * filter bar.
 */
export function useSetSelectedTags(): (tags: string[]) => void {
  const store = useAnnotStoreApi();
  return useCallback((tags) => store.setState({ selectedTags: tags }), [store]);
}
