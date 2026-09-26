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
  EditingCapability,
  MutationState,
  TagDraft,
  TextFieldDraft,
} from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";

import { NO_SELECTION } from "./card-selection";
import type { CardSelection } from "./card-selection";
import { filterAnnotations } from "./filter";
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

/** A field of an Annotation that a card edits in place. */
export type EditingField = "comment" | "tags" | "text";

/** A field a card edits in the field editor: the comment or the Quoted Text. */
export type TextEditingField = Exclude<EditingField, "tags">;

/** Every {@link TextEditingField}. */
export const TEXT_EDITING_FIELDS: readonly TextEditingField[] = [
  "text",
  "comment",
];

/** One map of shared drafts per text field, each by Indexed Key. */
export type FieldDrafts = Readonly<
  Record<TextEditingField, ReadonlyMap<string, TextFieldDraft>>
>;

const NO_FIELD_DRAFTS: FieldDrafts = { comment: new Map(), text: new Map() };

/**
 * The Annotation View's one editing target: an Annotation and the field its
 * card has open in an editor.
 */
export interface EditingTarget {
  annotationKey: string;
  field: EditingField;
}

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
  /** Shared comment and Quoted Text drafts currently observed by this view. */
  fieldDrafts: FieldDrafts;
  /** Shared tag drafts currently observed by this view. */
  tagDrafts: ReadonlyMap<string, TagDraft>;
  /**
   * The one field editor open in the view; `null` while none is. One at a
   * time: the editor takes the caret, and opening another saves and closes
   * it. A tag draft still saving outlives its editor.
   */
  editing: EditingTarget | null;
  /**
   * The cards this view holds selected, in every Follow Mode. The bound reader
   * is kept in step with it; nothing persists it.
   */
  cardSelection: CardSelection;
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
        fieldDrafts: NO_FIELD_DRAFTS,
        tagDrafts: new Map(),
        editing: null,
        cardSelection: NO_SELECTION,
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

/**
 * Whether a card's field editor is open. A tag draft still saving after its
 * editor closed does not count: the editing target is already clear.
 */
export function editorOpen(state: Pick<AnnotState, "editing">): boolean {
  return state.editing !== null;
}

/** One text field's shared draft of one Annotation, while this view observes one. */
export function fieldDraft(
  state: Pick<AnnotState, "fieldDrafts">,
  field: TextEditingField,
  annotationKey: string,
): TextFieldDraft | null {
  return state.fieldDrafts[field].get(annotationKey) ?? null;
}

/**
 * Whether a card is selected alone: the one card that opens its full text and
 * offers its edit controls.
 */
export function selectedAlone(
  state: Pick<AnnotState, "cardSelection">,
  annotationKey: string,
): boolean {
  const { selected } = state.cardSelection;
  return selected.length === 1 && selected[0] === annotationKey;
}

/** Whether one Annotation's field is the editing target. */
export function isEditing(
  state: Pick<AnnotState, "editing">,
  annotationKey: string,
  field: EditingField,
): boolean {
  return (
    state.editing?.annotationKey === annotationKey &&
    state.editing.field === field
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

/**
 * One Annotation field's editor: `open` makes it the editing target, in place
 * of any other, and `close` clears the target while it is still this one, so
 * an editor that unmounts after another opened leaves that one open.
 */
export function useEditingTarget(
  annotationKey: string,
  field: EditingField,
): { open: () => void; close: () => void } {
  const store = useAnnotStoreApi();
  return {
    open: () => store.setState({ editing: { annotationKey, field } }),
    close: () => {
      if (isEditing(store.getState(), annotationKey, field))
        store.setState({ editing: null });
    },
  };
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

type FilterSlices = Pick<
  AnnotState,
  "filterQuery" | "selectedColors" | "selectedTags"
>;

/** The one place the store's search and filter slices become an {@link AnnotFilter}. */
function filterOf(s: FilterSlices): AnnotFilter {
  return {
    query: s.filterQuery,
    colors: s.selectedColors,
    tags: s.selectedTags,
  };
}

/**
 * The last order worked out over each list, and the filter slices it was
 * worked out under. Keyed on the list itself, so each view keeps its own.
 */
const orders = new WeakMap<
  readonly AnnotationRecord[],
  { slices: FilterSlices; order: readonly string[] }
>();

/**
 * The Indexed Keys the list shows, in the order it shows them — the list the
 * Card Selection's transitions read, filtered as {@link useAnnotFilter}
 * filters the cards on screen. The view's subscription reads it on every
 * store update, so it filters again only when the list or a filter slice
 * changes.
 */
export function visibleOrder(
  s: FilterSlices & Pick<AnnotState, "annotations">,
): readonly string[] {
  if (s.annotations === null) return [];
  const held = orders.get(s.annotations);
  if (
    held?.slices.filterQuery === s.filterQuery &&
    held.slices.selectedColors === s.selectedColors &&
    held.slices.selectedTags === s.selectedTags
  )
    return held.order;
  const { filterQuery, selectedColors, selectedTags } = s;
  const order = filterAnnotations(s.annotations, filterOf(s)).map(
    ({ key }) => key,
  );
  orders.set(s.annotations, {
    slices: { filterQuery, selectedColors, selectedTags },
    order,
  });
  return order;
}

/** The {@link AnnotFilter} on screen, held while its slices are unchanged. */
export function useAnnotFilter(): AnnotFilter {
  const filterQuery = useAnnotStore((s) => s.filterQuery);
  const selectedColors = useAnnotStore((s) => s.selectedColors);
  const selectedTags = useAnnotStore((s) => s.selectedTags);
  return useMemo(
    () => filterOf({ filterQuery, selectedColors, selectedTags }),
    [filterQuery, selectedColors, selectedTags],
  );
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
