// The Reader Surface State: what the surfaces of one bound PDF view draw from,
// held in one vanilla store per view.
//
// The binding turns external signals into state through the reducers here, and
// each renderer subscribes to its own selector with an equality, so a signal
// that changes nothing on screen draws nothing.
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

import type { SelectedText } from "@zotlit/pdf-structure";

import { capabilityReason } from "@/services/annotation-repository/capability";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityAffordance } from "@/services/annotation-repository/capability-copy";
import type { CapabilityAffordance } from "@/services/annotation-repository/capability-copy";
import type {
  AnnotationRecord,
  AnnotationRepository,
  CommentDraft,
} from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";
import type { MutationState } from "@/services/annotation-repository/write";

import { createPopupRow } from "./create-popup";
import type { CreatePopupControl, CreatePopupRowInput } from "./create-popup";
import { creationToolbar } from "./creation-toolbar";
import type { CreationToolbarControl } from "./creation-toolbar";
import { markPopupRow } from "./mark-popup";
import type { MarkPopupRowInput, MarkPopupVerb } from "./mark-popup";
import type { AnnotationTool, MarkTool, ToolColorStore } from "./tools";

/** Where the create popup hangs, as a fraction of its page box, so a zoom keeps it. */
export interface AnchorAt {
  pageIndex: number;
  fx: number;
  fy: number;
}

/**
 * The one floating surface over the reader: nothing, the selected Annotation
 * Mark, or a fresh text selection about to become one. Being one union, the
 * two popups can never both stand.
 */
export type Floating =
  | { kind: "none" }
  | {
      kind: "selected";
      /** The selected Annotation, by Indexed Key. */
      key: string;
      /** The marks under the point that selected it, smallest first. */
      stack: readonly string[];
      /** Where {@link key} sits in {@link stack}. */
      index: number;
      /** Whether the selection declined its popup, as a Mark Landing's does. */
      quiet: boolean;
      /** Whether the popup holds the comment editor in place of its row. */
      commenting: boolean;
    }
  | {
      kind: "create";
      /** The settled selection, placed on the page's characters. */
      captured: SelectedText;
      anchorAt: AnchorAt;
      /** Whether the comment sheet stands open under the row. */
      commenting: boolean;
      /** Whether a create from this selection is waiting on Zotero. */
      inFlight: boolean;
    };

export interface ReaderSurfaceState {
  /** The tool a released selection commits with, or `null` while none is armed. */
  armed: MarkTool | null;
  /** Whether the Annotation Marks are drawn over the pages. */
  marksVisible: boolean;
  /** Every tool's colour, as the settings-backed tool colour store holds it. */
  colors: Readonly<Record<AnnotationTool, string>>;
  /** What this Attachment's Annotations may be edited to right now. */
  capability: EditingCapability;
  /**
   * The instant {@link ReaderSurfaceState.capability} was ingested at. The
   * Creation Toolbar's copy is read against it, so the countdown's tick moves
   * the affordance and leaves the toolbar still.
   */
  capabilityAt: Temporal.Instant;
  /** The instant a cooldown's remaining seconds are measured from. */
  now: Temporal.Instant;
  floating: Floating;
  /** Every Annotation of this Attachment, as the last read answered them. */
  records: readonly AnnotationRecord[];
  /**
   * What the last write left on each Annotation, by Indexed Key. A key with no
   * entry is idle.
   */
  mutations: ReadonlyMap<string, MutationState>;
  /** The shared comment drafts, by Indexed Key. */
  commentDrafts: ReadonlyMap<string, CommentDraft>;
}

export type ReaderSurfaceStore = ReturnType<typeof createReaderSurfaceState>;

export function createReaderSurfaceState({
  colors,
  capability,
  now,
}: Pick<ReaderSurfaceState, "colors" | "capability" | "now">) {
  return createStore<ReaderSurfaceState>()(
    subscribeWithSelector(
      (): ReaderSurfaceState => ({
        armed: null,
        marksVisible: true,
        colors,
        capability,
        capabilityAt: now,
        now,
        floating: NONE,
        records: [],
        mutations: new Map(),
        commentDrafts: new Map(),
      }),
    ),
  );
}

export function arm(store: ReaderSurfaceStore, tool: MarkTool | null): void {
  store.setState({ armed: tool });
}

/** Writes a tool's colour to the settings-backed store and to this view. */
export function setToolColor(
  store: ReaderSurfaceStore,
  toolColors: ToolColorStore,
  { tool, color }: { tool: AnnotationTool; color: string },
): void {
  toolColors.set(tool, color);
  store.setState({ colors: toolColors.current() });
}

export function toggleMarks(store: ReaderSurfaceStore): void {
  store.setState(({ marksVisible }) => ({ marksVisible: !marksVisible }));
}

/**
 * Takes the capability the repository now answers. One with the same meaning
 * as the held one keeps the held object and only moves the clock, so a
 * repeated announcement changes no subscriber's slice.
 */
export function ingestCapability(
  store: ReaderSurfaceStore,
  capability: EditingCapability,
  now: Temporal.Instant,
): void {
  if (sameCapability(store.getState().capability, capability)) {
    tick(store, now);
    return;
  }
  store.setState({ capability, capabilityAt: now, now });
}

export function tick(store: ReaderSurfaceStore, now: Temporal.Instant): void {
  store.setState({ now });
}

const NONE: Floating = { kind: "none" };

/**
 * Takes an Annotation as the selection, or clears it for `null`. A repeat
 * selection of the same mark keeps its comment editor open.
 *
 * @param options.stack the marks under the point that selected it, smallest
 *   first; the mark alone where no point did.
 * @param options.quiet whether the popup stays closed until the next selection.
 */
export function selectMark(
  store: ReaderSurfaceStore,
  key: string | null,
  { stack, quiet = false }: { stack?: readonly string[]; quiet?: boolean } = {},
): void {
  store.setState(({ floating }) => {
    if (key === null) return { floating: NONE };
    const held = stack?.includes(key) ? stack : [key];
    return {
      floating: {
        kind: "selected",
        key,
        stack: held,
        index: held.indexOf(key),
        quiet,
        commenting:
          floating.kind === "selected" &&
          floating.key === key &&
          floating.commenting,
      },
    };
  });
}

export function clearFloating(store: ReaderSurfaceStore): void {
  store.setState({ floating: NONE });
}

/** A settled selection takes the floating surface, whatever held it. */
export function captureSelection(
  store: ReaderSurfaceStore,
  { captured, anchorAt }: { captured: SelectedText; anchorAt: AnchorAt },
): void {
  store.setState({
    floating: {
      kind: "create",
      captured,
      anchorAt,
      commenting: false,
      inFlight: false,
    },
  });
}

/** Forward through the selected mark's stack, wrapping at its end. */
export function stepStack(store: ReaderSurfaceStore): void {
  const { floating } = store.getState();
  if (floating.kind !== "selected" || floating.stack.length < 2) return;
  const index = (floating.index + 1) % floating.stack.length;
  store.setState({
    floating: {
      ...floating,
      key: floating.stack[index]!,
      index,
      commenting: false,
    },
  });
}

/** Opens or closes the comment editor or sheet of whatever is floating. */
export function setCommenting(
  store: ReaderSurfaceStore,
  commenting: boolean,
): void {
  const { floating } = store.getState();
  if (floating.kind === "none" || floating.commenting === commenting) return;
  store.setState({ floating: { ...floating, commenting } });
}

export function setInFlight(
  store: ReaderSurfaceStore,
  inFlight: boolean,
): void {
  const { floating } = store.getState();
  if (floating.kind !== "create" || floating.inFlight === inFlight) return;
  store.setState({ floating: { ...floating, inFlight } });
}

/**
 * Takes the Attachment's Annotations as the last read answered them. A
 * selected Annotation the read no longer holds stands down in the same update.
 */
export function ingestRecords(
  store: ReaderSurfaceStore,
  records: readonly AnnotationRecord[],
): void {
  store.setState(({ floating }) => ({
    records,
    floating: heldBy(floating, records),
  }));
}

/** What floats, stood down if it is a selection the records no longer hold. */
function heldBy(
  floating: Floating,
  records: readonly AnnotationRecord[],
): Floating {
  return floating.kind === "selected" &&
    !records.some(({ key }) => key === floating.key)
    ? NONE
    : floating;
}

/**
 * An Annotation a complete read confirmed gone leaves at once, with what a
 * write and a draft held on it.
 */
export function dropRecord(store: ReaderSurfaceStore, key: string): void {
  store.setState(({ records, mutations, commentDrafts, floating }) => {
    const held = records.filter((record) => record.key !== key);
    const heldMutations = new Map(mutations);
    heldMutations.delete(key);
    return {
      records: held,
      floating: heldBy(floating, held),
      mutations: heldMutations,
      commentDrafts: withDraft(commentDrafts, key, null),
    };
  });
}

/** What the per-Annotation facts are read and announced through. */
export type AnnotationFacts = Pick<
  AnnotationRepository,
  "commentDraftFor" | "mutationFor" | "on"
>;

/**
 * Takes a read's records, with the write state and the draft each one already
 * holds: those stood before this view could hear them announced.
 */
export function ingestAnnotations(
  store: ReaderSurfaceStore,
  records: readonly AnnotationRecord[],
  annotations: Omit<AnnotationFacts, "on">,
): void {
  ingestRecords(store, records);
  for (const { key } of records) {
    ingestMutation(store, key, annotations.mutationFor(key));
    ingestCommentDraft(store, key, annotations.commentDraftFor(key));
  }
}

/**
 * Takes what the repository announces about one Annotation — what a write left
 * on it, its comment draft, and its deletion — into the state.
 *
 * @returns what stops the listening.
 */
export function listenAnnotationEvents(
  store: ReaderSurfaceStore,
  annotations: AnnotationFacts,
): DisposableStack {
  const listening = new DisposableStack();
  listening.defer(
    annotations.on("mutation-changed", (key) =>
      ingestMutation(store, key, annotations.mutationFor(key)),
    ),
  );
  listening.defer(
    annotations.on("comment-draft-changed", (key) =>
      ingestCommentDraft(store, key, annotations.commentDraftFor(key)),
    ),
  );
  listening.defer(
    annotations.on("comment-draft-hidden", (key) =>
      hideCommentDraft(store, key),
    ),
  );
  listening.defer(
    annotations.on("annotation-deleted", (key) => dropRecord(store, key)),
  );
  return listening;
}

/**
 * Takes what a write now leaves on one Annotation. One equal to the held state
 * changes nothing, so a repeated announcement fires no subscriber.
 */
export function ingestMutation(
  store: ReaderSurfaceStore,
  key: string,
  mutation: MutationState,
): void {
  const held = store.getState().mutations;
  if (sameFlat(held.get(key) ?? IDLE, mutation)) return;
  const mutations = new Map(held);
  if (mutation.kind === "idle") mutations.delete(key);
  else mutations.set(key, mutation);
  store.setState({ mutations });
}

/**
 * Takes one Annotation's comment draft, or its absence once a save settled it.
 * A draft that turns into a Write Conflict closes its editor in the same
 * update, so the row can offer the conflict's choices.
 */
export function ingestCommentDraft(
  store: ReaderSurfaceStore,
  key: string,
  draft: CommentDraft | null,
): void {
  const { commentDrafts, floating } = store.getState();
  if (sameFlat(commentDrafts.get(key) ?? null, draft)) return;
  store.setState({
    commentDrafts: withDraft(commentDrafts, key, draft),
    floating:
      draft?.state.kind === "conflict" ? closedEditor(floating, key) : floating,
  });
}

/** A database switch hid this draft; its editor closes in the same update. */
export function hideCommentDraft(store: ReaderSurfaceStore, key: string): void {
  const { commentDrafts, floating } = store.getState();
  store.setState({
    commentDrafts: withDraft(commentDrafts, key, null),
    floating: closedEditor(floating, key),
  });
}

function withDraft(
  drafts: ReadonlyMap<string, CommentDraft>,
  key: string,
  draft: CommentDraft | null,
): ReadonlyMap<string, CommentDraft> {
  const next = new Map(drafts);
  if (draft) next.set(key, draft);
  else next.delete(key);
  return next;
}

/** The floating surface with the selected mark's editor closed, if it is `key`'s. */
function closedEditor(floating: Floating, key: string): Floating {
  return floating.kind === "selected" &&
    floating.key === key &&
    floating.commenting
    ? { ...floating, commenting: false }
    : floating;
}

export function selectCreationToolbar({
  armed,
  colors,
  marksVisible,
  capability,
  capabilityAt,
}: ReaderSurfaceState): readonly CreationToolbarControl[] {
  return creationToolbar({
    armed,
    colors,
    marksVisible,
    capability,
    now: capabilityAt,
  });
}

/**
 * The affordance the reader's toolbar shows, or `null` while it shows none.
 * Authorization is offered in the Annotation View and settings, so only the
 * two states a reader waits out are shown here.
 */
export function selectCapabilityAffordance({
  capability,
  now,
}: ReaderSurfaceState): CapabilityAffordance | null {
  return capability.kind === "authorizing" || capability.kind === "cooldown"
    ? editingCapabilityAffordance(capability, now)
    : null;
}

/** What decides whether the popup's row is rebuilt rather than refreshed. */
export interface FloatingHead {
  kind: Floating["kind"];
  key: string | null;
  commenting: boolean;
}

export function selectFloatingHead({
  floating,
}: ReaderSurfaceState): FloatingHead {
  return {
    kind: floating.kind,
    key: floating.kind === "selected" ? floating.key : null,
    commenting: floating.kind !== "none" && floating.commenting,
  };
}

/** The selected Annotation's Indexed Key, or `null` while none is selected. */
export function selectSelectedKey({
  floating,
}: ReaderSurfaceState): string | null {
  return floating.kind === "selected" ? floating.key : null;
}

/** The selected Annotation's comment draft, or `null` while it has none. */
export function selectSelectedDraft({
  floating,
  commentDrafts,
}: ReaderSurfaceState): CommentDraft | null {
  return floating.kind === "selected"
    ? (commentDrafts.get(floating.key) ?? null)
    : null;
}

/**
 * What the selected-mode row is decided from, or `null` while no mark is
 * selected or its Annotation is not among the records. The copy is read
 * against the instant the capability was ingested, as the toolbar's is, so a
 * cooldown's tick leaves the row still.
 */
export function selectSelectedRowInput({
  floating,
  records,
  mutations,
  capability,
  capabilityAt,
}: ReaderSurfaceState): MarkPopupRowInput | null {
  if (floating.kind !== "selected") return null;
  const annotation = records.find(({ key }) => key === floating.key);
  if (!annotation) return null;
  return {
    annotation,
    capability,
    mutation: mutations.get(floating.key) ?? IDLE,
    stack: { index: floating.index, total: floating.stack.length },
    now: capabilityAt,
  };
}

/** The last record of the selected row: what the popup draws beyond its verbs. */
export interface SelectedRowHead {
  key: string;
  color: string | null;
  stackIndex: number;
  stackTotal: number;
  /** Held by identity: the store keeps the object while it means the same. */
  mutation: MutationState;
  draft: CommentDraft | null;
}

/**
 * The selected-mode row as flat records, for {@link sameFlatList}: the verbs as
 * {@link markPopupRow} decides them, then one record for the rest. Empty while
 * no row stands.
 */
export function selectSelectedRow(
  state: ReaderSurfaceState,
): readonly (MarkPopupVerb | SelectedRowHead)[] {
  const input = selectSelectedRowInput(state);
  if (!input) return [];
  const { verbs, color } = markPopupRow(input);
  return [
    ...verbs,
    {
      key: input.annotation.key,
      color,
      stackIndex: input.stack.index,
      stackTotal: input.stack.total,
      mutation: input.mutation,
      draft: selectSelectedDraft(state),
    },
  ];
}

/**
 * What the create-mode row is decided from, or `null` while no selection
 * waits. Read against the instant the capability was ingested, as above.
 */
export function selectCreateRowInput({
  floating,
  armed,
  colors,
  capability,
  capabilityAt,
}: ReaderSurfaceState): CreatePopupRowInput | null {
  if (floating.kind !== "create") return null;
  return {
    armed,
    colors,
    capability,
    mutation: floating.inFlight ? { kind: "pending" } : IDLE,
    commenting: floating.commenting,
    now: capabilityAt,
  };
}

/**
 * The create-mode row as flat records, for {@link sameFlatList}: each control
 * without the action it runs, which its id already names. Empty while no
 * selection waits.
 */
export function selectCreateRow(
  state: ReaderSurfaceState,
): readonly Omit<CreatePopupControl, "action">[] {
  const input = selectCreateRowInput(state);
  return input
    ? createPopupRow(input).map(({ action: _action, ...control }) => control)
    : [];
}

/** Whether two capabilities mean the same: one reason, and one deadline. */
export function sameCapability(
  a: EditingCapability,
  b: EditingCapability,
): boolean {
  if (capabilityReason(a) !== capabilityReason(b)) return false;
  return a.kind === "cooldown" && b.kind === "cooldown"
    ? a.retryAfter.equals(b.retryAfter)
    : true;
}

/** Whether two flat records, or two `null`s, hold equal primitive fields. */
export function sameFlat<T extends object>(a: T | null, b: T | null): boolean {
  if (a === null || b === null) return a === b;
  const keys = Object.keys(a) as (keyof T)[];
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.is(a[key], b[key]))
  );
}

/** Whether two lists of flat records hold equal records in the same order. */
export function sameFlatList<T extends object>(
  a: readonly T[],
  b: readonly T[],
): boolean {
  return (
    a.length === b.length &&
    a.every((record, index) => sameFlat(record, b[index]!))
  );
}
