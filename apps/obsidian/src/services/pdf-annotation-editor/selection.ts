// The selected Annotation Mark of one PDF view: the gesture that picks it, the
// keys that walk and edit it, and the Mark Popup that hangs over it.
//
// Marks take no pointer input, so every gesture here is answered from geometry
// and nothing is hung on a mark's own node. Click-away belongs to this hit test
// rather than to the popup: the press that opens the popup is not an outside
// press, and this is the only thing that hides it.
//
// @see apps/obsidian/docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md
// @see https://github.com/aidenlx/zotlit/issues/1148
import type { App } from "obsidian";
import { Keymap } from "obsidian";

import type {
  PdfPosition,
  RangeAdjustment,
  SelectedText,
} from "@zotlit/pdf-structure";

import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import { registerDomEvent } from "@/lib/disposables";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { showMenuAtButton } from "@/lib/menu";
import { BaseNotice } from "@/lib/notice";
import * as toast from "@/lib/toast";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationRecord,
  AnnotationRepository,
  CommentDraft,
} from "@/services/annotation-repository/service";
import {
  writeFailureMessage,
  writeFailureReason,
} from "@/services/annotation-repository/write";
import type {
  MutationState,
  WriteFailure,
} from "@/services/annotation-repository/write";
import { conflictPanel } from "@/views/annot-view/card-conflict";
import {
  commentEditorControls,
  editingLive,
  heldCommentDraft,
} from "@/views/annot-view/card-controls";
import {
  renderCommentSheet,
  renderConflictPanel,
  renderHeldDraftPanel,
} from "@/views/annot-view/comment-sheet";
import type {
  CommentDraftActions,
  CommentSheet,
} from "@/views/annot-view/comment-sheet";

import { inTextEntry, isEditGesture } from "./capability-affordance";
import type { CreationGestures } from "./creation";
import {
  bodyRect,
  gripAt,
  HANDLE_RADIUS,
  handleLayout,
  isEditablePosition,
  isRangeGrip,
  keyedPosition,
  keyEdit,
  proposePosition,
  RANGE_HANDLE_PADDING,
  rangeGripAt,
  rangeHandles,
  releasedPosition,
} from "./geometry-edit";
import type {
  Arrow,
  EditablePosition,
  FreeTextContent,
  Grip,
  PdfPoint,
  RangeGrip,
  TextRotation,
} from "./geometry-edit";
import {
  distance,
  markAnchor,
  marksAtPoint,
  pagePointOf,
  resolveMarkClick,
} from "./hit-test";
import type { HitPage, MarkSelectionPoint, PageBox, Point } from "./hit-test";
import { markPopupRow, popupColumn, renderMarkPopupRow } from "./mark-popup";
import type { MarkPopupControlId, MarkPopupRowInput } from "./mark-popup";
import type { MarkPopupHost } from "./mark-popup-host";
import {
  beginAdjust,
  cancelAdjust,
  endAdjust,
  moveAdjust,
  sameFlat,
  selectAdjust,
  selectSelectedRowInput,
  selectFloatingHead,
  selectMark,
  selectSelectedDraft,
  selectSelectedKey,
  recordColorUse,
  setCommenting,
  stepStack,
} from "./reader-surface-state";
import type {
  ReaderSurfaceState,
  ReaderSurfaceStore,
} from "./reader-surface-state";
import { readingOrder, stepReadingOrder } from "./reading-order";
import {
  freeTextOf,
  interfaceFont,
  markTargets,
  unitPointOf,
  unitsPerPixel,
} from "./render";
import type { OverlayPageView, PdfPageAnnotation } from "./render";
import {
  colorMenu,
  drawnBoxOf,
  onScreen,
  pageBoxOf,
  pdfPointAt,
  pdfPointOf,
  releaseCapture,
  selectionCollapsed,
  unitsOf,
} from "./surface";
import type { ToolColorStore } from "./tools";

const logger = getLogger("pdf-annotation-editor");

/** What the selection reads and writes one Annotation through. */
export type AnnotationEdits = Pick<
  AnnotationRepository,
  | "commentDraftFor"
  | "deleteAnnotation"
  | "discardCommentDraft"
  | "editComment"
  | "patchColor"
  | "patchGeometry"
  | "retryCommentDraft"
  | "submitComment"
>;

/** How a selection taken from outside the reader opens its Mark Popup. */
export interface SelectOptions {
  /** Whether the Mark Popup opens over the selection. */
  popup?: boolean;
  /** Whether the popup opens on its comment editor. */
  commenting?: boolean;
}

/**
 * The gestures the Mark Popup hands to its UI seam, which render and decide
 * nothing themselves.
 *
 * @see apps/obsidian/policies/ui-seams.md
 */
export interface MarkGestures {
  /**
   * Bring this Annotation's card forward in the Annotation View, with the caret
   * in its comment editor when the comment verb asked for it — anything that
   * needs typing is the card's, and the popup only points at it.
   */
  revealAnnotation: (
    annotationKey: string,
    options: { comment: boolean },
  ) => void;
  /**
   * An edit gesture met a block on this Attachment. The seam probes Zotero and
   * says why, once per reason per capability episode.
   */
  reportBlockedGesture: () => void;
  /**
   * Ask Zotero for editing again, from the held-draft panel's "Allow editing".
   * A button answers every press, so it does not go through the blocked-gesture
   * notice, which speaks once per reason per episode.
   */
  allowEditing: () => void;
}

export interface MarkSelectionDeps {
  /** The PDF view's container: where the gestures are heard, and what scrolls. */
  containerEl: HTMLElement;
  /** The app the comment editor takes its keys through. */
  app: App;
  /**
   * The one popup of this view: a press inside it leaves the selection
   * standing, and a scroll re-hangs it.
   */
  popup: Pick<MarkPopupHost, "contains" | "sync">;
  /** The marks on screen, by page index, as the binding last painted them. */
  marks: () => ReadonlyMap<number, readonly PdfPageAnnotation[]>;
  /** Every Annotation of this Attachment, as the repository last answered. */
  records: () => readonly AnnotationRecord[];
  /** The page that draws a page index, or `null` while the viewer holds none. */
  pageAt: (pageIndex: number) => OverlayPageView | null;
  /** Redraws the overlays, so the selected mark carries `is-selected`. */
  repaint: () => void;
  /** Brings the reader to an Annotation, for the keys that walk the list. */
  navigate: (annotationKey: string) => void;
  /** Announces the selection to whoever follows this reader. */
  report: (annotationKeys: readonly string[]) => void;
  annotations: AnnotationEdits;
  /** The colours used last, which a recolour puts a colour first in. */
  colors: ToolColorStore;
  /** What this view's surfaces draw from, the Editing Capability among it. */
  surfaceState: ReaderSurfaceStore;
  gestures: MarkGestures;
  /**
   * The creation surfaces, which hear the same pointer and key gestures this
   * class already owns. One listener set serves both.
   *
   * @see https://github.com/aidenlx/zotlit/issues/1150
   */
  creation: CreationGestures | null;
  /**
   * The Sort Index of a position in the open document, which a Geometry Edit
   * is saved with; `null` while no document is open.
   */
  sortIndex: (position: PdfPosition) => Promise<string | null>;
  /**
   * A highlight's or underline's range with one end dragged to a point, from
   * the open document's Structured Characters; `null` while no document is
   * open, or for a point no range can be placed from.
   */
  adjustRange: (adjustment: RangeAdjustment) => Promise<SelectedText | null>;
  /** The text rotation a text range's handles lie across, as they are drawn. */
  textRotation: TextRotation;
  /**
   * Settles when the marks match the last read the view started — the read a
   * saved Geometry Edit announced, which the mark then draws.
   */
  refreshed: () => Promise<void>;
  /** The clock a cooldown's remaining seconds are read against. */
  now: () => Temporal.Instant;
}

/**
 * One selected mark per PDF view, held in the Reader Surface State, with the
 * row and the comment editor the popup host draws over it.
 */
export class MarkSelection implements Disposable {
  readonly #deps;
  readonly #surfaces = new DisposableStack();
  /**
   * Where the click that made the selection fell, which a repeat click steps
   * from; `null` for a selection no click made.
   */
  #at: Pick<MarkSelectionPoint, "pageIndex" | "point"> | null = null;
  /** The row of verbs the popup last built; `null` until one is. */
  #row: HTMLElement | null = null;
  #commentEditor: CommentSheet | null = null;
  #pressedAt: Point | null = null;
  /** The pointer a Geometry Edit holds, and where it last stood. */
  #dragging: { pointerId: number; client: Point } | null = null;
  /** Whether the last press took a Mark Handle, whose click selects nothing. */
  #pressedHandle = false;
  /** Whether the last press was the armed ink tool's, whose click selects nothing. */
  #pressedStroke = false;
  #adjusting = Promise.resolve();
  /**
   * The text range the pointer last asked for, which a release waits on so
   * it saves where the pointer let go.
   */
  #ranging = Promise.resolve();
  /** Counts the range asks, so an answer a later ask or a cancel overtook is dropped. */
  #rangeAsk = 0;

  constructor(deps: MarkSelectionDeps) {
    this.#deps = deps;
  }

  /** The Indexed Keys the overlay draws as selected. */
  get selected(): ReadonlySet<string> {
    const key = this.#selectedKey();
    return new Set(key === null ? [] : [key]);
  }

  /**
   * Settles when the last Geometry Edit released in this reader has saved, or
   * ended without a write. Already settled while none has. Never rejects.
   */
  get adjusted(): Promise<void> {
    return this.#adjusting;
  }

  load(): void {
    const { containerEl } = this.#deps;
    this.#surfaces.use(
      registerDomEvent(containerEl, "pointerdown", (event) => {
        this.#pressedAt = { x: event.clientX, y: event.clientY };
        this.#pressGrip(event);
        // A press no grip took is the armed image tool's, unless a mark
        // lies under it.
        if (!this.#dragging)
          this.#deps.creation?.grab(event, {
            onMark: () => this.#onMark(event),
          });
        // The armed ink tool takes every main-button press before any mark
        // could, as Zotero's reader does, whether or not the press drew.
        this.#pressedStroke =
          event.button === 0 && this.#state().armed === "ink";
      }),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "pointermove", (event) => {
        if (event.pointerId !== this.#dragging?.pointerId) {
          this.#deps.creation?.move(event);
          return;
        }
        this.#dragging.client = { x: event.clientX, y: event.clientY };
        this.#propose();
      }),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "pointerup", (event) => {
        if (event.pointerId === this.#dragging?.pointerId) this.#release();
        else this.#deps.creation?.release(event);
      }),
    );
    // A drag on a grip moves the mark, and an image capture draws a
    // rectangle; the browser selects no text under either.
    this.#surfaces.use(
      registerDomEvent(containerEl, "selectstart", (event) => {
        if (this.#dragging || this.#deps.creation?.capturing)
          event.preventDefault();
      }),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "pointercancel", (event) => {
        if (event.pointerId === this.#dragging?.pointerId) this.#cancelDrag();
        else this.#deps.creation?.cancel(event);
      }),
    );
    // A capture the browser took away without a cancel ends the stroke or the
    // rectangle it held; a release lets go of its own first, so its loss
    // matches nothing.
    this.#surfaces.use(
      registerDomEvent(containerEl, "lostpointercapture", (event) => {
        if (event.pointerId !== this.#dragging?.pointerId)
          this.#deps.creation?.cancel(event);
      }),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "click", (event) => this.#click(event)),
    );
    // The browser has settled the selection by the time a release bubbles, so
    // this is where a drag on the page becomes a selection worth acting on.
    this.#surfaces.use(
      registerDomEvent(containerEl.doc, "pointerup", () =>
        this.#deps.creation?.settle(),
      ),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "keydown", (event) => {
        this.#key(event);
        // The selected mark's keymap answers first; what it left alone is the
        // creation surfaces', so one key never runs two verbs.
        if (!event.defaultPrevented) this.#deps.creation?.key(event);
      }),
    );
    // Scrolling does not bubble, so the page's own scroller is reached by
    // listening on the way down.
    this.#surfaces.use(
      registerDomEvent(
        containerEl,
        "scroll",
        () => {
          // The page moved under a pointer that did not, so the drag is
          // measured again against the page where it now stands.
          if (this.#dragging) this.#propose();
          this.#deps.popup.sync();
        },
        { capture: true },
      ),
    );
    this.#surfaces.use(
      registerDomEvent(
        containerEl.doc,
        "pointerdown",
        (event) => {
          // On the way down, so the creation surfaces hear every press in this
          // window — inside the reader and outside it alike.
          this.#deps.creation?.press(event);
          this.#outsidePress(event);
        },
        { capture: true },
      ),
    );
    // Only one floating surface is ever open, and a live text selection is the
    // one the browser is already showing.
    this.#surfaces.use(
      registerDomEvent(containerEl.doc, "selectionchange", () => {
        if (
          this.#selectedKey() !== null &&
          !selectionCollapsed(this.#deps.containerEl)
        )
          this.#apply(null);
        this.#deps.creation?.changed();
      }),
    );
    const state = this.#deps.surfaceState;
    this.#surfaces.defer(
      state.subscribe(selectSelectedKey, (key) => {
        this.#deps.repaint();
        this.#deps.report(key === null ? [] : [key]);
      }),
    );
    // The editor goes with the episode it was opened for: a closed editor, a
    // stepped or dropped selection, and a hidden or conflicting draft alike.
    this.#surfaces.defer(
      state.subscribe(
        selectFloatingHead,
        ({ kind, commenting }) => {
          if (kind !== "selected" || !commenting) this.#closeCommentEditor();
        },
        { equalityFn: sameFlat },
      ),
    );
    this.#surfaces.defer(
      state.subscribe(selectSelectedDraft, (draft) => this.#patchEditor(draft)),
    );
  }

  /**
   * Take this Annotation as the selection, from a surface outside the reader —
   * a click on its card in the Annotation View.
   *
   * @param options.popup whether the Mark Popup opens over the selection.
   *   A Mark Landing passes `false`: the user followed a link to read a
   *   passage, not for a popover over a document they have only just arrived
   *   at. The suppression lasts until the next selection, so a page re-render
   *   does not summon the popup the Landing declined.
   * @param options.commenting whether the popup opens on its comment editor,
   *   as it does for a note just placed.
   */
  select(
    annotationKey: string | null,
    { popup = true, commenting = false }: SelectOptions = {},
  ): void {
    this.#apply(annotationKey, null, { popup, commenting });
  }

  [Symbol.dispose](): void {
    this.#submitAndCloseCommentEditor();
    this.#surfaces.dispose();
    if (this.#selectedKey() !== null) selectMark(this.#deps.surfaceState, null);
  }

  #apply(
    key: string | null,
    at: {
      pageIndex: number;
      point: Point;
      stack: readonly string[];
    } | null = null,
    { popup = true, commenting = false }: SelectOptions = {},
  ): void {
    if (key !== this.#selectedKey()) {
      this.#submitAndCloseCommentEditor();
    }
    this.#at =
      key !== null && at !== null
        ? { pageIndex: at.pageIndex, point: at.point }
        : null;
    selectMark(this.#deps.surfaceState, key, {
      stack: at?.stack,
      quiet: !popup,
      commenting,
    });
  }

  #click(event: MouseEvent): void {
    const pressed = this.#pressedAt;
    this.#pressedAt = null;
    // A Mark Handle is a grip, not a mark: its click keeps the selection.
    if (this.#pressedHandle) {
      this.#pressedHandle = false;
      return;
    }
    // A press of the ink tool on a mark — a stroke, a dot, or one that editing
    // blocked — selects nothing.
    if (this.#pressedStroke) {
      this.#pressedStroke = false;
      return;
    }
    const client = { x: event.clientX, y: event.clientY };
    const page = this.#pageUnder(client);
    const outcome = resolveMarkClick({
      page,
      travel: pressed === null ? 0 : distance(pressed, client),
      collapsed: selectionCollapsed(this.#deps.containerEl),
      onLink: linkUnder(event.target),
      altKey: event.altKey,
      previous: this.#previous(),
    });
    switch (outcome.kind) {
      case "ignore":
        return;
      case "deselect":
        if (this.#selectedKey() !== null) this.#apply(null);
        return;
      case "select":
        if (page) {
          this.#apply(outcome.key, {
            pageIndex: page.index,
            point: page.at.point,
            stack: outcome.stack,
          });
        }
        return;
    }
  }

  /**
   * Escape on the selected mark, which the Reader Keymap runs ahead of the
   * creation surfaces: a drag is taken back first, and the selection only
   * after.
   *
   * @returns whether a mark was selected to step back from.
   */
  escape(): boolean {
    if (this.#selectedKey() === null) return false;
    if (this.#dragging) this.#cancelDrag();
    else this.#apply(null);
    return true;
  }

  #key(event: KeyboardEvent): void {
    // A keystroke inside a text field belongs to the field.
    if (inTextEntry(event.target)) return;
    if (this.#geometryKey(event)) return;
    // A modified keystroke belongs to Obsidian's own commands.
    if (event.ctrlKey || event.metaKey) return;
    const walk =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : null;
    if (walk !== null) {
      const next = stepReadingOrder(
        readingOrder(this.#deps.records()),
        this.#selectedKey(),
        walk,
      );
      if (next === null) return;
      event.preventDefault();
      this.#apply(next);
      this.#deps.navigate(next);
      return;
    }
    const key = this.#selectedKey();
    if (key === null) return;
    // `1`–`8` are the palette's own order, so the key and the swatch can never
    // name different colours.
    const swatch = ANNOTATION_COLORS[Number(event.key) - 1];
    if (swatch !== undefined) {
      // A colour key is one of the shared edit keymap's keys, so whether this
      // keystroke is one of them is read from there rather than decided again:
      // `Alt`+`1` is no edit gesture for the block's notice, and none here.
      if (!isEditGesture(event)) return;
      // A blocked colour key is answered by the binding's own edit-gesture
      // listener, which hears every key of the shared edit keymap.
      if (this.#live()) {
        event.preventDefault();
        this.#recolor(key, swatch);
      }
      return;
    }
    // The Mac keyboards that print "delete" on the backspace key send
    // `Backspace`, so both reach the same verb.
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    event.preventDefault();
    if (this.#live()) this.#write(this.#deps.annotations.deleteAnnotation(key));
    else this.#deps.gestures.reportBlockedGesture();
  }

  /**
   * A modified arrow on the selected mark is one Geometry Edit, committed
   * through the same path a released drag takes: `Shift` steps a text range's
   * end, `Mod`+`Shift` its start, `Shift` resizes an image or ink, and `Alt`
   * nudges it. While editing is not live the key does nothing, and while an
   * earlier edit is still on its way it waits for none.
   *
   * @returns whether the key was one of these, which no other verb then takes.
   */
  #geometryKey(event: KeyboardEvent): boolean {
    const arrow = ARROWS[event.key];
    const record = this.#record();
    if (!arrow || !record || !isEditablePosition(record.position)) return false;
    const mod = Keymap.isModifier(event, "Mod");
    // `Ctrl` on macOS, and `Meta` elsewhere, is no platform key.
    if ((event.ctrlKey || event.metaKey) && !mod) return false;
    const edit = keyEdit(record.type, {
      shift: event.shiftKey,
      alt: event.altKey,
      mod,
    });
    if (!edit) return false;
    if (!this.#live() || this.#dragging || selectAdjust(this.#state()))
      return true;
    event.preventDefault();
    const store = this.#deps.surfaceState;
    const { position } = record;
    if (edit.kind === "range") {
      if (position.kind !== "pdf-rects") return true;
      beginAdjust(store, { grip: edit.end, from: [0, 0] });
      const ask = ++this.#rangeAsk;
      this.#adjusting = this.#deps
        .adjustRange({ position, end: edit.end, step: arrow })
        .then((selected) => {
          if (ask !== this.#rangeAsk) return;
          if (!selected) {
            cancelAdjust(store);
            return;
          }
          moveAdjust(store, rectsPositionOf(selected), selected.text);
          return this.#settle(record.key);
        })
        .catch((error: unknown) => {
          cancelAdjust(store);
          logger.warn("Could not step a highlight's range", {
            error,
            annotationKey: record.key,
          });
        });
      return true;
    }
    const page = this.#deps.pageAt(position.pageIndex);
    const keyed =
      page &&
      keyedPosition({
        confirmed: position,
        edit: edit.kind,
        arrow,
        viewBox: page.viewport.viewBox,
        text: this.#textContent(record),
      });
    if (!keyed) return true;
    beginAdjust(store, { grip: keyed.grip, from: [0, 0] });
    moveAdjust(store, keyed.proposal);
    const saving = this.#settle(record.key);
    if (saving) this.#adjusting = saving;
    return true;
  }

  /**
   * A press on a Mark Handle, or on the body of a selected mark that moves by
   * it, begins a Geometry Edit: the pointer is captured and the browser's text
   * selection is held off for the drag. Every other press, and every press
   * while editing is not live, is left to the click and the text selection.
   */
  #pressGrip(event: PointerEvent): void {
    this.#pressedHandle = false;
    const record = this.#record();
    if (event.button !== 0 || !record || !this.#live()) return;
    const state = this.#state();
    if (!state.marksVisible || selectAdjust(state)) return;
    if (!isEditablePosition(record.position)) return;
    const client = { x: event.clientX, y: event.clientY };
    const range = this.#rangeGripAt(record, client);
    if (range) {
      this.#holdGrip(event, range.grip, range.from);
      return;
    }
    const page = this.#deps.pageAt(record.position.pageIndex);
    if (!page) return;
    const box = drawnBoxOf(page);
    const point = unitsOf(box, { x: event.clientX, y: event.clientY });
    const rect = bodyRect(record);
    let body: [number, number, number, number] | null = null;
    if (rect) {
      const a = unitPointOf(page, [rect[0], rect[1]]);
      const b = unitPointOf(page, [rect[2], rect[3]]);
      body = [
        Math.min(a.x, b.x),
        Math.min(a.y, b.y),
        Math.max(a.x, b.x),
        Math.max(a.y, b.y),
      ];
    }
    const grip = gripAt({
      handles: handleLayout(record).map(({ grip, at }) => ({
        grip,
        at: unitPointOf(page, at),
      })),
      body,
      point,
      radius: HANDLE_RADIUS * unitsPerPixel(page),
    });
    if (!grip) return;
    this.#holdGrip(event, grip, pdfPointOf(page, point));
  }

  /**
   * Captures the pointer for a Geometry Edit on a grip, holding the browser's
   * text selection off for the drag.
   */
  #holdGrip(event: PointerEvent, grip: Grip, from: PdfPoint): void {
    event.preventDefault();
    this.#deps.containerEl.setPointerCapture(event.pointerId);
    this.#dragging = {
      pointerId: event.pointerId,
      client: { x: event.clientX, y: event.clientY },
    };
    this.#pressedHandle = grip !== "body";
    beginAdjust(this.#deps.surfaceState, { grip, from });
  }

  /**
   * The end of a selected highlight's or underline's range a press takes, and
   * where it fell on the page of that end's strip; `null` for a press on
   * neither, or on a mark that is no text range.
   */
  #rangeGripAt(
    record: AnnotationRecord,
    client: Point,
  ): { grip: RangeGrip; from: PdfPoint } | null {
    const { pageIndex } = record.position as EditablePosition;
    const page = this.#deps.pageAt(pageIndex);
    if (!page) return null;
    const handles = rangeHandles(
      record,
      RANGE_HANDLE_PADDING * unitsPerPixel(page),
      this.#deps.textRotation,
    );
    const pointOn = (index: number): PdfPoint | null => {
      const on = this.#deps.pageAt(index);
      return on && pdfPointAt(on, client);
    };
    const grip = rangeGripAt(handles, pointOn);
    const on = handles.find((handle) => handle.grip === grip);
    const from = on && pointOn(on.pageIndex);
    return grip && from ? { grip, from } : null;
  }

  /** Proposes the position the held grip reaches at the pointer's last place. */
  #propose(): void {
    const record = this.#record();
    const adjust = selectAdjust(this.#state());
    const dragging = this.#dragging;
    if (!record || !adjust || !dragging) return;
    if (!isEditablePosition(record.position)) return;
    // Read on every move, so a scroll or a zoom mid-drag is measured against
    // the page as it now stands.
    if (isRangeGrip(adjust.grip)) {
      this.#proposeRange(record, adjust.grip, dragging.client);
      return;
    }
    const page = this.#deps.pageAt(record.position.pageIndex);
    if (!page) return;
    moveAdjust(
      this.#deps.surfaceState,
      proposePosition({
        confirmed: record.position,
        grip: adjust.grip,
        from: adjust.from,
        to: pdfPointAt(page, dragging.client),
        viewBox: page.viewport.viewBox,
        text: this.#textContent(record),
      }),
    );
  }

  /**
   * What a selected free-text box's height is fitted to: its text, measured
   * in the font it is drawn in. Every mark's edit takes it; only a free-text
   * box's measures anything.
   */
  #textContent(record: AnnotationRecord): FreeTextContent {
    const win = this.#deps.containerEl.win;
    return {
      comment: freeTextOf(record),
      measure: (text, fontSize) => interfaceFont(win).measure(text, fontSize),
    };
  }

  /**
   * Asks the document for the range the held end reaches at a client point,
   * and proposes it once it answers, unless a later ask or a cancel came
   * first. A point no range can be placed from keeps the last proposal.
   *
   * The start is measured on the Annotation's own page, however far off it
   * the pointer is, since the start never leaves that page. The end is
   * measured on that page or the next, whichever box the pointer is nearer.
   */
  #proposeRange(
    record: AnnotationRecord,
    grip: RangeGrip,
    client: Point,
  ): void {
    const position = record.position;
    if (position.kind !== "pdf-rects") return;
    const pages = [position.pageIndex, position.pageIndex + 1].flatMap(
      (pageIndex) => {
        const page = this.#deps.pageAt(pageIndex);
        return page ? [{ pageIndex, page, box: drawnBoxOf(page) }] : [];
      },
    );
    const [on] = pages
      .filter(
        ({ pageIndex }) => grip === "end" || pageIndex === position.pageIndex,
      )
      .toSorted(
        (a, b) => boxDistance(a.box, client) - boxDistance(b.box, client),
      );
    if (!on) return;
    const [x, y] = pdfPointAt(on.page, client);
    const ask = ++this.#rangeAsk;
    const store = this.#deps.surfaceState;
    this.#ranging = this.#deps
      .adjustRange({
        position,
        end: grip,
        point: { pageIndex: on.pageIndex, x, y },
      })
      .then((selected) => {
        if (ask !== this.#rangeAsk || !selected) return;
        moveAdjust(store, rectsPositionOf(selected), selected.text);
      })
      .catch((error: unknown) => {
        logger.warn("Could not place a highlight's dragged range", {
          error,
          annotationKey: record.key,
        });
      });
  }

  #release(): void {
    this.#dragging = releaseCapture(this.#deps.containerEl, this.#dragging);
    const key = this.#selectedKey();
    const store = this.#deps.surfaceState;
    const settle = () => (key === null ? undefined : this.#settle(key));
    // A text range's last proposal may still be on its way from the document.
    const adjust = selectAdjust(store.getState());
    if (isRangeGrip(adjust?.grip ?? "body")) {
      this.#adjusting = this.#ranging.then(settle);
      return;
    }
    // A free-text box whose side was dragged is sized to its text once more.
    const record = this.#record();
    const page =
      record &&
      isEditablePosition(record.position) &&
      this.#deps.pageAt(record.position.pageIndex);
    if (adjust?.phase === "dragging" && record && page) {
      moveAdjust(
        store,
        releasedPosition({
          proposal: adjust.proposal,
          grip: adjust.grip,
          viewBox: page.viewport.viewBox,
          text: this.#textContent(record),
        }),
      );
    }
    const saving = settle();
    if (saving) this.#adjusting = saving;
  }

  /**
   * Ends the adjustment and saves its proposal, unless it changed nothing.
   *
   * @returns the save, or `undefined` where nothing is written.
   */
  #settle(key: string): Promise<void> | undefined {
    const store = this.#deps.surfaceState;
    const text = selectAdjust(store.getState())?.text;
    const proposal = endAdjust(store);
    return proposal ? this.#saveGeometry(key, proposal, text) : undefined;
  }

  #cancelDrag(): void {
    this.#dragging = releaseCapture(this.#deps.containerEl, this.#dragging);
    this.#rangeAsk++;
    cancelAdjust(this.#deps.surfaceState);
  }

  /**
   * Saves a released proposal with the Sort Index recomputed from it. The mark
   * draws the proposal until the write settles: a saved one then draws the
   * record Zotero answered, and any other snaps back to the confirmed record,
   * with a failure told at the notice seam.
   */
  async #saveGeometry(
    key: string,
    proposal: EditablePosition,
    text?: string,
  ): Promise<void> {
    const store = this.#deps.surfaceState;
    const end = () => {
      if (selectAdjust(store.getState())?.proposal === proposal)
        cancelAdjust(store);
    };
    // The capability can lapse while the pointer is down.
    if (!this.#live()) {
      end();
      this.#deps.gestures.reportBlockedGesture();
      return;
    }
    const sortIndex = await this.#deps.sortIndex(proposal);
    if (sortIndex === null) {
      end();
      return;
    }
    const outcome = this.#deps.annotations.patchGeometry(key, {
      position: proposal,
      sortIndex,
      ...(text !== undefined && { text }),
    });
    this.#write(outcome, (failure, now) =>
      m.pdf_adjust_failed({ reason: writeFailureReason(failure, now) }),
    );
    if ((await outcome).kind === "idle") await this.#deps.refreshed();
    end();
  }

  /**
   * A press outside the reader and outside the popup stands the selection down.
   * The press that opens the popup lands inside the reader, so it is never one
   * of these.
   */
  #outsidePress(event: PointerEvent): void {
    if (this.#selectedKey() === null) return;
    const target = event.target as Node | null;
    if (this.#deps.containerEl.contains(target)) return;
    if (this.#deps.popup.contains(target)) return;
    this.#apply(null);
  }

  /**
   * The popup's content in selected mode, for the popup host: the row, with the
   * comment editor under it while it is open. The editor is built into an
   * empty content element only; a refresh redraws the row and patches the
   * editor's controls, leaving its caret alone.
   */
  renderPopup(content: HTMLElement): void {
    const input = selectSelectedRowInput(this.#state());
    if (!input) return;
    if (input.commenting && content.firstChild && this.#commentEditor) {
      if (this.#row) this.#renderVerbs(this.#row, input);
      this.#updateCommentControls();
      return;
    }
    this.#closeCommentEditor();
    const column = this.#renderRow(content, input);
    if (input.commenting) this.#renderCommentEditor(column, input);
  }

  #renderVerbs(row: HTMLElement, input: MarkPopupRowInput): void {
    renderMarkPopupRow(row, markPopupRow(input), (id, node) =>
      this.#activate(id, node, input.annotation),
    );
  }

  /** @returns the column the row stands in, which the editor joins. */
  #renderRow(content: HTMLElement, input: MarkPopupRowInput): HTMLElement {
    const { annotation, mutation } = input;
    const { column, row } = popupColumn(content);
    this.#row = row;
    this.#renderVerbs(row, input);
    // The open editor is where the draft stands, so neither panel repeats it.
    if (input.commenting) return column;
    // The popup announces a held draft on the same rule the card does, and
    // carries the same verbs: the two surfaces reach one shared draft, so a
    // decision offered on one is offered on the other.
    const held = heldCommentDraft(
      this.#capability(),
      this.#deps.annotations.commentDraftFor(annotation.key),
      input.now,
    );
    if (held) {
      renderHeldDraftPanel(column.createDiv(), held, {
        surface: "popup",
        actions: this.#draftActions(annotation),
        onOpen: () => this.#toggleComment(annotation),
      });
    }
    if (
      mutation.kind === "conflict" &&
      mutation.conflict.write === "comment" &&
      this.#deps.annotations.commentDraftFor(annotation.key)
    ) {
      renderConflictPanel(
        column.createDiv(),
        conflictPanel(mutation.conflict),
        {
          surface: "popup",
          live: editingLive(this.#capability()),
          actions: this.#draftActions(annotation),
        },
      );
    }
    return column;
  }

  /** The panels' verbs, bound to the repository's own writes. */
  #draftActions(annotation: AnnotationRecord): CommentDraftActions {
    const { annotations, gestures } = this.#deps;
    const discard = () => annotations.discardCommentDraft(annotation.key);
    return {
      save: () => this.#write(annotations.submitComment(annotation.key)),
      allowEditing: () => gestures.allowEditing(),
      discard,
      applyAgain: () =>
        this.#write(annotations.retryCommentDraft(annotation.key)),
      discardConflict: discard,
    };
  }

  #renderCommentEditor(column: HTMLElement, input: MarkPopupRowInput): void {
    const { annotation } = input;
    const draft =
      selectSelectedDraft(this.#state()) ??
      this.#deps.annotations.editComment(annotation.key);
    if (!draft) {
      // Closed in the state too, so a later refresh does not try again.
      setCommenting(this.#deps.surfaceState, false);
      return;
    }
    const close = (): void => {
      this.#submitCommentEditor(annotation, true);
      setCommenting(this.#deps.surfaceState, false);
    };
    this.#commentEditor = renderCommentSheet(
      column.createDiv(),
      {
        app: this.#deps.app,
        surface: "popup",
        value: draft.text,
        onChange: (text) =>
          this.#deps.annotations.editComment(annotation.key, text),
        onSubmit: () => this.#submitCommentEditor(annotation),
        onSave: () => this.#submitCommentEditor(annotation),
        onCancel: close,
        onLeave: close,
        // The row's own verbs stand beside the editor, so reaching one is not
        // leaving it.
        within: column,
      },
      this.#commentControls(annotation),
    );
  }

  #commentControls(annotation: AnnotationRecord) {
    return commentEditorControls(
      this.#capability(),
      this.#deps.annotations.commentDraftFor(annotation.key),
      this.#state().capabilityAt,
    );
  }

  #updateCommentControls(): void {
    const annotation = this.#record();
    if (!annotation) return;
    this.#commentEditor?.update(this.#commentControls(annotation));
  }

  #submitCommentEditor(annotation: AnnotationRecord, automatic = false): void {
    const editor = this.#commentEditor;
    if (!editor) return;
    this.#deps.annotations.editComment(annotation.key, editor.text());
    this.#write(
      this.#deps.annotations.submitComment(annotation.key, { automatic }),
    );
  }

  #submitAndCloseCommentEditor(): void {
    const annotation = this.#record();
    if (annotation && this.#commentEditor) {
      this.#submitCommentEditor(annotation, true);
    }
    this.#closeCommentEditor();
  }

  #closeCommentEditor(): void {
    this.#commentEditor?.[Symbol.dispose]();
    this.#commentEditor = null;
  }

  /**
   * Takes the shared draft into the open editor, keeping the caret, so the
   * Annotation View and the popup edit one draft.
   */
  #patchEditor(draft: CommentDraft | null): void {
    const editor = this.#commentEditor;
    if (!editor) return;
    this.#updateCommentControls();
    if (draft) editor.editor.setText(draft.text);
  }

  #activate(
    id: MarkPopupControlId,
    node: HTMLElement,
    annotation: AnnotationRecord,
  ): void {
    const { annotations, gestures } = this.#deps;
    switch (id) {
      case "color":
        showMenuAtButton(
          colorMenu(annotation.color, (hex) =>
            this.#recolor(annotation.key, hex),
          ),
          node,
        );
        return;
      case "comment":
        this.#toggleComment(annotation);
        return;
      case "copy":
        if (annotation.text === null) return;
        void toast.promise(navigator.clipboard.writeText(annotation.text), {
          success: m.annot_view_copied_text(),
          error: m.annot_view_copy_failed(),
        });
        return;
      case "delete":
        this.#write(annotations.deleteAnnotation(annotation.key));
        return;
      case "reveal":
        gestures.revealAnnotation(annotation.key, { comment: false });
        return;
      case "stack":
        this.#step();
        return;
    }
  }

  /** The comment verb is a toggle: pressed again, it stores and closes. */
  #toggleComment(annotation: AnnotationRecord): void {
    if (this.#commentEditor) {
      this.#submitCommentEditor(annotation, true);
      setCommenting(this.#deps.surfaceState, false);
    } else if (this.#deps.annotations.editComment(annotation.key)) {
      setCommenting(this.#deps.surfaceState, true);
    }
  }

  #recolor(key: string, color: string): void {
    recordColorUse(this.#deps.surfaceState, this.#deps.colors, color);
    this.#write(this.#deps.annotations.patchColor(key, color));
  }

  /** Forward through the stack under the last click, wrapping at its end. */
  #step(): void {
    stepStack(this.#deps.surfaceState);
  }

  /**
   * The seam a write's outcome is rendered at: the repository answers data and
   * the notice is raised here, once, naming the reason. Nothing was drawn ahead
   * of Zotero, so a failure needs no undo.
   *
   * @param message the notice for a failure; a Geometry Edit names itself.
   * @see apps/obsidian/policies/ui-seams.md
   */
  #write(
    outcome: Promise<MutationState>,
    message: (
      failure: WriteFailure,
      now: Temporal.Instant,
    ) => string = writeFailureMessage,
  ): void {
    void outcome.then((state) => {
      if (state.kind !== "failed") return;
      new BaseNotice(message(state.failure, this.#deps.now()));
    });
  }

  #live(): boolean {
    return editingLive(this.#capability());
  }

  #capability(): EditingCapability {
    return this.#state().capability;
  }

  #state(): ReaderSurfaceState {
    return this.#deps.surfaceState.getState();
  }

  #selectedKey(): string | null {
    return selectSelectedKey(this.#state());
  }

  #record(): AnnotationRecord | null {
    return selectSelectedRowInput(this.#state())?.annotation ?? null;
  }

  /** Whether an Annotation Mark lies under a press. */
  #onMark(event: PointerEvent): boolean {
    const page = this.#pageUnder({ x: event.clientX, y: event.clientY });
    return page !== null && marksAtPoint(page.targets, page.at).length > 0;
  }

  /** What is selected now, and where the click that selected it fell. */
  #previous(): MarkSelectionPoint | null {
    const key = this.#selectedKey();
    return key !== null && this.#at !== null ? { key, ...this.#at } : null;
  }

  /** The page with marks under a client point, and where the point fell on it. */
  #pageUnder(client: Point): HitPage | null {
    for (const [index, annotations] of this.#deps.marks()) {
      const page = this.#deps.pageAt(index);
      if (!page) continue;
      const at = pagePointOf(pageBoxOf(page), client);
      if (at) return { index, targets: markTargets(page, annotations), at };
    }
    return null;
  }

  /**
   * Where the popup hangs, for the popup host: the bottom centre of the
   * selected mark's union rect, recomputed from the page as it stands now — a
   * page re-render can wipe the mark while the popup is open. `null` once the
   * mark is off screen, which hides the popup and keeps the selection.
   */
  anchor(): Point | null {
    const key = this.#selectedKey();
    if (key === null) return null;
    for (const [index, annotations] of this.#deps.marks()) {
      const drawn = annotations.filter(
        ({ annotation }) => annotation.key === key,
      );
      const page = drawn.length === 0 ? null : this.#deps.pageAt(index);
      if (!page) continue;
      const [target] = markTargets(page, drawn);
      const point = target && markAnchor(target.rects, pageBoxOf(page));
      if (point && onScreen(this.#deps.containerEl, point)) return point;
    }
    return null;
  }
}

/** The arrow keys, by the way they point on the page. */
const ARROWS: Partial<Record<string, Arrow>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

/** The position a highlight's or underline's placed range stores. */
function rectsPositionOf(selected: SelectedText): EditablePosition {
  return {
    kind: "pdf-rects",
    pageIndex: selected.pageIndex,
    rects: selected.rects.map(([x1, y1, x2, y2]) => [x1, y1, x2, y2]),
    ...(selected.nextPageRects && {
      nextPageRects: selected.nextPageRects.map(([x1, y1, x2, y2]) => [
        x1,
        y1,
        x2,
        y2,
      ]),
    }),
  };
}

/** How far a client point lies outside a page's drawn box; `0` inside it. */
function boxDistance(box: PageBox, { x, y }: Point): number {
  const dx = Math.max(box.left - x, 0, x - (box.left + box.width));
  const dy = Math.max(box.top - y, 0, y - (box.top + box.height));
  return Math.hypot(dx, dy);
}

/**
 * Whether the PDF's own link annotation is under the gesture. A link wins a
 * plain click, because "follow the reference" is the reader's contract; the
 * mark beneath it is still reached with `Alt`, and through the stack stepper.
 */
function linkUnder(target: EventTarget | null): boolean {
  const node = target as Node | null;
  const element = node?.instanceOf(HTMLElement)
    ? node
    : (node?.parentElement ?? null);
  return element?.closest("a[href], .linkAnnotation") != null;
}
