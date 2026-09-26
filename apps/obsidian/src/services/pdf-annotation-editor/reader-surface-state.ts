// The Reader Surface State: what the surfaces of one bound PDF view draw from,
// held in one vanilla store per view.
//
// The binding turns external signals into state through the reducers here, and
// each renderer subscribes to its own selector with an equality, so a signal
// that changes nothing on screen draws nothing.
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

import type { SelectedText } from "@zotlit/pdf-structure";

import { offeredSwatches } from "@/lib/annotation-colors";
import { capabilityReason } from "@/services/annotation-repository/capability";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import { editingCapabilityAffordance } from "@/services/annotation-repository/capability-copy";
import type { CapabilityAffordance } from "@/services/annotation-repository/capability-copy";
import { lockBlock } from "@/services/annotation-repository/lock";
import type {
  AnnotationRecord,
  AnnotationRepository,
  TextFieldDraft,
  AnnotationState,
  TagDraft,
} from "@/services/annotation-repository/service";
import {
  IDLE,
  textIdentity,
  writePosition,
} from "@/services/annotation-repository/write";
import type {
  AnnotationTag,
  InkPosition,
  MutationState,
  TextPosition,
} from "@/services/annotation-repository/write";
import {
  annotationBlocks,
  editingLive,
} from "@/views/annot-view/card-controls";

import { createPopupRow } from "./create-popup";
import type { CreatePopupControl, CreatePopupRowInput } from "./create-popup";
import { creationToolbar } from "./creation-toolbar";
import type { CreationToolbarControl } from "./creation-toolbar";
import { fitStoredTextBox } from "./free-text-layout";
import type { TextMeasure } from "./free-text-layout";
import {
  capturesImage,
  isEditablePosition,
  sameGeometry,
} from "./geometry-edit";
import type {
  EditablePosition,
  Grip,
  PdfPoint,
  PdfRect,
} from "./geometry-edit";
import { markPopupRow } from "./mark-popup";
import type { MarkPopupRowInput, MarkPopupVerb } from "./mark-popup";
import { gestureOf } from "./tools";
import type { AnnotationTool, MarkTool, ToolColorStore } from "./tools";

/** Where the create popup hangs, as a fraction of its page box, so a zoom keeps it. */
export interface AnchorAt {
  pageIndex: number;
  fx: number;
  fy: number;
}

/**
 * A Geometry Edit in progress on the selected mark. Nothing is written while
 * it stands; a release saves the proposal once, and the mark draws the
 * proposal until that write settles.
 */
export interface Adjustment {
  /** The handle, or the body, the press took. */
  grip: Grip;
  /** Where the press fell, in PDF points on the mark's page. */
  from: PdfPoint;
  /** The position the mark draws while the adjustment stands. */
  proposal: EditablePosition;
  /**
   * The quoted text of a highlight's or underline's proposed range, saved
   * with it; absent while the proposal is the confirmed position, and for an
   * image or ink.
   */
  text?: string;
  /**
   * `pressed` until the pointer moves, `dragging` while it does, and `saving`
   * once a release sent the proposal to Zotero.
   */
  phase: "pressed" | "dragging" | "saving";
}

/**
 * An image capture the armed image tool is dragging out on one page. Nothing
 * is written while it stands; a release big enough to keep creates the image
 * once, and the rectangle stays drawn until that write settles.
 */
export interface Capture {
  kind: "capture";
  /** The page the press fell on, which holds the whole rectangle. */
  pageIndex: number;
  /** Where the press fell, in PDF points on that page. */
  from: PdfPoint;
  /** The rectangle between the press and the pointer, in PDF points. */
  rect: PdfRect;
  /**
   * `pressed` until the pointer moves, `dragging` while it does, and `saving`
   * once a release sent the rectangle to Zotero.
   */
  phase: "pressed" | "dragging" | "saving";
}

/**
 * A Text Draft: free text the armed text tool opened on a page, typed into
 * here and created in Zotero once, with its text, when it is finished. It
 * stays drawn while that create is in flight, until the read that holds its
 * record takes its place.
 */
export interface TextDraft {
  kind: "text-draft";
  /** The page the click fell on, which holds the whole box. */
  pageIndex: number;
  /** The font size the text is typed at, in PDF points. */
  fontSize: number;
  color: string;
  /** The box's turn, which a new Text Draft never has. */
  rotation: 0;
  /** The box fitted to {@link text}, unrounded, in PDF points. */
  box: PdfRect;
  text: string;
  /**
   * `typing` until the draft is finished, and `saving` once its text was sent
   * to Zotero.
   */
  phase: "typing" | "saving";
  /** The created Annotation's Indexed Key, once Zotero named it. */
  key?: string;
}

/**
 * The one floating surface over the reader: nothing, the selected Annotation
 * Mark, a fresh text selection about to become one, an image capture being
 * dragged out, or a Text Draft. Being one union, the two popups can never
 * both stand.
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
      /** Whether the comment editor stands open under the popup's row. */
      commenting: boolean;
      /**
       * Whether the tag editor stands open in the popup's tag section. It and
       * the comment editor never stand open together.
       */
      tagging: boolean;
      /** The Geometry Edit a press on a Mark Handle or the body began. */
      adjust?: Adjustment;
    }
  | {
      /**
       * Several selected Annotations, as the Annotation View's Card Selection
       * set them. A group has no Mark Popup and no Mark Handles.
       *
       * @see apps/obsidian/docs/adr/0061-the-annotation-view-owns-its-card-selection.md
       */
      kind: "group";
      /** The selected Annotations, two or more, by Indexed Key. */
      keys: readonly string[];
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
    }
  | Capture
  | TextDraft;

/**
 * The Ink Stroke the pointer is drawing, as the last animation frame smoothed
 * it: one path, unrounded, on the page the press fell on. It sits beside the
 * floating surface rather than in it: a stroke opens no popup and dismisses
 * none.
 */
export interface LiveStroke extends InkPosition {
  color: string;
}

/**
 * An Ink Stroke released and rounded, drawn on its page while its create is
 * in flight, until the read that holds its record takes its place.
 */
export interface PendingStroke extends InkPosition {
  /** Tells one in-flight create's stroke from another's. */
  id: number;
  color: string;
  /** The created Annotation's Indexed Key, once Zotero named it. */
  key?: string;
}

export interface ReaderSurfaceState {
  /** The tool a released selection commits with, or `null` while none is armed. */
  armed: MarkTool | null;
  /** Whether the Annotation Marks are drawn over the pages. */
  marksVisible: boolean;
  /** Every tool's colour, as the settings-backed tool colour store holds it. */
  colors: Readonly<Record<AnnotationTool, string>>;
  /** The colours used last, most recent first, which every tool shares. */
  recentColors: readonly string[];
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
  /** The Ink Stroke being drawn, or `null` while none is. */
  liveStroke: LiveStroke | null;
  /** The released Ink Strokes whose creates are in flight, in release order. */
  pendingStrokes: readonly PendingStroke[];
  /** Every Annotation of this Attachment, as the last read answered them. */
  records: readonly AnnotationRecord[];
  /**
   * What the last write left on each Annotation, by Indexed Key. A key with no
   * entry is idle.
   */
  mutations: ReadonlyMap<string, MutationState>;
  /** The shared comment drafts, by Indexed Key. */
  commentDrafts: ReadonlyMap<string, TextFieldDraft>;
  /** The shared tag drafts, by Indexed Key. */
  tagDrafts: ReadonlyMap<string, TagDraft>;
}

export type ReaderSurfaceStore = ReturnType<typeof createReaderSurfaceState>;

export function createReaderSurfaceState({
  colors,
  recentColors = [],
  capability,
  now,
}: Pick<ReaderSurfaceState, "colors" | "capability" | "now"> &
  Partial<Pick<ReaderSurfaceState, "recentColors">>) {
  return createStore<ReaderSurfaceState>()(
    subscribeWithSelector(
      (): ReaderSurfaceState => ({
        armed: null,
        marksVisible: true,
        colors,
        recentColors,
        capability,
        capabilityAt: now,
        now,
        floating: NONE,
        liveStroke: null,
        pendingStrokes: [],
        records: [],
        mutations: new Map(),
        commentDrafts: new Map(),
        tagDrafts: new Map(),
      }),
    ),
  );
}

/**
 * Arms a tool, or stands the armed one down for `null`. Arming a tool that
 * takes a click or a stroke clears the floating surface, so no Mark Handle
 * stands to take a press meant to place a mark or to draw. A Text Draft stays:
 * the tool change finishes it, which may save it.
 */
export function arm(store: ReaderSurfaceStore, tool: MarkTool | null): void {
  const gesture = gestureOf(tool);
  store.setState(({ floating }) =>
    (gesture === "click" || gesture === "stroke") &&
    floating.kind !== "text-draft"
      ? { armed: tool, floating: NONE }
      : { armed: tool },
  );
}

/**
 * Writes a tool's colour to the settings-backed store and to this view. The
 * choice is a use of that colour too.
 */
export function setToolColor(
  store: ReaderSurfaceStore,
  toolColors: ToolColorStore,
  { tool, color }: { tool: AnnotationTool; color: string },
): void {
  toolColors.set(tool, color);
  store.setState({ colors: toolColors.current() });
  recordColorUse(store, toolColors, color);
}

/**
 * Puts a colour first in the recent list every tool shares: a tool coloured,
 * a mark created, or a mark recoloured.
 */
export function recordColorUse(
  store: ReaderSurfaceStore,
  toolColors: ToolColorStore,
  color: string,
): void {
  toolColors.use(color);
  store.setState({ recentColors: toolColors.recent() });
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
 * @param options.commenting whether the comment editor opens with the
 *   selection, as it does for a note just placed.
 */
export function selectMark(
  store: ReaderSurfaceStore,
  key: string | null,
  {
    stack,
    quiet = false,
    commenting = false,
  }: { stack?: readonly string[]; quiet?: boolean; commenting?: boolean } = {},
): void {
  store.setState(({ floating }) => {
    if (key === null) return { floating: NONE };
    const same = floating.kind === "selected" && floating.key === key;
    return {
      floating: selectedMark(key, stack, {
        quiet,
        commenting: commenting || (same && floating.commenting),
        tagging: !commenting && same && floating.tagging,
      }),
    };
  });
}

/** The floating surface of one selected mark, its editors as given. */
function selectedMark(
  key: string,
  stack: readonly string[] | undefined,
  state: { quiet: boolean; commenting: boolean; tagging: boolean },
): Extract<Floating, { kind: "selected" }> {
  const held = stack?.includes(key) ? stack : [key];
  return {
    kind: "selected",
    key,
    stack: held,
    index: held.indexOf(key),
    ...state,
  };
}

/**
 * Takes two or more Annotations as one selection, which draws no popup and no
 * handles.
 */
export function selectGroup(
  store: ReaderSurfaceStore,
  keys: readonly string[],
): void {
  store.setState({ floating: { kind: "group", keys: [...keys] } });
}

/** A floating surface the Mark Popup never hangs over. */
export type PopuplessFloating = Extract<
  Floating,
  { kind: "none" | "capture" | "text-draft" | "group" }
>;

/**
 * Whether nothing floats that the Mark Popup hangs over: nothing, an image
 * capture, a Text Draft, or a group.
 */
export function drawsNoPopup(
  floating: Floating,
): floating is PopuplessFloating {
  return (
    floating.kind === "none" ||
    floating.kind === "capture" ||
    floating.kind === "text-draft" ||
    floating.kind === "group"
  );
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
  // A Geometry Edit stands on the mark it began on, not on the next one.
  const { adjust: _adjust, ...selected } = floating;
  store.setState({
    floating: {
      ...selected,
      key: floating.stack[index]!,
      index,
      commenting: false,
      tagging: false,
    },
  });
}

/**
 * Begins a Geometry Edit on the selected mark, proposing its confirmed
 * position. Nothing begins while no mark with a PDF rects, ink or text
 * position is selected.
 */
export function beginAdjust(
  store: ReaderSurfaceStore,
  { grip, from }: Pick<Adjustment, "grip" | "from">,
): void {
  const { floating, records } = store.getState();
  if (floating.kind !== "selected") return;
  const position = records.find(({ key }) => key === floating.key)?.position;
  if (!position || !isEditablePosition(position)) return;
  store.setState({
    floating: {
      ...floating,
      adjust: { grip, from, proposal: position, phase: "pressed" },
    },
  });
}

/**
 * Takes the position the pointer now proposes, with the quoted text of a text
 * range's. A move that stores the same as the held proposal changes nothing,
 * so no subscriber redraws; a saving adjustment takes no more moves.
 */
export function moveAdjust(
  store: ReaderSurfaceStore,
  proposal: EditablePosition,
  text?: string,
): void {
  const { floating } = store.getState();
  if (floating.kind !== "selected" || !floating.adjust) return;
  const { adjust } = floating;
  if (adjust.phase === "saving") return;
  if (adjust.phase === "dragging" && sameGeometry(adjust.proposal, proposal))
    return;
  store.setState({
    floating: {
      ...floating,
      adjust: {
        ...adjust,
        proposal,
        ...(text !== undefined && { text }),
        phase: "dragging",
      },
    },
  });
}

/** Ends the adjustment and draws the mark from its record again. */
export function cancelAdjust(store: ReaderSurfaceStore): void {
  const { floating } = store.getState();
  if (floating.kind !== "selected" || !floating.adjust) return;
  const { adjust: _adjust, ...selected } = floating;
  store.setState({ floating: selected });
}

/**
 * Ends the drag at a release. A proposal that stores the same as the
 * confirmed record ends the adjustment; any other is held, `saving`, while
 * the caller writes it.
 *
 * @returns the proposal to save, or `null` for a release that changed nothing.
 */
export function endAdjust(store: ReaderSurfaceStore): EditablePosition | null {
  const { floating, records } = store.getState();
  if (floating.kind !== "selected" || !floating.adjust) return null;
  const { adjust } = floating;
  if (adjust.phase === "saving") return null;
  const confirmed = records.find(({ key }) => key === floating.key)?.position;
  if (
    !confirmed ||
    !isEditablePosition(confirmed) ||
    sameGeometry(confirmed, adjust.proposal)
  ) {
    cancelAdjust(store);
    return null;
  }
  store.setState({
    floating: { ...floating, adjust: { ...adjust, phase: "saving" } },
  });
  return adjust.proposal;
}

/**
 * Begins an image capture at a press on a page, which takes the floating
 * surface from whatever held it. Nothing begins while a capture stands.
 */
export function beginCapture(
  store: ReaderSurfaceStore,
  { pageIndex, from }: Pick<Capture, "pageIndex" | "from">,
): void {
  if (store.getState().floating.kind === "capture") return;
  store.setState({
    floating: {
      kind: "capture",
      pageIndex,
      from,
      rect: [from[0], from[1], from[0], from[1]],
      phase: "pressed",
    },
  });
}

/**
 * Takes the rectangle the pointer now drags out. A move to the held
 * rectangle changes nothing, so no subscriber redraws; a saving capture takes
 * no more moves.
 */
export function moveCapture(store: ReaderSurfaceStore, rect: PdfRect): void {
  const { floating } = store.getState();
  if (floating.kind !== "capture" || floating.phase === "saving") return;
  if (
    floating.phase === "dragging" &&
    floating.rect.every((value, index) => value === rect[index])
  )
    return;
  store.setState({ floating: { ...floating, rect, phase: "dragging" } });
}

/**
 * Ends the capture at a release. A rectangle big enough to keep is held,
 * `saving`, while the caller creates it; any other ends the capture.
 *
 * @returns the rectangle to create, or `null` for a release that keeps none.
 */
export function endCapture(store: ReaderSurfaceStore): PdfRect | null {
  const { floating } = store.getState();
  if (floating.kind !== "capture" || floating.phase === "saving") return null;
  if (!capturesImage(floating.rect)) {
    cancelCapture(store);
    return null;
  }
  store.setState({ floating: { ...floating, phase: "saving" } });
  return floating.rect;
}

/** Ends the capture, whatever phase it stands in, and draws nothing for it. */
export function cancelCapture(store: ReaderSurfaceStore): void {
  if (store.getState().floating.kind === "capture") clearFloating(store);
}

/**
 * Opens a Text Draft at a click on a page, which takes the floating surface
 * from whatever held it, and stands the armed tool down in the same update,
 * as Zotero's text tool stands down once it has placed its box. The box
 * starts as Zotero's does: a square one font size wide, centred on the click.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js#L3123-L3151
 */
export function openTextDraft(
  store: ReaderSurfaceStore,
  {
    pageIndex,
    at,
    fontSize,
    color,
  }: Pick<TextDraft, "pageIndex" | "fontSize" | "color"> & {
    /** Where the click fell, in PDF points on that page. */
    at: PdfPoint;
  },
): void {
  const [x, y] = at;
  const half = fontSize / 2;
  store.setState({
    armed: null,
    floating: {
      kind: "text-draft",
      pageIndex,
      fontSize,
      color,
      rotation: 0,
      box: [x - half, y - half, x + half, y + half],
      text: "",
      phase: "typing",
    },
  });
}

/**
 * Takes what the Text Draft now holds, and refits its box to it from the box
 * it had, as Zotero's reader refits a text box on each edit. A draft that is
 * saving takes no more typing.
 *
 * @param options.pageBox the page's view box, in PDF points.
 */
export function refitTextDraft(
  store: ReaderSurfaceStore,
  text: string,
  { measure, pageBox }: { measure: TextMeasure; pageBox: readonly number[] },
): void {
  const draft = selectTextDraft(store.getState());
  if (draft?.phase !== "typing") return;
  const box = fitStoredTextBox(
    text,
    {
      rects: [[...draft.box]],
      rotation: draft.rotation,
      fontSize: draft.fontSize,
    },
    { measure, pageBox },
  );
  store.setState({ floating: { ...draft, text, box } });
}

/**
 * Finishes the Text Draft. One holding text beyond whitespace is held,
 * `saving`, while the caller creates it; any other goes.
 *
 * @returns the draft to create, or `null` for one that creates nothing.
 */
export function finishTextDraft(store: ReaderSurfaceStore): TextDraft | null {
  const draft = selectTextDraft(store.getState());
  if (draft?.phase !== "typing") return null;
  if (draft.text.trim() === "") {
    clearFloating(store);
    return null;
  }
  const saving: TextDraft = { ...draft, phase: "saving" };
  store.setState({ floating: saving });
  return saving;
}

/**
 * A create answered with the Annotation's Indexed Key. The draft goes at once
 * where a read already holds that record; otherwise it carries the key, and
 * the read that brings the record takes it.
 */
export function settleTextDraft(store: ReaderSurfaceStore, key: string): void {
  store.setState(({ floating, records }) => {
    if (floating.kind !== "text-draft") return {};
    return { floating: heldBy({ ...floating, key }, records) };
  });
}

/** Takes a Text Draft whose create failed, or never ran, off the page. */
export function dropTextDraft(store: ReaderSurfaceStore): void {
  if (store.getState().floating.kind === "text-draft") clearFloating(store);
}

/**
 * Opens or closes the comment editor or sheet of whatever is floating. The
 * comment editor opens in place of the tag editor.
 */
export function setCommenting(
  store: ReaderSurfaceStore,
  commenting: boolean,
): void {
  const { floating } = store.getState();
  if (drawsNoPopup(floating) || floating.commenting === commenting) return;
  store.setState({
    floating:
      floating.kind === "selected"
        ? {
            ...floating,
            commenting,
            tagging: commenting ? false : floating.tagging,
          }
        : { ...floating, commenting },
  });
}

/**
 * Opens or closes the selected mark's tag editor. The tag editor opens in
 * place of the comment editor.
 */
export function setTagging(store: ReaderSurfaceStore, tagging: boolean): void {
  const { floating } = store.getState();
  if (floating.kind !== "selected" || floating.tagging === tagging) return;
  store.setState({
    floating: {
      ...floating,
      tagging,
      commenting: tagging ? false : floating.commenting,
    },
  });
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
  store.setState(({ floating, pendingStrokes }) => ({
    records,
    floating: heldBy(floating, records),
    pendingStrokes: unheldStrokes(pendingStrokes, records),
  }));
}

/**
 * The Pending Strokes a read does not hold yet. A record takes a stroke's
 * place once it carries the stroke's Indexed Key, or stores the very points,
 * width and colour the create sent — which is how a read that answers before
 * the create has returned still swaps the two in one update.
 *
 * Two strokes that round to the same points in the same pen — two taps on one
 * spot — are one stroke to that match: the first record to land takes both,
 * and the second shows again as its own mark once its record lands.
 */
function unheldStrokes(
  pending: readonly PendingStroke[],
  records: readonly AnnotationRecord[],
): readonly PendingStroke[] {
  if (pending.length === 0) return pending;
  const keys = new Set(records.map(({ key }) => key));
  const stored = new Set(
    records.flatMap(({ position, color }) =>
      position.kind === "pdf-ink" && color !== null
        ? [strokeIdentity(position, color)]
        : [],
    ),
  );
  const unheld = pending.filter(
    (stroke) =>
      !(stroke.key !== undefined && keys.has(stroke.key)) &&
      !stored.has(strokeIdentity(stroke, stroke.color)),
  );
  return unheld.length === pending.length ? pending : unheld;
}

/** A stroke as Zotero stores it: its rounded position, pen and colour. */
function strokeIdentity(position: InkPosition, color: string): string {
  return `${color.toLowerCase()} ${writePosition(position)}`;
}

/** Publishes the stroke as the pointer has drawn it by this frame. */
export function publishLiveStroke(
  store: ReaderSurfaceStore,
  liveStroke: LiveStroke,
): void {
  store.setState({ liveStroke });
}

export function clearLiveStroke(store: ReaderSurfaceStore): void {
  if (store.getState().liveStroke !== null)
    store.setState({ liveStroke: null });
}

export function appendPendingStroke(
  store: ReaderSurfaceStore,
  stroke: PendingStroke,
): void {
  store.setState(({ pendingStrokes }) => ({
    pendingStrokes: [...pendingStrokes, stroke],
  }));
}

/**
 * A create answered with the Annotation's Indexed Key. The stroke goes at
 * once where a read already holds that record; otherwise it carries the key,
 * and the read that brings the record takes it.
 */
export function settlePendingStroke(
  store: ReaderSurfaceStore,
  { id, key }: { id: number; key: string },
): void {
  store.setState(({ pendingStrokes, records }) => ({
    pendingStrokes: unheldStrokes(
      pendingStrokes.map((stroke) =>
        stroke.id === id ? { ...stroke, key } : stroke,
      ),
      records,
    ),
  }));
}

/** Takes a stroke whose create failed, or never ran, off the page. */
export function dropPendingStroke(store: ReaderSurfaceStore, id: number): void {
  store.setState(({ pendingStrokes }) => ({
    pendingStrokes: pendingStrokes.filter((stroke) => stroke.id !== id),
  }));
}

/**
 * What floats, stood down if it is a selection the records no longer hold, or
 * a saving Text Draft they now hold. A record takes a draft's place once it
 * carries the draft's Indexed Key, or stores the very box, colour and text the
 * create sent, which is how a read that answers before the create has
 * returned still swaps the two in one update.
 */
function heldBy(
  floating: Floating,
  records: readonly AnnotationRecord[],
): Floating {
  if (floating.kind === "selected")
    return records.some(({ key }) => key === floating.key) ? floating : NONE;
  if (floating.kind === "group") {
    const keys = floating.keys.filter((key) =>
      records.some((record) => record.key === key),
    );
    if (keys.length === floating.keys.length) return floating;
    if (keys.length > 1) return { kind: "group", keys };
    const [key] = keys;
    return key === undefined
      ? NONE
      : selectedMark(key, undefined, {
          quiet: true,
          commenting: false,
          tagging: false,
        });
  }
  if (floating.kind !== "text-draft" || floating.phase !== "saving")
    return floating;
  const identity = textIdentity(textDraftPosition(floating), {
    color: floating.color,
    comment: floating.text,
  });
  return records.some(
    (record) =>
      record.key === floating.key ||
      (record.position.kind === "pdf-text" &&
        textIdentity(record.position, record) === identity),
  )
    ? NONE
    : floating;
}

/** The text position a Text Draft is created at: its fitted box, unrounded. */
export function textDraftPosition({
  pageIndex,
  fontSize,
  rotation,
  box,
}: TextDraft): TextPosition & { rects: [PdfRect] } {
  return { pageIndex, fontSize, rotation, rects: [box] };
}

/**
 * An Annotation a complete read confirmed gone leaves at once, with what a
 * write and a draft held on it.
 */
export function dropRecord(store: ReaderSurfaceStore, key: string): void {
  store.setState(
    ({ records, mutations, commentDrafts, tagDrafts, floating }) => {
      const held = records.filter((record) => record.key !== key);
      const heldMutations = new Map(mutations);
      heldMutations.delete(key);
      return {
        records: held,
        floating: heldBy(floating, held),
        mutations: heldMutations,
        commentDrafts: withDraft(commentDrafts, key, null),
        tagDrafts: withDraft(tagDrafts, key, null),
      };
    },
  );
}

/** What the per-Annotation facts are read and announced through. */
export type AnnotationFacts = Pick<
  AnnotationRepository,
  "annotationState" | "on"
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
    ingestAnnotationState(store, key, annotations.annotationState(key));
  }
}

/**
 * Takes what the repository announces about one Annotation — what a write left
 * on it, its drafts, and its deletion — into the state.
 *
 * @returns what stops the listening.
 */
export function listenAnnotationEvents(
  store: ReaderSurfaceStore,
  annotations: AnnotationFacts,
): DisposableStack {
  const listening = new DisposableStack();
  listening.defer(
    annotations.on("annotation-changed", (key) =>
      ingestAnnotationState(store, key, annotations.annotationState(key)),
    ),
  );
  return listening;
}

/**
 * Takes one Annotation's whole state. A gone Annotation leaves with all it
 * held; a draft a database switch hid closes its editor, where a draft that
 * ended with its save leaves the editor as it stands.
 */
function ingestAnnotationState(
  store: ReaderSurfaceStore,
  key: string,
  state: AnnotationState,
): void {
  if (state.gone) {
    dropRecord(store, key);
    return;
  }
  // Only a draft this state still holds is hidden: the switch closes its
  // editor once, not every editor opened on the Annotation after it.
  if (state.hidden) {
    const { commentDrafts, tagDrafts } = store.getState();
    const comment = commentDrafts.get(key);
    const tags = tagDrafts.get(key);
    if (comment && hidden(comment, state.textDrafts.comment))
      hideCommentDraft(store, key);
    if (tags && hidden(tags, state.tagDraft)) hideTagDraft(store, key);
  }
  ingestMutation(store, key, state.mutation);
  ingestCommentDraft(store, key, state.textDrafts.comment);
  ingestTagDraft(store, key, state.tagDraft);
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
  draft: TextFieldDraft | null,
): void {
  const { commentDrafts, floating } = store.getState();
  if (sameFlat(commentDrafts.get(key) ?? null, draft)) return;
  store.setState({
    commentDrafts: withDraft(commentDrafts, key, draft),
    floating:
      draft?.state.kind === "conflict" ? closedEditor(floating, key) : floating,
  });
}

/**
 * Takes one Annotation's tag draft, or its absence once its save settled. The
 * repository hands back the same draft while it stands unchanged, so a comment
 * change announced on the same event leaves this one alone.
 */
function ingestTagDraft(
  store: ReaderSurfaceStore,
  key: string,
  draft: TagDraft | null,
): void {
  const { tagDrafts } = store.getState();
  if ((tagDrafts.get(key) ?? null) === draft) return;
  store.setState({ tagDrafts: withDraft(tagDrafts, key, draft) });
}

/** A database switch hid this draft; its editor closes in the same update. */
export function hideCommentDraft(store: ReaderSurfaceStore, key: string): void {
  const { commentDrafts, floating } = store.getState();
  store.setState({
    commentDrafts: withDraft(commentDrafts, key, null),
    floating: closedEditor(floating, key),
  });
}

/**
 * A database switch hid this tag draft; its editor closes in the same update,
 * with nothing to save.
 */
function hideTagDraft(store: ReaderSurfaceStore, key: string): void {
  const { tagDrafts, floating } = store.getState();
  store.setState({
    tagDrafts: withDraft(tagDrafts, key, null),
    floating:
      floating.kind === "selected" && floating.key === key && floating.tagging
        ? { ...floating, tagging: false }
        : floating,
  });
}

/**
 * Whether the repository hid a held draft: it answers none for the Annotation,
 * or one that another database began.
 */
function hidden(
  held: { serverID: string },
  now: { serverID: string } | null,
): boolean {
  return now === null || now.serverID !== held.serverID;
}

function withDraft<T>(
  drafts: ReadonlyMap<string, T>,
  key: string,
  draft: T | null,
): ReadonlyMap<string, T> {
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
  tagging: boolean;
}

export function selectFloatingHead({
  floating,
}: ReaderSurfaceState): FloatingHead {
  return {
    kind: floating.kind,
    key: floating.kind === "selected" ? floating.key : null,
    commenting: "commenting" in floating && floating.commenting,
    tagging: floating.kind === "selected" && floating.tagging,
  };
}

/** The Text Draft on a page, or `null` while none stands. */
export function selectTextDraft({
  floating,
}: ReaderSurfaceState): TextDraft | null {
  return floating.kind === "text-draft" ? floating : null;
}

/** The image capture being dragged out, or `null` while none stands. */
export function selectCapture({
  floating,
}: ReaderSurfaceState): Capture | null {
  return floating.kind === "capture" ? floating : null;
}

/** The selected Annotation's Indexed Key, or `null` while none is selected. */
export function selectSelectedKey({
  floating,
}: ReaderSurfaceState): string | null {
  return floating.kind === "selected" ? floating.key : null;
}

/**
 * Whether the selected mark carries its Mark Handles: a mark selected alone
 * does while editing is live, and a group does not. A Locked Annotation
 * carries none, since its lock refuses the Geometry Edit they begin.
 */
export function selectMarkHandles(state: ReaderSurfaceState): boolean {
  const key = selectSelectedKey(state);
  if (key === null || !editingLive(state.capability)) return false;
  const record = state.records.find((annotation) => annotation.key === key);
  return lockBlock(record?.lock ?? null, "geometry") === null;
}

/**
 * The Indexed Keys of every selected Annotation: the one selected mark, or a
 * group. Empty while none is selected.
 */
export function selectSelectedKeys({
  floating,
}: ReaderSurfaceState): readonly string[] {
  if (floating.kind === "selected") return [floating.key];
  return floating.kind === "group" ? floating.keys : [];
}

/** The Geometry Edit on the selected mark, or `null` while none stands. */
export function selectAdjust({
  floating,
}: ReaderSurfaceState): Adjustment | null {
  return floating.kind === "selected" ? (floating.adjust ?? null) : null;
}

/** The selected Annotation's comment draft, or `null` while it has none. */
export function selectSelectedDraft({
  floating,
  commentDrafts,
}: ReaderSurfaceState): TextFieldDraft | null {
  return floating.kind === "selected"
    ? (commentDrafts.get(floating.key) ?? null)
    : null;
}

/** The selected Annotation's tag draft, or `null` while it has none. */
export function selectSelectedTagDraft({
  floating,
  tagDrafts,
}: ReaderSurfaceState): TagDraft | null {
  return floating.kind === "selected"
    ? (tagDrafts.get(floating.key) ?? null)
    : null;
}

/** What the selected-mode popup is drawn from: its row's input, and its editor. */
export interface SelectedRowInput extends MarkPopupRowInput {
  /** Whether the comment editor stands open under the comment pencil. */
  commenting: boolean;
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
}: ReaderSurfaceState): SelectedRowInput | null {
  if (floating.kind !== "selected") return null;
  const annotation = records.find(({ key }) => key === floating.key);
  if (!annotation) return null;
  return {
    annotation,
    blocks: annotationBlocks({ annotation, capability, now: capabilityAt }),
    mutation: mutations.get(floating.key) ?? IDLE,
    stack: { index: floating.index, total: floating.stack.length },
    commenting: floating.commenting,
    tagging: floating.tagging,
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
  draft: TextFieldDraft | null;
  /** The stored comment the popup renders under its row. */
  comment: string | null;
  /** Held by identity, as {@link SelectedRowHead.draft} is. */
  tagDraft: TagDraft | null;
}

/**
 * One stored tag the popup renders under the comment, compared by value: a
 * re-read hands back new records for the same tags. The type is absent where
 * the record holds names alone.
 */
type SelectedRowTag = Pick<AnnotationTag, "name"> &
  Partial<Pick<AnnotationTag, "type">>;

/**
 * The selected-mode row as flat records, for {@link sameFlatList}: the verbs as
 * {@link markPopupRow} decides them, one record per stored tag, then one record
 * for the rest. Empty while no row stands.
 */
export function selectSelectedRow(
  state: ReaderSurfaceState,
): readonly (MarkPopupVerb | SelectedRowTag | SelectedRowHead)[] {
  const input = selectSelectedRowInput(state);
  if (!input) return [];
  const { verbs, color } = markPopupRow(input);
  const { tags, tagDetails } = input.annotation;
  return [
    ...verbs,
    ...(tagDetails ?? tags.map((name): SelectedRowTag => ({ name }))),
    {
      key: input.annotation.key,
      color,
      stackIndex: input.stack.index,
      stackTotal: input.stack.total,
      mutation: input.mutation,
      draft: selectSelectedDraft(state),
      comment: input.annotation.comment,
      tagDraft: selectSelectedTagDraft(state),
    },
  ];
}

/** How many swatches the create-mode row offers; the `1`–`8` keys reach all. */
const CREATE_POPUP_SWATCHES = 4;

/**
 * What the create-mode row is decided from, or `null` while no selection
 * waits. Read against the instant the capability was ingested, as above.
 */
export function selectCreateRowInput({
  floating,
  armed,
  colors,
  recentColors,
  capability,
  capabilityAt,
}: ReaderSurfaceState): CreatePopupRowInput | null {
  if (floating.kind !== "create") return null;
  return {
    armed,
    colors,
    swatches: offeredSwatches(recentColors, CREATE_POPUP_SWATCHES),
    capability,
    mutation: floating.inFlight ? { kind: "pending", write: "create" } : IDLE,
    commenting: floating.commenting,
    now: capabilityAt,
  };
}

/**
 * The create-mode row as flat records, for {@link sameFlatList}: each control
 * without the action it runs and the classes it wears, which its id already
 * names. Empty while no selection waits.
 */
export function selectCreateRow(
  state: ReaderSurfaceState,
): readonly Omit<CreatePopupControl, "action" | "cls">[] {
  const input = selectCreateRowInput(state);
  return input
    ? createPopupRow(input).map(
        ({ action: _action, cls: _cls, ...control }) => control,
      )
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
