// The selected Annotation Mark of one PDF view: the gesture that picks it, the
// keys that walk and edit it, and the Mark Popup that hangs over it.
//
// Marks take no pointer input, so every gesture here is answered from geometry
// and nothing is hung on a mark's own node. Click-away belongs to this hit test
// rather than to the popup: the press that opens the popup is not an outside
// press, and this is the only thing that hides it. A surface outside the reader
// that drives the selection, such as the Annotation View, is not outside either:
// its own gesture says what the selection becomes.
//
// @see apps/obsidian/docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md
// @see apps/obsidian/docs/adr/0065-the-mark-popup-is-one-preact-root-on-obsidians-popover.md
// @see https://github.com/aidenlx/zotlit/issues/1148
import type { App } from "obsidian";
import { Keymap } from "obsidian";
import { createElement } from "react";
import type { ReactNode, RefObject } from "react";

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
import type { EditingCapability } from "@/services/annotation-repository/capability";
import {
  firstLockRefusal,
  lockBlock,
} from "@/services/annotation-repository/lock";
import type {
  LockBlock,
  LockedVerb,
} from "@/services/annotation-repository/lock";
import type {
  AnnotationRecord,
  AnnotationRepository,
  GeometryInput,
} from "@/services/annotation-repository/service";
import {
  writeFailureMessage,
  writeFailureReason,
} from "@/services/annotation-repository/write";
import type {
  MutationState,
  WriteFailure,
} from "@/services/annotation-repository/write";
import type { ReaderSessionHost } from "@/services/reader-session/session";
import {
  fieldEditorControls,
  editingLive,
  heldTagDraft,
  heldTextDraft,
  pressControl,
  shownComment,
  tagEditorControls,
  textFieldWording,
} from "@/views/annot-view/card-controls";
import type { CardBlock, CardControl } from "@/views/annot-view/card-controls";
import { sameKeys } from "@/views/annot-view/card-selection";
import {
  confirmDelete,
  erase,
  copyText,
  recolor,
} from "@/views/annot-view/card-verbs";
import { controlEntry } from "@/views/annot-view/comment-parts";
import type { CommentRenderer } from "@/views/annot-view/comment-render";
import type {
  CaretPoint,
  TextDraftActions,
  EditorSheet,
  HeldDraftActions,
} from "@/views/annot-view/editor-sheet";
import type { EndTagSession } from "@/views/annot-view/tag-editor";

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
import { markPopupRow, SelectedMarkPopup } from "./mark-popup";
import type {
  MarkPopupControlId,
  MarkPopupRowInput,
  SelectedMarkPopupProps,
  SelectedPopupComment,
} from "./mark-popup";
import type { MarkPopupHost } from "./mark-popup-host";
import { tagSectionShows } from "./mark-popup-tags";
import type { MarkPopupTagSectionProps } from "./mark-popup-tags";
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
  selectMarkHandles,
  selectGroup,
  selectSelectedDraft,
  selectSelectedKey,
  selectSelectedKeys,
  selectSelectedTagDraft,
  recordColorUse,
  setCommenting,
  setTagging,
  stepStack,
} from "./reader-surface-state";
import type {
  ReaderSurfaceState,
  ReaderSurfaceStore,
  SelectedRowInput,
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
  | "textDraftFor"
  | "deleteAnnotation"
  | "deleteAnnotations"
  | "discardTextDraft"
  | "discardTagDraft"
  | "editTextField"
  | "editTags"
  | "patchColor"
  | "patchColors"
  | "patchGeometry"
  | "retryTextDraft"
  | "submitTextField"
  | "submitTags"
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
   * Bring this Annotation's card forward in the Annotation View. The popup
   * edits the comment in place, so the card's editors stay as they are.
   */
  revealAnnotation: (annotationKey: string) => void;
  /**
   * An edit gesture met a block on this Attachment. The seam probes Zotero and
   * says why, once per reason per capability episode.
   */
  reportBlockedGesture: () => void;
  /**
   * A press on a control the Editing Capability blocks, such as the comment
   * field: the seam says why on every press, and offers the gesture that
   * ends the block where there is one, as the card's own blocked press does.
   */
  blockedPress: (block: CardBlock) => void;
  /**
   * Open the "Zotero editing" settings row, whose Allow editing asks Zotero,
   * from the held-draft panel's "Allow editing".
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
  /** Renders a stored comment as the Annotation Card does. */
  renderComment: CommentRenderer;
  /** The tag names of an Annotation's Library, which the tag editor suggests. */
  libraryTagNames: (annotationKey: string) => readonly string[];
  /**
   * The one popup of this view: a press inside it leaves the selection
   * standing, and a scroll re-hangs it.
   */
  popup: Pick<MarkPopupHost, "contains" | "sync">;
  /**
   * The surfaces outside the reader that drive this selection: a press inside
   * one leaves the selection standing too.
   */
  selectionSurfaces: Pick<ReaderSessionHost, "onSelectionSurface">;
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
  /** The popup's comment editor, while it stands. */
  readonly #sheet: RefObject<EditorSheet | null> = { current: null };
  /** Where the click that opened the comment editor landed, until it mounts. */
  #caretAt: CaretPoint | undefined;
  /** The popup's tag section, while it stands. */
  readonly #tagSection: RefObject<HTMLDivElement | null> = { current: null };
  /** The open tag editor's own end of its session. */
  readonly #endSession: RefObject<EndTagSession | null> = { current: null };
  /** The tag editor's suggestion popup while it shows, outside the popup. */
  readonly #suggest: RefObject<HTMLElement | null> = { current: null };
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

  /** The Indexed Keys the overlay draws as selected: one mark, or a group. */
  get selected(): ReadonlySet<string> {
    return new Set(this.#selectedKeys());
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
          this.#selectedKeys().length > 0 &&
          !selectionCollapsed(this.#deps.containerEl)
        )
          this.#apply(null);
        this.#deps.creation?.changed();
      }),
    );
    const state = this.#deps.surfaceState;
    this.#surfaces.defer(
      state.subscribe(
        selectSelectedKeys,
        (keys) => {
          this.#deps.repaint();
          this.#deps.report(keys);
        },
        { equalityFn: sameKeys },
      ),
    );
    // The editor goes with the episode it was opened for: a closed editor, a
    // stepped or dropped selection, and a hidden or conflicting draft alike.
    // A tag editing session is saved as it ends, however it ends.
    this.#surfaces.defer(
      state.subscribe(
        selectFloatingHead,
        (head, previous) => {
          const { kind, commenting } = head;
          if (kind !== "selected" || !commenting) this.#closeCommentEditor();
          if (!previous.tagging || previous.key === null) return;
          if (head.tagging && head.key === previous.key) return;
          // The editor adds the text still typed before the save reads it.
          this.#endTags();
          this.#submitTags(previous.key);
        },
        { equalityFn: sameFlat },
      ),
    );
  }

  /**
   * Take this Annotation as the selection, from outside a mark click: a Mark
   * Landing, a mark just created, or {@link selectMarks} with one mark. The
   * Annotation View's cards enter through {@link selectMarks}.
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

  /**
   * Take these Annotations as the selection, from the Annotation View's Card
   * Selection. The reader takes it quietly: one mark opens no Mark Popup, and
   * several are a group, painted with no popup and no Mark Handles.
   */
  selectMarks(annotationKeys: readonly string[]): void {
    if (annotationKeys.length < 2) {
      this.select(annotationKeys[0] ?? null, { popup: false });
      return;
    }
    this.#submitAndCloseCommentEditor();
    this.#at = null;
    selectGroup(this.#deps.surfaceState, annotationKeys);
  }

  [Symbol.dispose](): void {
    this.#submitAndCloseCommentEditor();
    this.#endTagSession();
    this.#surfaces.dispose();
    if (this.#selectedKeys().length > 0)
      selectMark(this.#deps.surfaceState, null);
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
        if (this.#selectedKeys().length > 0) this.#apply(null);
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
   * after. An open tag editor closes alone, as Escape inside it does, though
   * focus stands on a chip's remove button or a verb beside it.
   *
   * @returns whether a mark, or a group, was selected to step back from.
   */
  escape(): boolean {
    if (this.#selectedKeys().length === 0) return false;
    if (selectFloatingHead(this.#state()).tagging && this.#endTags(false))
      return true;
    if (this.#dragging) this.#cancelDrag();
    else this.#apply(null);
    return true;
  }

  /**
   * Cmd/Ctrl+C on the selected mark or group: its text, by the Annotation
   * View's rule. A text selection in the PDF is the platform's to copy.
   *
   * @returns whether the selection had text to copy.
   */
  copy(): boolean {
    const selected = this.#selectedKeys();
    if (selected.length === 0 || !selectionCollapsed(this.#deps.containerEl))
      return false;
    const records = new Map(
      this.#deps.records().map((record) => [record.key, record]),
    );
    return copyText(selected.flatMap((key) => records.get(key) ?? []));
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
      // A group reduces to one mark, walking from its first in reading order.
      const order = readingOrder(this.#deps.records());
      const selected = this.#selectedKeys();
      const next = stepReadingOrder(
        order,
        order.find((key) => selected.includes(key)) ?? null,
        walk,
      );
      if (next === null) return;
      event.preventDefault();
      this.#apply(next);
      this.#deps.navigate(next);
      return;
    }
    // The Mac keyboards that print "delete" on the backspace key send
    // `Backspace`, so both reach the same verb. It erases every selected mark.
    // A delete of one mark keeps its behaviour in the PDF: it asks nothing. A
    // group asks once and names its count, as the Annotation View does.
    if (event.key === "Delete" || event.key === "Backspace") {
      const selected = this.#selectedKeys();
      if (selected.length === 0) return;
      event.preventDefault();
      if (!this.#live()) {
        this.#deps.gestures.reportBlockedGesture();
        return;
      }
      const locked = this.#lockOn(selected, "delete");
      if (locked) this.#deps.gestures.blockedPress(locked);
      else if (selected.length === 1) this.#erase(selected);
      else
        void confirmDelete(this.#deps.app, this.#deps.annotations, {
          annotationKeys: selected,
          now: () => this.#deps.now(),
        });
      return;
    }
    const selected = this.#selectedKeys();
    if (selected.length === 0) return;
    // `1`–`8` are the palette's own order, so the key and the swatch can never
    // name different colours. It recolours every selected mark.
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
        const locked = this.#lockOn(selected, "color");
        if (locked) this.#deps.gestures.blockedPress(locked);
        else this.#recolor(selected, swatch);
      }
      return;
    }
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
    if (this.#dragging || selectAdjust(this.#state())) return true;
    event.preventDefault();
    // The Editing Capability's block comes first, as it does for Delete.
    if (!this.#live()) {
      this.#deps.gestures.reportBlockedGesture();
      return true;
    }
    const locked = lockBlock(record.lock, "geometry");
    if (locked) {
      this.#deps.gestures.blockedPress(locked);
      return true;
    }
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
          return this.#settle(record.key, "keyboard");
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
    const saving = this.#settle(record.key, "keyboard");
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
    // A Locked Annotation has no Mark Handles, and its body moves by none.
    if (!selectMarkHandles(state)) return;
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
    const settle = () =>
      key === null ? undefined : this.#settle(key, "pointer");
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
   * @param input what made the edit, which the Annotation History groups a run
   *   of keyboard edits by.
   * @returns the save, or `undefined` where nothing is written.
   */
  #settle(key: string, input: GeometryInput): Promise<void> | undefined {
    const store = this.#deps.surfaceState;
    const text = selectAdjust(store.getState())?.text;
    const proposal = endAdjust(store);
    return proposal
      ? this.#saveGeometry(key, proposal, { text, input })
      : undefined;
  }

  #cancelDrag(): void {
    this.#dragging = releaseCapture(this.#deps.containerEl, this.#dragging);
    this.#rangeAsk++;
    cancelAdjust(this.#deps.surfaceState);
  }

  /**
   * Saves a released proposal with the Sort Index recomputed from it. The mark
   * draws the proposal while that index is computed; from the write on, the
   * repository's Pending Proposal stands in its place until the write
   * settles: a saved one then draws the record Zotero answered, and any other
   * snaps back to the confirmed record, with a failure told at the notice
   * seam.
   */
  async #saveGeometry(
    key: string,
    proposal: EditablePosition,
    { text, input }: { text?: string; input: GeometryInput },
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
    const outcome = this.#deps.annotations.patchGeometry(
      key,
      {
        position: proposal,
        sortIndex,
        ...(text !== undefined && { text }),
      },
      input,
    );
    // The write's proposal is drawn from here on.
    end();
    // A lock says its own reason alone, as it does on every other surface.
    this.#write(outcome, (failure, now) =>
      failure.kind === "locked"
        ? writeFailureMessage(failure, now)
        : m.pdf_adjust_failed({ reason: writeFailureReason(failure, now) }),
    );
  }

  /**
   * A press outside the reader, the popup and every surface that drives the
   * selection stands the selection down. The press that opens the popup lands
   * inside the reader, so it is never one of these.
   */
  #outsidePress(event: PointerEvent): void {
    if (this.#selectedKeys().length === 0) return;
    const target = event.target as Node | null;
    if (this.#deps.containerEl.contains(target)) return;
    if (this.#deps.popup.contains(target)) return;
    // The tag editor's suggestion popup hangs outside the Mark Popup.
    if (this.#tagsContain(target)) return;
    if (this.#deps.selectionSurfaces.onSelectionSurface(target)) return;
    this.#apply(null);
  }

  /**
   * The popup's content in selected mode, for the popup host: the row, then
   * the comment in one of its states, a Write Conflict, and the tag section.
   *
   * @param content the popup's content element, which focus may move within
   *   without leaving an editor.
   */
  popupView(content: HTMLElement): ReactNode | undefined {
    const input = selectSelectedRowInput(this.#state());
    if (!input) return undefined;
    const { annotation } = input;
    const row = markPopupRow(input);
    return createElement(SelectedMarkPopup, {
      app: this.#deps.app,
      row,
      activate: (id, node) => this.#activate(id, node, annotation),
      comment: this.#commentSlot(content, input, row.comment),
      conflict: this.#conflictSlot(input),
      tags: this.#tagSlot(content, input),
    });
  }

  /**
   * The tag section under the comment: the tags read-only, or the tag editor
   * in their place, while it stands.
   */
  #tagSlot(
    content: HTMLElement,
    input: MarkPopupRowInput,
  ): MarkPopupTagSectionProps | null {
    const { annotation, tagging } = input;
    const draft = selectSelectedTagDraft(this.#state());
    const block = input.blocks.tags;
    const { readOnly, hint } = tagEditorControls(block, draft, input.now);
    const held = heldTagDraft(block, draft, input.now);
    if (!tagSectionShows({ annotation, draft, tagging, held })) return null;
    const { annotations, surfaceState } = this.#deps;
    return {
      sectionRef: this.#tagSection,
      endSession: this.#endSession,
      suggestRef: this.#suggest,
      annotation,
      draft,
      tagging,
      readOnly,
      hint,
      held,
      heldActions: this.#heldTagsActions(annotation),
      libraryNames: () => this.#deps.libraryTagNames(annotation.key),
      onChange: (names) => {
        // A change that lands once no session stands and its draft is gone —
        // a database switch hid it, or its save already settled — would start
        // a session that nothing saves.
        const state = this.#state();
        if (
          !selectFloatingHead(state).tagging &&
          !state.tagDrafts.has(annotation.key)
        )
          return;
        annotations.editTags(annotation.key, names);
      },
      onClose: () => setTagging(surfaceState, false),
      within: content,
    };
  }

  /**
   * Whether a node belongs to the tag section: one inside it, or inside the
   * editor's suggestion popup, which hangs outside it.
   */
  #tagsContain(node: Node | null): boolean {
    return (
      (this.#tagSection.current?.contains(node) ?? false) ||
      (this.#suggest.current?.contains(node) ?? false)
    );
  }

  /**
   * Ends the open tag editor's session as the editor itself would; nothing
   * while no editor is open.
   *
   * @param withText whether the text still typed is added first, as focus
   *   leaving adds it; Escape leaves it out.
   * @returns whether an editor was open to end.
   */
  #endTags(withText = true): boolean {
    const end = this.#endSession.current;
    end?.(withText);
    return end !== null;
  }

  /**
   * Save the tag editing session that just ended on one Annotation, or hold
   * it where it needs Save tags.
   */
  #submitTags(annotationKey: string): void {
    this.#write(
      this.#deps.annotations.submitTags(annotationKey, { automatic: true }),
    );
  }

  /**
   * What stands in the comment's place: the open editor, a held draft, or
   * the comment field, resting on the stored comment or on "Add a comment…".
   * The open editor is where the draft stands, so neither panel repeats it.
   */
  #commentSlot(
    content: HTMLElement,
    input: SelectedRowInput,
    control: CardControl,
  ): SelectedPopupComment {
    const { annotation } = input;
    const sheet = input.commenting
      ? this.#commentEditorSlot(content, input)
      : null;
    if (sheet) return sheet;
    const entry = controlEntry(control, (at) =>
      this.#pressComment(annotation, control, at),
    );
    // The popup announces a held draft on the same rule the card does, and
    // carries the same verbs: the two surfaces reach one shared draft, so a
    // decision offered on one is offered on the other. Like the card, it
    // shows the held draft in the stored comment's place.
    const held = heldTextDraft(
      "comment",
      this.#deps.annotations.textDraftFor("comment", annotation.key),
      { block: input.blocks.comment, now: input.now },
    );
    if (held) {
      return {
        kind: "held",
        held,
        actions: this.#draftActions(annotation),
        entry,
      };
    }
    return {
      kind: "view",
      html: annotation.comment,
      render: this.#deps.renderComment,
      entry,
    };
  }

  /**
   * A press on the resting comment, on the card's own rule: a write in flight
   * refuses it, a blocked capability spends it on the notice that states the
   * reason, and otherwise it opens the editor.
   */
  #pressComment(
    annotation: AnnotationRecord,
    control: CardControl,
    caretAt?: CaretPoint,
  ): void {
    pressControl(control, {
      act: () => this.#openComment(annotation, caretAt),
      onBlocked: (block) => this.#deps.gestures.blockedPress(block),
    });
  }

  /**
   * A Write Conflict on the comment, while no editor is open. It is read from
   * the comment draft alone, as the card reads it, so a later write on
   * another field leaves it standing.
   */
  #conflictSlot(input: SelectedRowInput): SelectedMarkPopupProps["conflict"] {
    const { annotation } = input;
    const draft = this.#deps.annotations.textDraftFor(
      "comment",
      annotation.key,
    );
    if (input.commenting || draft?.state.kind !== "conflict") return null;
    return {
      conflict: {
        write: "comment",
        attempted: draft.text,
        fresh: draft.state.fresh,
      },
      block: input.blocks.comment,
      actions: this.#draftActions(annotation),
    };
  }

  /** The panels' verbs, bound to the repository's own writes. */
  #draftActions(annotation: AnnotationRecord): TextDraftActions {
    const { annotations, gestures } = this.#deps;
    const discard = () =>
      annotations.discardTextDraft("comment", annotation.key);
    return {
      save: () =>
        this.#write(annotations.submitTextField("comment", annotation.key)),
      allowEditing: () => gestures.allowEditing(),
      discard,
      applyAgain: () =>
        this.#write(annotations.retryTextDraft("comment", annotation.key)),
      discardConflict: discard,
    };
  }

  /** The held tags panel's verbs, bound to the repository's own writes. */
  #heldTagsActions(annotation: AnnotationRecord): HeldDraftActions {
    const { annotations, gestures } = this.#deps;
    return {
      // Save tags is the explicit save, never the editor's automatic one.
      save: () => this.#write(annotations.submitTags(annotation.key)),
      allowEditing: () => gestures.allowEditing(),
      discard: () => annotations.discardTagDraft(annotation.key),
    };
  }

  /**
   * The comment editor, opened on the shared draft, which it takes in as the
   * draft changes so the Annotation View and the popup edit one draft. The
   * draft is started as the editor opens; an open editor stays through a
   * draft that settles.
   */
  #commentEditorSlot(
    content: HTMLElement,
    input: SelectedRowInput,
  ): SelectedPopupComment | null {
    const { annotation } = input;
    const standing = selectSelectedDraft(this.#state());
    const draft =
      standing ??
      (this.#sheet.current
        ? null
        : this.#deps.annotations.editTextField("comment", annotation.key));
    if (!draft && !this.#sheet.current) {
      // Closed in the state too, so a later refresh does not try again.
      setCommenting(this.#deps.surfaceState, false);
      return null;
    }
    const close = (): void => {
      this.#submitCommentEditor(annotation, true);
      setCommenting(this.#deps.surfaceState, false);
    };
    // The sheet places the caret once, as it mounts; a later mount opens at
    // the end.
    const caretAt = this.#caretAt;
    this.#caretAt = undefined;
    return {
      kind: "sheet",
      sheet: {
        sheetRef: this.#sheet,
        field: textFieldWording("comment"),
        value: shownComment(annotation, draft),
        text: standing?.text,
        status: this.#commentControls(input),
        onChange: (text) =>
          this.#deps.annotations.editTextField("comment", annotation.key, text),
        onSubmit: () => this.#submitCommentEditor(annotation),
        onSave: () => this.#submitCommentEditor(annotation),
        onCancel: close,
        onLeave: close,
        // The row's own verbs stand beside the editor, so reaching one is not
        // leaving it.
        within: content,
        caretAt,
      },
    };
  }

  #commentControls({ annotation, blocks, now }: SelectedRowInput) {
    return fieldEditorControls(
      blocks.comment,
      this.#deps.annotations.textDraftFor("comment", annotation.key),
      now,
    );
  }

  #submitCommentEditor(annotation: AnnotationRecord, automatic = false): void {
    const editor = this.#sheet.current;
    if (!editor) return;
    this.#deps.annotations.editTextField(
      "comment",
      annotation.key,
      editor.text(),
    );
    this.#write(
      this.#deps.annotations.submitTextField("comment", annotation.key, {
        automatic,
      }),
    );
  }

  #submitAndCloseCommentEditor(): void {
    const annotation = this.#record();
    if (annotation && this.#sheet.current) {
      this.#submitCommentEditor(annotation, true);
    }
    this.#closeCommentEditor();
  }

  /**
   * Lets go of the open editor, which leaves with the popup's next render; a
   * store that reaches it before then finds no editor to read.
   */
  #closeCommentEditor(): void {
    this.#sheet.current = null;
  }

  #activate(
    id: MarkPopupControlId,
    node: HTMLElement,
    annotation: AnnotationRecord,
  ): void {
    const { gestures } = this.#deps;
    switch (id) {
      case "color":
        showMenuAtButton(
          colorMenu(annotation.color, (hex) =>
            this.#recolor([annotation.key], hex),
          ),
          node,
        );
        return;
      case "tags":
        this.#toggleTags(annotation);
        return;
      case "copy":
        copyText([annotation]);
        return;
      case "delete":
        this.#erase([annotation.key]);
        return;
      case "reveal":
        gestures.revealAnnotation(annotation.key);
        return;
      case "stack":
        this.#step();
        return;
    }
  }

  /** Opens the comment editor where a draft starts. */
  #openComment(annotation: AnnotationRecord, caretAt?: CaretPoint): void {
    this.#caretAt = caretAt;
    if (this.#deps.annotations.editTextField("comment", annotation.key))
      setCommenting(this.#deps.surfaceState, true);
  }

  /**
   * The tag verb is a toggle: pressed again, it ends the session, which saves
   * it. The tag editor opens in place of the comment editor, which stores what
   * it holds first.
   */
  #toggleTags(annotation: AnnotationRecord): void {
    if (selectFloatingHead(this.#state()).tagging) {
      this.#endTagSession();
      return;
    }
    if (!this.#deps.annotations.editTags(annotation.key)) return;
    this.#submitCommentEditor(annotation, true);
    setTagging(this.#deps.surfaceState, true);
  }

  /**
   * Closes the tag editor, which saves its session. The editor's own end adds
   * the typed text first; a popup that stands hidden has no editor to end.
   */
  #endTagSession(): void {
    if (!this.#endTags()) setTagging(this.#deps.surfaceState, false);
  }

  /**
   * Recolour one mark, or a group as one History Step, as the Annotation View
   * does.
   */
  #recolor(annotationKeys: readonly string[], color: string): void {
    recordColorUse(this.#deps.surfaceState, this.#deps.colors, color);
    void recolor(this.#deps.annotations, {
      annotationKeys,
      color,
      now: () => this.#deps.now(),
    });
  }

  /**
   * Erase these marks with no confirmation, through the verb the Annotation
   * View's delete settles through.
   */
  #erase(annotationKeys: readonly string[]): void {
    void erase(this.#deps.annotations, {
      annotationKeys,
      now: () => this.#deps.now(),
    });
  }

  /** Forward through the stack under the last click, wrapping at its end. */
  #step(): void {
    stepStack(this.#deps.surfaceState);
  }

  /**
   * The seam a write's outcome is rendered at: the repository answers data and
   * the notice is raised here, once, naming the reason. A failed write's
   * Pending Proposal goes with it, so a failure needs no undo here.
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

  /**
   * The block the lock puts on a keystroke's verb over the selected marks, or
   * `null` where it acts. A group verb is all or nothing, so the first mark
   * whose lock refuses the verb stops the press before a group delete asks
   * its confirmation. A press it refuses is spent on the notice that gives
   * that mark's Lock Reason, on every press.
   *
   * @param selected Indexed Keys, in the order the first is picked from.
   */
  #lockOn(
    selected: readonly string[],
    verb: Extract<LockedVerb, "color" | "delete">,
  ): LockBlock | null {
    const locks = new Map(
      this.#deps.records().map(({ key, lock }) => [key, lock]),
    );
    const refused = firstLockRefusal(
      selected,
      verb,
      (key) => locks.get(key) ?? null,
    );
    return refused && lockBlock(refused.lock, verb);
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

  #selectedKeys(): readonly string[] {
    return selectSelectedKeys(this.#state());
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
