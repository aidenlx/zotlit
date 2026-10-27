// The card state, defaults and pure selectors shared by annotation layouts.
import type { AnnotViewAttachment } from "@zotlit/db";

import { toggledValues } from "@/components/chooser-logic";
import type { ItemSummary } from "@/lib/item-summary";
import type {
  AnnotationRecord,
  AnnotationSource,
  EditingCapability,
  MutationState,
  TagDraft,
  TextField,
  TextFieldDraft,
} from "@/services/annotation-repository/service";
import { byTextField } from "@/services/annotation-repository/write";

import { cardPlace, NO_SELECTION } from "./card-selection";
import type { CardPlace } from "./card-selection";
import type { CardSelection } from "./card-selection";
import type { CaretPoint } from "./editor-sheet";
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

/**
 * A field of an Annotation that a card edits in place: a text field in the
 * field editor, or the tags in the tag editor.
 */
export type EditingField = TextField | "tags";

/** One map of shared drafts per text field, each by Indexed Key. */
export type FieldDrafts = Readonly<
  Record<TextField, ReadonlyMap<string, TextFieldDraft>>
>;

/** A {@link FieldDrafts} that holds no draft. */
export function noFieldDrafts(): FieldDrafts {
  return byTextField(() => new Map());
}

/**
 * The Annotation View's one editing target: an Annotation and the field its
 * card has open in an editor.
 */
export interface EditingTarget {
  annotationKey: string;
  field: EditingField;
  /** Where the click that opened a text field's editor landed, for its caret. */
  caretAt?: CaretPoint;
}

/** One Attachment's Annotation Source, and the data directory it was read under. */
export interface HeldSource {
  source: AnnotationSource;
  scope: string | null;
}

export interface AnnotState {
  attachments: AnnotViewAttachment[] | null;
  /** Indexed Key of the Attachment on screen. */
  selectedAttachmentKey: string | null;
  /** Why the Attachment cannot be chosen here; `null` while the picker is live. */
  attachmentLock: AttachmentLock;
  /**
   * The Annotations the cards show: the list of each Attachment the
   * Annotations Layout shows, one after another in the order its host gave.
   */
  annotations: readonly AnnotationRecord[] | null;
  /**
   * Which Annotation Source answered for each Attachment the cards show, by
   * the Attachment's Indexed Key. The source is atomic per Attachment, so a
   * card reads the one of its own Attachment.
   *
   * @see apps/obsidian/docs/adr/0034-the-annotation-source-is-atomic-per-attachment.md
   */
  sources: ReadonlyMap<string, HeldSource>;
  /**
   * What the cards may do to each Attachment they show, by the Attachment's
   * Indexed Key.
   */
  capabilities: ReadonlyMap<string, EditingCapability>;
  /**
   * The Editing Capability the host reports in its own chrome — the sidebar
   * reports the one of the Attachment on screen — and the one a card answers
   * to while {@link capabilities} holds none for its Attachment.
   */
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
  /**
   * Where each card stands, in order, while a Query View shows the rows of a
   * grouped query: one entry for each group a card stands in, so a card with
   * two tags stands under both. `null` while the cards stand in one list.
   */
  groups: readonly CardPlacement[] | null;
  /** The groups whose headings are collapsed, by group key. */
  collapsedGroups: ReadonlySet<string>;
  /**
   * The rows a Query View gave that no Attachment's list holds, by Indexed
   * Key, in the query's order.
   */
  unresolved: readonly string[];
  /**
   * Why the sidebar's query shows no cards: the query failed, or Zotero's
   * data cannot be read. `null` while nothing stands in the way.
   */
  queryProblem: { message: string; detail: string } | null;
  /** Whether a filter condition has an error while the last cards stay. */
  filterError: boolean;
}

/** The group a card stands in, and the heading that names it. */
export interface CardGroup {
  key: string;
  label: string;
}

/** One card under one group heading. */
export interface CardPlacement {
  annotationKey: string;
  group: CardGroup;
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

export function initialAnnotState(): AnnotState {
  return {
    attachments: null,
    selectedAttachmentKey: null,
    attachmentLock: null,
    annotations: null,
    sources: new Map(),
    capabilities: new Map(),
    // Nothing has probed Zotero yet, which is exactly what "probing" says.
    capability: { kind: "read-only", reason: "probing" },
    mutations: new Map(),
    fieldDrafts: noFieldDrafts(),
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
    groups: null,
    collapsedGroups: new Set(),
    unresolved: [],
    queryProblem: null,
    filterError: false,
  };
}

/** The Editing Capability one card answers to: the one of its own Attachment. */
export function capabilityOf(
  state: Pick<AnnotState, "capabilities" | "capability">,
  attachmentKey: string,
): EditingCapability {
  return state.capabilities.get(attachmentKey) ?? state.capability;
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
  field: TextField,
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

type FilterSlices = Pick<
  AnnotState,
  "filterQuery" | "selectedColors" | "selectedTags"
>;

/** The one place the store's search and filter slices become an {@link AnnotFilter}. */
export function filterOf(s: FilterSlices): AnnotFilter {
  return {
    query: s.filterQuery,
    colors: s.selectedColors,
    tags: s.selectedTags,
  };
}

/** One card under one group heading, as the grid draws it. */
export interface GroupedCard {
  annot: AnnotationRecord;
  group: CardGroup;
  /** Whether a heading opens the group before this card. */
  opens: boolean;
}

/** The shown cards under their groups, in the order of the placements. */
export function groupedCards(
  groups: readonly CardPlacement[],
  shown: readonly AnnotationRecord[],
): GroupedCard[] {
  const byKey = new Map(shown.map((annot) => [annot.key, annot]));
  const cards: GroupedCard[] = [];
  for (const { annotationKey, group } of groups) {
    const annot = byKey.get(annotationKey);
    if (!annot) continue;
    cards.push({ annot, group, opens: cards.at(-1)?.group.key !== group.key });
  }
  return cards;
}

type OrderSlices = FilterSlices &
  Pick<AnnotState, "groups" | "collapsedGroups">;

/**
 * The last order worked out over each list, and the slices it was worked out
 * under. Keyed on the list itself, so each view keeps its own.
 */
const orders = new WeakMap<
  readonly AnnotationRecord[],
  { slices: OrderSlices; order: readonly CardPlace[] }
>();

/**
 * The places of the cards the list shows, in the order it shows them — the
 * list the Card Selection's transitions read. It is filtered as
 * {@link useAnnotFilter} filters the cards on screen, and grouped as the grid
 * draws them: a card stands at each group it shows under, and a collapsed
 * group shows none. The view's subscription reads it on every store update,
 * so it works the order out again only when the list, a filter slice or the
 * groups change.
 */
export function visibleOrder(
  s: OrderSlices & Pick<AnnotState, "annotations">,
): readonly CardPlace[] {
  if (s.annotations === null) return [];
  const held = orders.get(s.annotations);
  if (
    held?.slices.filterQuery === s.filterQuery &&
    held.slices.selectedColors === s.selectedColors &&
    held.slices.selectedTags === s.selectedTags &&
    held.slices.groups === s.groups &&
    held.slices.collapsedGroups === s.collapsedGroups
  )
    return held.order;
  const { filterQuery, selectedColors, selectedTags, groups, collapsedGroups } =
    s;
  const shown = filterAnnotations(s.annotations, filterOf(s));
  const order =
    groups === null
      ? shown.map(({ key }) => cardPlace(key, null))
      : groupedCards(groups, shown).flatMap(({ annot, group }) =>
          collapsedGroups.has(group.key)
            ? []
            : [cardPlace(annot.key, group.key)],
        );
  orders.set(s.annotations, {
    slices: {
      filterQuery,
      selectedColors,
      selectedTags,
      groups,
      collapsedGroups,
    },
    order,
  });
  return order;
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
