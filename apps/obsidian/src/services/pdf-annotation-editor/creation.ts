// Creating a highlight or an underline from a text selection in Obsidian's PDF
// reader, a note or a Text Draft from a click on a page, and an image from a
// rectangle dragged on a page: the Creation Toolbar's defaults, the Mark Popup
// in create mode, the keys that commit without the mouse, and the one command
// that writes.
//
// Two speeds of one commit path. Nothing armed: a settled selection opens the
// popup and one click commits. A tool armed from the toolbar: the selection
// commits at once in that tool's colour and the popup reopens on the new mark.
// The armed note tool places a note at a click, opens it on its comment, and
// stands down. The armed text tool opens a Text Draft at a click and stands
// down; the draft is created once, with its text, when it is finished. The
// armed image tool takes a rectangle instead of a selection,
// and stands down once it has created one. The armed ink tool takes a freehand stroke,
// creates it in the background, and stays armed for the next one.
//
// @see https://github.com/aidenlx/zotlit/issues/1150
// @see https://github.com/aidenlx/zotlit/issues/1206
// @see https://github.com/aidenlx/zotlit/issues/1209
// @see https://github.com/aidenlx/zotlit/issues/1214
// @see https://github.com/aidenlx/zotlit/issues/1215
import { Platform } from "obsidian";
import type { App } from "obsidian";

import type { PdfTextStructure, SelectedText } from "@zotlit/pdf-structure";

import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import { registerDomEvent } from "@/lib/disposables";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { showMenuAtButton } from "@/lib/menu";
import { themeHook } from "@/lib/theme-hooks";
import * as toast from "@/lib/toast";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationRecord,
  AnnotationRepository,
} from "@/services/annotation-repository/service";
import {
  blockedReason,
  writeFailureReason,
} from "@/services/annotation-repository/write";
import type {
  InkPosition,
  TextPosition,
} from "@/services/annotation-repository/write";
import {
  commentEditorControls,
  editingLive,
} from "@/views/annot-view/card-controls";
import { renderCommentSheet } from "@/views/annot-view/comment-sheet";
import type {
  CommentSheet,
  CommentSheetStatus,
} from "@/views/annot-view/comment-sheet";

import { inTextEntry, isEditGesture } from "./capability-affordance";
import { createPopupRow, renderCreatePopupRow } from "./create-popup";
import type { CreatePopupAction } from "./create-popup";
import {
  removeCreationToolbar,
  renderCreationToolbar,
} from "./creation-toolbar";
import type {
  CreationToolbarControl,
  CreationToolbarNodes,
} from "./creation-toolbar";
import { captureRect } from "./geometry-edit";
import type { PdfPoint, PdfRect } from "./geometry-edit";
import { CLICK_SLOP, distance } from "./hit-test";
import type { Point } from "./hit-test";
import { InkStroke } from "./ink-stroke";
import { popupColumn } from "./mark-popup";
import type { MarkPopupHost } from "./mark-popup-host";
import {
  appendPendingStroke,
  arm,
  beginCapture,
  cancelCapture,
  captureSelection,
  clearFloating,
  dropPendingStroke,
  dropTextDraft,
  endCapture,
  finishTextDraft,
  moveCapture,
  openTextDraft,
  recordColorUse,
  refitTextDraft,
  selectCapture,
  selectCreateRowInput,
  sameFlatList,
  sameFlat,
  selectCreationToolbar,
  selectFloatingHead,
  setCommenting,
  setInFlight,
  selectTextDraft,
  settlePendingStroke,
  settleTextDraft,
  setToolColor,
  textDraftPosition,
  toggleMarks,
} from "./reader-surface-state";
import type {
  AnchorAt,
  Floating,
  PendingStroke,
  ReaderSurfaceState,
  ReaderSurfaceStore,
  TextDraft,
} from "./reader-surface-state";
import { interfaceFont } from "./render";
import type { OverlayPageView } from "./render";
import type { SelectOptions } from "./selection";
import { selectionPagesOf } from "./selection-capture";
import type { SelectionPage } from "./selection-capture";
import {
  addInkWidths,
  addTextFontSizes,
  colorMenu,
  onScreen,
  pageContentBox,
  pdfPointAt,
  selectionCollapsed,
  releaseCapture,
} from "./surface";
import {
  MARK_TOOLS,
  gestureOf,
  isClickTool,
  isSelectionTool,
  selectionToolOf,
} from "./tools";
import type {
  ClickTool,
  MarkTool,
  SelectionTool,
  ToolColorStore,
} from "./tools";

const logger = getLogger("pdf-annotation-editor");

/**
 * The side of the square a note is stored as, in PDF points: Zotero's.
 *
 * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/common/defines.js#L27
 */
const NOTE_SIZE = 22;

/**
 * Tells one Ink Stroke from every other, so the parts of one stroke share a
 * History Step and no two strokes ever do.
 *
 * The counter stands outside the surfaces, because an Annotation History is
 * one per Attachment and two PDF views of that Attachment write into it: a
 * serial kept per view would name the first stroke of each view alike, and one
 * undo press would take both strokes.
 */
let inkGroupSerial = 0;

/** The name the next Ink Stroke's creates are joined into one step by. */
function nextInkGroup(): string {
  inkGroupSerial += 1;
  return `ink-${inkGroupSerial}`;
}

/** A press the armed note or text tool holds until its release. */
interface ClickPress {
  pointerId: number;
  tool: ClickTool;
  pageIndex: number;
  /** The press point in PDF points, which the note or the box is placed at. */
  at: PdfPoint;
  /** The press point on screen, which the release's travel is measured from. */
  client: Point;
}

/** One page of the reader, as selection capture and the anchor read it. */
export interface ReaderPage {
  pageIndex: number;
  view: OverlayPageView;
}

/** What the creation surfaces write Annotations through. */
export type AnnotationCreates = Pick<AnnotationRepository, "createAnnotation">;

/**
 * The gestures the reader's own listeners hand to the creation surfaces. One
 * listener set serves both the selected mark and the fresh selection.
 */
export interface CreationGestures {
  /** A pointer went down anywhere in the reader's window. */
  press: (event: PointerEvent) => void;
  /** A pointer gesture ended, so the window selection is settled. */
  settle: () => void;
  /** The window selection changed. */
  changed: () => void;
  /** A keystroke the selected-mark keymap did not take. */
  key: (event: KeyboardEvent) => void;
  /**
   * A press in the reader that took no Mark Handle, which the armed note tool
   * may place a note from, the armed text tool open a Text Draft from, the
   * armed image tool begin a capture from, and the armed ink tool a stroke.
   *
   * @param options.onMark whether an Annotation Mark lies under the press,
   *   which keeps the press the mark's; asked only of a press the note, text
   *   or image tool could take. The ink tool draws over marks.
   */
  grab: (event: PointerEvent, options: { onMark: () => boolean }) => void;
  /** A pointer moved that no Geometry Edit holds. */
  move: (event: PointerEvent) => void;
  /** A pointer went up that no Geometry Edit holds. */
  release: (event: PointerEvent) => void;
  /** The browser took back a pointer that no Geometry Edit holds. */
  cancel: (event: PointerEvent) => void;
  /**
   * Whether an image capture or an ink stroke holds the pointer, so no text
   * is selected.
   */
  readonly capturing: boolean;
}

/** One Annotation as a gesture decided it, before the text structure placed it. */
interface MarkDraft {
  type: MarkTool;
  color: string;
  comment: string;
  /** The quoted text; empty for a note, free text, an image and ink. */
  text: string;
  position:
    | {
        pageIndex: number;
        rects: SelectedText["rects"];
        nextPageRects?: SelectedText["rects"];
      }
    | InkPosition
    | (TextPosition & { rects: SelectedText["rects"] });
}

/**
 * What a create does around its write, by the tool it creates for. A
 * foreground create holds the reader until Zotero answers — no second
 * selection, note, text or image create begins meanwhile — and takes the new
 * mark as the selection; an ink create runs in the background, selects
 * nothing, and leaves the tool armed. The note and image tools stand down once
 * they created, as Zotero's do; the text tool stood down when its draft
 * opened.
 */
const CREATE_EFFECTS: Record<
  MarkTool,
  { foreground: boolean; disarm: boolean }
> = {
  highlight: { foreground: true, disarm: false },
  underline: { foreground: true, disarm: false },
  note: { foreground: true, disarm: true },
  text: { foreground: true, disarm: false },
  image: { foreground: true, disarm: true },
  ink: { foreground: false, disarm: false },
};

export interface MarkCreationDeps {
  /** The app the comment sheet's editor takes its keys through. */
  app: App;
  /** The PDF view's container: what scrolls, and what the gestures come from. */
  containerEl: HTMLElement;
  /** The one popup of this view, which a press inside leaves standing. */
  popup: Pick<MarkPopupHost, "contains">;
  /** The Attachment the new Annotation hangs from, by Indexed Key. */
  attachmentKey: string;
  /** Every page the reader has built, in any order. */
  pages: () => readonly ReaderPage[];
  /** Every Annotation of this Attachment, for the Page Label alignment. */
  records: () => readonly AnnotationRecord[];
  /** This document's Structured Characters; `null` until the reader opened one. */
  structure: () => PdfTextStructure | null;
  /** Redraws the overlays after the mark visibility changed. */
  repaint: () => void;
  /**
   * Takes the new mark as the selection, so the popup reopens on it.
   *
   * @param options.commenting whether the popup opens on its comment editor.
   */
  reveal: (
    annotationKey: string,
    options?: Pick<SelectOptions, "commenting">,
  ) => void;
  /**
   * A press met a block on this Attachment. The seam probes Zotero and says
   * why, once per reason per capability episode.
   */
  reportBlockedGesture: () => void;
  /**
   * A create made nothing, for `reason`: the seam says why the Annotation was
   * not created.
   */
  reportCreateFailure: (reason: string) => void;
  /** Draws the Editing Capability affordance into the toolbar's own slot. */
  renderCapability: (slot: HTMLElement) => void;
  /** Hands the keyboard to the reader's pages. */
  focusReader: () => void;
  /**
   * Each tool's own colour, the ink tool's pen width and the text tool's font
   * size, which are kept across PDFs rather than per view.
   */
  colors: ToolColorStore;
  /** What this view's surfaces draw from; the toolbar redraws off it alone. */
  surfaceState: ReaderSurfaceStore;
  annotations: AnnotationCreates;
  now: () => Temporal.Instant;
}

/**
 * The creation surfaces of one PDF view: the Creation Toolbar that owns the
 * defaults, and the Mark Popup that owns the decision for one Annotation.
 */
export class MarkCreation implements CreationGestures, Disposable {
  readonly #deps;
  readonly #surfaces = new DisposableStack();
  /** The create-mode row the popup last built; `null` until one is. */
  #row: HTMLElement | null = null;
  /** The comment sheet, whose editor holds the comment until the save. */
  #sheet: CommentSheet | null = null;
  /**
   * Whether a selection, note, text or image create is waiting on Zotero, the
   * armed tool's among them, so a drag released meanwhile makes nothing. An
   * ink create holds nothing.
   */
  #writing = false;
  #creating: Promise<unknown> = Promise.resolve();
  #settling = Promise.resolve();
  /** Counts gestures, so a selection placed late never outlives its own. */
  #gesture = 0;
  #pressedOnPage = false;
  /**
   * The text structure a Text Draft read its page from at the click, kept for
   * its create; `null` while no draft is typed.
   */
  #draftStructure: PdfTextStructure | null = null;
  /**
   * The press the armed note or text tool took, which places a note or opens
   * a Text Draft at its release within the click slop while the tool stays
   * armed; `null` while none stands.
   */
  #clickPress: ClickPress | null = null;
  /** The pointer an image capture holds, and the page it was pressed on. */
  #capturing: { pointerId: number; page: ReaderPage } | null = null;
  /** The Ink Stroke the pointer is drawing; `null` while none is. */
  #stroke: InkStroke | null = null;
  /**
   * The pointer whose press discarded another pointer's stroke — the second
   * finger of a pinch — which draws nothing of its own.
   */
  #pinching: number | null = null;
  /** The ink creates, run one at a time in release order. Never rejects. */
  #inking = Promise.resolve();
  /** Tells one Pending Stroke from another. */
  #strokeSerial = 0;
  /**
   * What joins every Annotation of the stroke being drawn into one History
   * Step; `null` while no stroke is being drawn.
   */
  #inkGroup: string | null = null;

  constructor(deps: MarkCreationDeps) {
    this.#deps = deps;
    // The sheet goes with the episode it was opened for, so its editor lets go
    // of the keys it holds even when the popup hides under it.
    this.#surfaces.defer(
      deps.surfaceState.subscribe(
        selectFloatingHead,
        ({ kind, commenting }) => {
          if (kind !== "create" || !commenting) this.#dropSheet();
        },
        { equalityFn: sameFlat },
      ),
    );
    // A tool change takes the stroke or the click press in progress with it,
    // and finishes a Text Draft. The draft's own opening stands the tool down,
    // which is no change of tool.
    this.#surfaces.defer(
      deps.surfaceState.subscribe(
        ({ armed }) => armed,
        (armed) => {
          if (armed !== "ink") this.#discardStroke();
          this.#dropClickPress();
          if (armed !== null) this.finishDraft();
        },
      ),
    );
  }

  /**
   * Settles when the last create this surface started has run to its end.
   * Already settled while none has run. Never rejects.
   */
  get created(): Promise<unknown> {
    return this.#creating;
  }

  /**
   * Settles when the last selection this surface read has been placed on the
   * page's characters, or refused. Already settled while none has. Never
   * rejects.
   */
  get settled(): Promise<void> {
    return this.#settling;
  }

  /**
   * Draws the Creation Toolbar into the reader's right toolbar slot and keeps
   * it in step with the Reader Surface State. The slot is emptied again by this
   * object's disposal, and the removal is idempotent because Obsidian's own
   * `empty()` on unload may have cleared it first.
   *
   * @returns the toolbar's nodes, so the caller can draw into its capability slot.
   */
  mountToolbar(slot: HTMLElement): CreationToolbarNodes {
    this.#surfaces.defer(() => removeCreationToolbar(slot));
    const state = this.#deps.surfaceState;
    const draw = (controls: readonly CreationToolbarControl[]) =>
      renderCreationToolbar(slot, controls, (id, node) =>
        this.#toolbarActivate(id, node),
      );
    const nodes = draw(selectCreationToolbar(state.getState()));
    // A pointer press on the toolbar hands the keyboard to the pages rather
    // than to the control pressed, so the Reader Keymap and the edit keys act
    // next — and a key pressed after it rings no control the pointer chose.
    this.#surfaces.use(
      registerDomEvent(nodes.root, "mousedown", (event) => {
        event.preventDefault();
        this.#deps.focusReader();
      }),
    );
    this.#surfaces.defer(
      state.subscribe(selectCreationToolbar, draw, {
        equalityFn: sameFlatList,
      }),
    );
    this.#deps.renderCapability(nodes.capabilitySlot);
    return nodes;
  }

  press(event: PointerEvent): void {
    this.#gesture++;
    // A second pointer takes back the capture the first one holds, and
    // discards the stroke it draws: a pinch begins that way.
    if (this.#capturing && event.pointerId !== this.#capturing.pointerId)
      this.#cancelCapture();
    // Held for this press alone: one that lands outside the reader never
    // reaches `grab` to clear it.
    this.#pinching = null;
    if (this.#stroke && event.pointerId !== this.#stroke.pointerId) {
      this.#pinching = event.pointerId;
      this.#discardStroke();
    }
    // A second pointer discards the click press the first one holds, and
    // places nothing of its own.
    if (this.#clickPress && event.pointerId !== this.#clickPress.pointerId) {
      this.#pinching = event.pointerId;
      this.#dropClickPress();
    }
    // A press anywhere but in the Text Draft finishes it, whatever its
    // button, a right-click included: a press of any button elsewhere takes
    // the focus off the textarea, and its blur finishes the draft as well.
    if (
      !(event.target as Element | null)?.closest?.(`.${themeHook.pdfTextDraft}`)
    )
      this.finishDraft();
    const inPopup = this.#deps.popup.contains(event.target as Node);
    // The press that follows a settled selection dismisses its popup, wherever
    // it lands — the popup is only ever opened from a release.
    if (!inPopup) this.#clear();
    this.#pressedOnPage =
      !inPopup && this.#pageUnder({ x: event.clientX, y: event.clientY });
  }

  settle(): void {
    const onPage = this.#pressedOnPage;
    this.#pressedOnPage = false;
    if (!onPage || this.#writing) return;
    // The press that began this gesture bumped the count; a later press or
    // the disposal bumps it again, which leaves this placement stale.
    const gesture = this.#gesture;
    this.#settling = this.#capture().then(
      (placed) => {
        if (!placed || gesture !== this.#gesture || this.#writing) return;
        // The selection can collapse while the page's characters load.
        if (selectionCollapsed(this.#deps.containerEl)) return;
        const { armed, colors } = this.#state();
        // Only a selection tool takes a text selection: one made under the
        // note, image or ink tool waits in the popup as one made unarmed does.
        if (isSelectionTool(armed)) {
          // The armed tool commits at once and opens no popup, so the
          // selection never floats.
          this.#creating = this.#create({
            type: armed,
            color: colors[armed],
            comment: "",
            ...selectionDraft(placed.captured),
          });
          return;
        }
        if (placed.anchorAt)
          captureSelection(this.#deps.surfaceState, {
            captured: placed.captured,
            anchorAt: placed.anchorAt,
          });
      },
      (error: unknown) => {
        logger.warn("Could not place the text selection on the page", {
          error,
        });
      },
    );
  }

  changed(): void {
    // The comment sheet takes focus, which collapses the window selection; the
    // geometry the popup is acting on was captured when the drag ended.
    const floating = this.#floating();
    if (floating.kind !== "create" || floating.commenting || floating.inFlight)
      return;
    if (selectionCollapsed(this.#deps.containerEl)) this.#clear();
  }

  key(event: KeyboardEvent): void {
    if (inTextEntry(event.target)) return;
    if (!isEditGesture(event)) return;
    const key = event.key.toLowerCase();
    const tool: SelectionTool | null =
      key === "h" ? "highlight" : key === "u" ? "underline" : null;
    const swatch = ANNOTATION_COLORS[Number(key) - 1];
    const waiting = this.#floating().kind === "create";

    // Arming a tool and colouring one move controls the block has already
    // disabled, so under a block they stand still: the binding's own notice is
    // the whole answer, and a toolbar that moved with it would contradict it.
    const live = editingLive(this.#capability());
    if (tool !== null) {
      event.preventDefault();
      if (waiting) this.#commit(tool, this.#state().colors[tool]);
      else if (live) this.#arm(this.#state().armed === tool ? null : tool);
      return;
    }
    if (swatch !== undefined) {
      event.preventDefault();
      const { armed } = this.#state();
      if (waiting) this.#commit(selectionToolOf(armed), swatch);
      else if (live) this.#setColor(armed ?? "highlight", swatch);
      return;
    }
    if (key !== "c" || !waiting) return;
    event.preventDefault();
    setCommenting(this.#deps.surfaceState, true);
  }

  /**
   * The selection's page left the screen, for the popup host: the selection
   * goes with its popup, as the next press would take it.
   */
  unanchored(): void {
    this.#clear();
  }

  grab(event: PointerEvent, { onMark }: { onMark: () => boolean }): void {
    const pinching = this.#pinching === event.pointerId;
    this.#pinching = null;
    if (event.button !== 0) return;
    const { armed } = this.#state();
    const gesture = gestureOf(armed);
    if (gesture === "stroke") {
      if (!pinching) this.#beginStroke(event);
      return;
    }
    if (gesture !== "click" && gesture !== "rectangle") return;
    if (pinching || this.#capturing || this.#writing || onMark()) return;
    const client = { x: event.clientX, y: event.clientY };
    const page = this.#pressedPage(event);
    if (!page || this.#inSelection(client)) return;
    if (!editingLive(this.#capability())) {
      this.#deps.reportBlockedGesture();
      return;
    }
    // The press selects no text, and drops the selection that stood, as
    // Zotero's reader does before it draws a rectangle. The container holds
    // the pointer, so a release off it still ends the gesture.
    event.preventDefault();
    this.#collapse();
    this.#deps.containerEl.setPointerCapture(event.pointerId);
    if (isClickTool(armed)) {
      // Only a click places the note or opens the draft; a drag does nothing.
      this.#holdClick({
        pointerId: event.pointerId,
        tool: armed,
        pageIndex: page.pageIndex,
        at: pdfPointAt(page.view, client),
        client,
      });
      return;
    }
    this.#capturing = { pointerId: event.pointerId, page };
    beginCapture(this.#deps.surfaceState, {
      pageIndex: page.pageIndex,
      from: pdfPointAt(page.view, client),
    });
  }

  move(event: PointerEvent): void {
    if (this.#stroke) {
      if (event.pointerId === this.#stroke.pointerId) this.#stroke.move(event);
      return;
    }
    const capturing = this.#capturing;
    const capture = selectCapture(this.#state());
    if (!capturing || event.pointerId !== capturing.pointerId || !capture)
      return;
    // Read on every move, so a scroll or a zoom mid-drag is measured against
    // the page as it now stands.
    const { view } = capturing.page;
    moveCapture(
      this.#deps.surfaceState,
      captureRect({
        from: capture.from,
        to: pdfPointAt(capturing.page.view, {
          x: event.clientX,
          y: event.clientY,
        }),
        viewBox: view.viewport.viewBox,
      }),
    );
  }

  release(event: PointerEvent): void {
    if (this.#stroke) {
      if (event.pointerId === this.#stroke.pointerId) this.#releaseStroke();
      return;
    }
    const click = this.#clickPress;
    if (click && event.pointerId === click.pointerId) {
      this.#holdClick(releaseCapture(this.#deps.containerEl, click));
      const travel = distance(click.client, {
        x: event.clientX,
        y: event.clientY,
      });
      if (travel >= CLICK_SLOP) return;
      if (click.tool === "note")
        this.#creating = this.#createNote(click.pageIndex, click.at);
      else this.#openDraft(click.pageIndex, click.at);
      return;
    }
    const capturing = this.#capturing;
    if (!capturing || event.pointerId !== capturing.pointerId) return;
    this.#capturing = releaseCapture(this.#deps.containerEl, this.#capturing);
    const rect = endCapture(this.#deps.surfaceState);
    if (!rect) return;
    this.#creating = this.#createImage(capturing.page.pageIndex, rect);
  }

  cancel(event: PointerEvent): void {
    if (event.pointerId === this.#clickPress?.pointerId) this.#dropClickPress();
    if (event.pointerId === this.#capturing?.pointerId) this.#cancelCapture();
    if (event.pointerId === this.#stroke?.pointerId) this.#discardStroke();
  }

  get capturing(): boolean {
    return (
      this.#capturing !== null ||
      this.#stroke !== null ||
      this.#clickPress !== null
    );
  }

  [Symbol.dispose](): void {
    this.#gesture++;
    this.finishDraft();
    this.#dropClickPress();
    this.#cancelCapture();
    this.#discardStroke();
    this.#surfaces.dispose();
    this.#clear();
  }

  /** The tool the toolbar shows as armed, or `null` while none is. */
  #arm(tool: MarkTool | null): void {
    arm(this.#deps.surfaceState, tool);
  }

  #setColor(tool: MarkTool, color: string): void {
    setToolColor(this.#deps.surfaceState, this.#deps.colors, { tool, color });
  }

  #state(): ReaderSurfaceState {
    return this.#deps.surfaceState.getState();
  }

  #floating(): Floating {
    return this.#state().floating;
  }

  /**
   * Escape, which the Reader Keymap runs once the selected mark left it.
   *
   * @returns whether a level was there to step back from.
   */
  escape(): boolean {
    return this.#stepBack();
  }

  /**
   * One step back: an ink stroke or an image capture is taken back first, a
   * Text Draft is finished, the comment sheet closes, then the popup with its
   * selection, then the armed tool stands down.
   *
   * @returns whether a level was there to step back from.
   */
  #stepBack(): boolean {
    if (this.#stroke) {
      this.#discardStroke();
      return true;
    }
    const floating = this.#floating();
    if (floating.kind === "text-draft" && floating.phase === "typing") {
      this.finishDraft();
      return true;
    }
    if (floating.kind === "capture" && floating.phase !== "saving") {
      this.#cancelCapture();
      return true;
    }
    if (floating.kind === "create" && floating.commenting) {
      setCommenting(this.#deps.surfaceState, false);
      return true;
    }
    if (floating.kind === "create") {
      this.#clear();
      return true;
    }
    if (this.#state().armed === null) return false;
    this.#arm(null);
    return true;
  }

  #toolbarActivate(id: string, node: HTMLElement): void {
    if (id === "visibility") {
      toggleMarks(this.#deps.surfaceState);
      this.#deps.repaint();
      return;
    }
    // A tool's own button arms it; its chevron, `<tool>-color`, opens its
    // colours.
    const tool = MARK_TOOLS.find(
      (candidate) => id === candidate || id === `${candidate}-color`,
    );
    if (!tool) return;
    if (id === tool) this.#arm(this.#state().armed === tool ? null : tool);
    else this.#openColorMenu(tool, node);
  }

  /**
   * The tool's own colour list, under the chevron half of its split button,
   * and below the colours the ink tool's pen widths and the text tool's font
   * sizes. The toolbar sits at the right of the reader's own toolbar, so the
   * menu lines up with the chevron's far edge and grows inward.
   */
  #openColorMenu(tool: MarkTool, node: HTMLElement): void {
    const { colors } = this.#deps;
    const menu = colorMenu(colors.current()[tool], (hex) =>
      this.#setColor(tool, hex),
    );
    if (tool === "ink")
      addInkWidths(menu, colors.inkWidth(), (width) =>
        colors.setInkWidth(width),
      );
    if (tool === "text")
      addTextFontSizes(menu, colors.textFontSize(), (size) =>
        colors.setTextFontSize(size),
      );
    showMenuAtButton(menu, node, "end");
  }

  /**
   * The popup's row in create mode, for the popup host. Into an empty content
   * element it builds the row and, while commenting, the sheet; into the one it
   * built it redraws the row and leaves the sheet and its text standing.
   */
  renderPopup(content: HTMLElement): void {
    const input = selectCreateRowInput(this.#state());
    if (!input) return;
    const status = sheetStatus(input.capability, input.now);
    let built = false;
    if (!content.firstChild || !this.#row) {
      built = true;
      this.#dropSheet();
      const { column, row } = popupColumn(content);
      this.#row = row;
      this.#sheet = input.commenting
        ? renderCommentSheet(
            column.createDiv(),
            {
              app: this.#deps.app,
              surface: "popup",
              value: "",
              onSubmit: () => {
                const tool = selectionToolOf(this.#state().armed);
                this.#commit(tool, this.#state().colors[tool]);
              },
              onCancel: () => setCommenting(this.#deps.surfaceState, false),
            },
            status,
          )
        : null;
    }
    renderCreatePopupRow(this.#row, createPopupRow(input), (action) =>
      this.#activate(action),
    );
    if (!built) this.#sheet?.update(status);
  }

  #activate(action: CreatePopupAction): void {
    switch (action.kind) {
      case "tool":
        this.#commit(action.tool, this.#state().colors[action.tool]);
        return;
      case "color": {
        // A colour chosen in the popup becomes that tool's colour, so the
        // toolbar and the popup never disagree.
        const tool = selectionToolOf(this.#state().armed);
        this.#setColor(tool, action.color);
        this.#commit(tool, action.color);
        return;
      }
      case "comment": {
        const floating = this.#floating();
        setCommenting(
          this.#deps.surfaceState,
          floating.kind === "create" && !floating.commenting,
        );
        return;
      }
      case "copy": {
        const floating = this.#floating();
        if (floating.kind !== "create") return;
        const { text } = floating.captured;
        void toast.promise(navigator.clipboard.writeText(text), {
          success: m.annot_view_copied_text(),
          error: m.annot_view_copy_failed(),
        });
        return;
      }
    }
  }

  /**
   * One create, from the selection this gesture settled on.
   *
   * The Sort Index and the Page Label are computed here, from the unrounded
   * geometry and from the Annotations the Attachment already holds; the write
   * rounds the geometry and this does not.
   *
   * @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
   */
  #commit(type: SelectionTool, color: string): void {
    const floating = this.#floating();
    if (floating.kind !== "create" || this.#writing) return;
    this.#creating = this.#create({
      type,
      color,
      comment: floating.commenting ? (this.#sheet?.text() ?? "") : "",
      ...selectionDraft(floating.captured),
    });
  }

  /**
   * One note, a {@link NOTE_SIZE}-point square centred on the press point in
   * the note tool's colour, as Zotero places one: not clamped to the page. It
   * opens on its comment, and the tool stands down, as Zotero's does. The
   * capability can lapse while the pointer is down, and that release is told
   * why it created nothing.
   *
   * @see https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js#L3104-L3122
   */
  async #createNote(pageIndex: number, [x, y]: PdfPoint): Promise<void> {
    if (!editingLive(this.#capability())) {
      this.#deps.reportBlockedGesture();
      return;
    }
    const half = NOTE_SIZE / 2;
    await this.#create(
      {
        type: "note",
        color: this.#state().colors.note,
        comment: "",
        text: "",
        position: {
          pageIndex,
          rects: [[x - half, y - half, x + half, y + half]],
        },
      },
      { commenting: true },
    );
  }

  /**
   * Opens a Text Draft at the press point, at the text tool's colour and font
   * size, and stands the tool down, as Zotero's text tool does. The capability
   * can lapse while the pointer is down, and that release is told why it
   * opened nothing.
   */
  #openDraft(pageIndex: number, at: PdfPoint): void {
    if (!editingLive(this.#capability())) {
      this.#deps.reportBlockedGesture();
      return;
    }
    openTextDraft(this.#deps.surfaceState, {
      pageIndex,
      at,
      fontSize: this.#deps.colors.textFontSize(),
      color: this.#state().colors.text,
    });
    logger.debug("A Text Draft was opened", { pageIndex });
    // This surface's disposal finishes a draft still typed, after the viewer
    // let go of its document. The structure is kept, and its page and the Page
    // Labels are read now, so that create takes its Sort Index and Page Label
    // from what the structure holds.
    const structure = this.#deps.structure();
    this.#draftStructure = structure;
    void structure?.page(pageIndex).catch(() => undefined);
    void structure?.pageLabels().catch(() => undefined);
  }

  /**
   * Takes what the Text Draft's textarea now holds, and refits its box in the
   * one font the saved mark is drawn in, inside its page.
   */
  typeDraft(text: string): void {
    const draft = selectTextDraft(this.#state());
    const page = this.#deps
      .pages()
      .find(({ pageIndex }) => pageIndex === draft?.pageIndex);
    if (!page) return;
    refitTextDraft(this.#deps.surfaceState, text, {
      measure: interfaceFont(this.#deps.containerEl.win).measure,
      pageBox: page.view.viewport.viewBox,
    });
  }

  /**
   * Finishes the Text Draft, where one is being typed: text beyond whitespace
   * is created, and anything else goes.
   */
  finishDraft(): void {
    if (selectTextDraft(this.#state())?.phase !== "typing") return;
    const structure = this.#draftStructure;
    this.#draftStructure = null;
    const draft = finishTextDraft(this.#deps.surfaceState);
    logger.debug("A Text Draft was finished", { committed: draft !== null });
    if (draft) this.#creating = this.#createText(draft, structure);
  }

  /**
   * One text Annotation, from a finished Text Draft: its typed text as the
   * comment, in its fitted box. The draft stays drawn until the read that
   * holds the record takes its place; a create that fails or cannot run takes
   * it off the page and says why.
   */
  async #createText(
    draft: TextDraft,
    structure: PdfTextStructure | null,
  ): Promise<void> {
    const store = this.#deps.surfaceState;
    // The typed text is lost, so a lapse names the create that failed.
    const capability = this.#capability();
    if (!editingLive(capability)) {
      dropTextDraft(store);
      this.#deps.reportCreateFailure(
        blockedReason(capability, this.#deps.now()),
      );
      return;
    }
    const key = await this.#create(
      {
        type: "text",
        color: draft.color,
        comment: draft.text,
        text: "",
        position: textDraftPosition(draft),
      },
      { structure },
    );
    if (key === null) dropTextDraft(store);
    else settleTextDraft(store, key);
  }

  /**
   * One image, from the rectangle a capture was released on, in the image
   * tool's colour. The tool stands down once it is created, as Zotero's does.
   * The capability can lapse while the pointer is down, and that release is
   * told why it created nothing.
   */
  async #createImage(pageIndex: number, rect: PdfRect): Promise<void> {
    if (!editingLive(this.#capability())) {
      cancelCapture(this.#deps.surfaceState);
      this.#deps.reportBlockedGesture();
      return;
    }
    await this.#create({
      type: "image",
      color: this.#state().colors.image,
      comment: "",
      text: "",
      position: { pageIndex, rects: [rect] },
    });
  }

  /**
   * One create through the Zotero Local API, with the Sort Index and the Page
   * Label from the text structure, and the effects {@link CREATE_EFFECTS}
   * gives its tool. A create that made nothing says why, a create that threw
   * included. Never rejects.
   *
   * @param options.commenting whether the new mark's popup opens on its
   *   comment editor.
   * @param options.structure the text structure to read, in place of the
   *   one the viewer holds now.
   * @param options.group what joins this create to the others of one gesture
   *   in the Annotation History, where one gesture created several
   *   Annotations.
   * @returns the created Annotation's Indexed Key, or `null` for a create
   *   that did not run or did not land.
   */
  async #create(
    { type, color, comment, text, position }: MarkDraft,
    {
      structure: given,
      group,
      ...reveal
    }: Pick<SelectOptions, "commenting"> & {
      structure?: PdfTextStructure | null;
      group?: string;
    } = {},
  ): Promise<string | null> {
    const structure = given ?? this.#deps.structure();
    // A blocked gesture is answered by the binding's own edit-gesture listener,
    // which hears every key of the shared edit keymap.
    if (!editingLive(this.#capability())) return null;
    if (!structure) {
      cancelCapture(this.#deps.surfaceState);
      logger.warn("No text structure stands for this PDF; nothing was created");
      this.#deps.reportCreateFailure(m.pdf_create_reason_no_document());
      return null;
    }
    const { foreground, disarm } = CREATE_EFFECTS[type];
    if (foreground) {
      this.#writing = true;
      setInFlight(this.#deps.surfaceState, true);
    }
    let created = false;
    try {
      const [sortIndex, pageLabel] = await Promise.all([
        structure.sortIndex(position),
        structure.pageLabel(
          position.pageIndex,
          previousAnnotations(this.#deps.records()),
        ),
      ]);
      const outcome = await this.#deps.annotations.createAnnotation(
        this.#deps.attachmentKey,
        {
          type,
          color,
          comment,
          text,
          pageLabel,
          sortIndex,
          position,
        },
        { group },
      );
      if (outcome.kind === "failed") {
        this.#deps.reportCreateFailure(
          writeFailureReason(outcome.failure, this.#deps.now()),
        );
        return null;
      }
      created = true;
      recordColorUse(this.#deps.surfaceState, this.#deps.colors, color);
      if (foreground) this.#deps.reveal(outcome.annotationKey, reveal);
      if (disarm) this.#arm(null);
      return outcome.annotationKey;
    } catch (error) {
      logger.warn("An Annotation was not created", { type, error });
      this.#deps.reportCreateFailure(
        m.annot_view_write_reason_unknown_outcome(),
      );
      return null;
    } finally {
      if (foreground) {
        this.#writing = false;
        setInFlight(this.#deps.surfaceState, false);
        // The rectangle stays drawn until Zotero answered, whatever it said.
        cancelCapture(this.#deps.surfaceState);
      }
      if (created && foreground) {
        this.#clear();
        this.#collapse();
      }
    }
  }

  /**
   * Begins an Ink Stroke at a press on a page, marks under it included. A
   * stroke already drawn by another pointer keeps the pointer; a press while
   * editing is not live draws nothing and says why.
   */
  #beginStroke(event: PointerEvent): void {
    if (this.#stroke) return;
    const client = { x: event.clientX, y: event.clientY };
    const page = this.#pressedPage(event);
    if (!page) return;
    if (!editingLive(this.#capability())) {
      this.#deps.reportBlockedGesture();
      return;
    }
    // The drag selects no text, and the selection that stood goes, as it
    // does before Zotero's reader draws.
    event.preventDefault();
    this.#collapse();
    this.#deps.containerEl.setPointerCapture(event.pointerId);
    const width = this.#deps.colors.inkWidth();
    const color = this.#state().colors.ink;
    // Every part one stroke is split into is one stroke to the researcher, so
    // every create it makes joins the one History Step its undo takes back.
    const group = nextInkGroup();
    this.#inkGroup = group;
    this.#stroke = new InkStroke({
      pointerId: event.pointerId,
      page,
      at: client,
      width,
      color,
      surfaceState: this.#deps.surfaceState,
      win: this.#deps.containerEl.win,
      // The pointer and the tool stay held; only the part drawn so far goes.
      onSplit: (path) =>
        this.#queueStroke(
          { pageIndex: page.pageIndex, width, color },
          { path, reason: "split", group },
        ),
    });
    logger.trace("An ink stroke began", { pageIndex: page.pageIndex });
  }

  /**
   * Ends the stroke at its own pointer's release: it stays on the page as a
   * Pending Stroke, and its create waits behind the ones released before it.
   * The capability can lapse while the pointer is down, and that release is
   * told why it created nothing.
   */
  #releaseStroke(): void {
    const stroke = this.#stroke;
    if (!stroke) return;
    this.#stroke = null;
    const group = this.#inkGroup ?? undefined;
    this.#inkGroup = null;
    releaseCapture(this.#deps.containerEl, stroke);
    this.#queueStroke(
      {
        pageIndex: stroke.page.pageIndex,
        width: stroke.width,
        // The colour the stroke was drawn in, whatever the tool took since.
        color: stroke.color,
      },
      { path: stroke.finish(), reason: "release", group },
    );
  }

  /**
   * Holds a finished stroke on the page as a Pending Stroke, and queues its
   * create behind the ones finished before it: a stroke at its release, or the
   * part a long stroke finished at the position ceiling.
   */
  #queueStroke(
    stroke: Pick<PendingStroke, "pageIndex" | "width" | "color">,
    {
      path,
      reason,
      group,
    }: { path: number[]; reason: "release" | "split"; group?: string },
  ): void {
    if (!editingLive(this.#capability())) {
      this.#deps.reportBlockedGesture();
      return;
    }
    const pending: PendingStroke = {
      ...stroke,
      id: ++this.#strokeSerial,
      paths: [path],
    };
    appendPendingStroke(this.#deps.surfaceState, pending);
    logger.debug("An ink stroke was finished", {
      reason,
      pageIndex: pending.pageIndex,
      points: path.length / 2,
    });
    this.#inking = this.#inking.then(() => this.#createInk(pending, group));
    this.#creating = this.#inking;
  }

  /**
   * One ink create; its Pending Stroke goes once Zotero answered, and a create
   * that made nothing says why. The capability can lapse while the stroke
   * waits behind the creates released before it. Never rejects.
   */
  async #createInk(
    pending: PendingStroke,
    group: string | undefined,
  ): Promise<void> {
    const { id, pageIndex, width, color, paths } = pending;
    let key: string | null = null;
    if (editingLive(this.#capability())) {
      key = await this.#create(
        {
          type: "ink",
          color,
          comment: "",
          text: "",
          position: { pageIndex, width, paths },
        },
        { group },
      );
    } else {
      this.#deps.reportBlockedGesture();
    }
    if (key === null) dropPendingStroke(this.#deps.surfaceState, id);
    else settlePendingStroke(this.#deps.surfaceState, { id, key });
  }

  /** Takes back the stroke in progress, drawing and creating nothing for it. */
  #discardStroke(): void {
    const stroke = this.#stroke;
    if (!stroke) return;
    this.#stroke = null;
    this.#inkGroup = null;
    releaseCapture(this.#deps.containerEl, stroke);
    stroke[Symbol.dispose]();
    logger.debug("An ink stroke was discarded");
  }

  /** Takes back the click press, placing and opening nothing for it. */
  #dropClickPress(): void {
    this.#holdClick(releaseCapture(this.#deps.containerEl, this.#clickPress));
  }

  /**
   * Holds the click press, or lets it go with `null`. The reader carries
   * `data-zt-clicking` while one is held, so the stylesheet keeps the armed
   * tool's cursor over the pointer the container captures.
   */
  #holdClick(press: ClickPress | null): void {
    this.#clickPress = press;
    this.#deps.containerEl.toggleAttribute("data-zt-clicking", press !== null);
  }

  /** Takes back the capture, drawing and creating nothing for it. */
  #cancelCapture(): void {
    this.#capturing = releaseCapture(this.#deps.containerEl, this.#capturing);
    if (selectCapture(this.#state())?.phase !== "saving")
      cancelCapture(this.#deps.surfaceState);
  }

  /** Whether a client point falls on the text the window has selected. */
  #inSelection({ x, y }: Point): boolean {
    const selection = this.#deps.containerEl.win.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0)
      return false;
    return [...selection.getRangeAt(0).getClientRects()].some(
      (box) =>
        x >= box.left && x <= box.right && y >= box.top && y <= box.bottom,
    );
  }

  /** The gesture is over: the popup, the sheet, and the selection all go. */
  #clear(): void {
    this.#row = null;
    this.#dropSheet();
    if (this.#floating().kind === "create")
      clearFloating(this.#deps.surfaceState);
  }

  #dropSheet(): void {
    this.#sheet?.[Symbol.dispose]();
    this.#sheet = null;
  }

  /** Drops the window selection, as Zotero's reader does once a mark is made. */
  #collapse(): void {
    this.#deps.containerEl.win.getSelection()?.removeAllRanges();
  }

  #capability(): EditingCapability {
    return this.#state().capability;
  }

  /**
   * What the live window selection quotes, placed on the Structured
   * Characters of the pages it reaches, with the anchor the popup hangs from.
   * `null` for a selection this reader cannot place.
   *
   * The DOM is read before the first wait, so the result stands for the
   * selection as it was when the gesture settled.
   */
  async #capture(): Promise<{
    captured: SelectedText;
    anchorAt: AnchorAt | null;
  } | null> {
    const selection = this.#deps.containerEl.win.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
      return null;
    }
    const pages = selectionPagesOf(selection.getRangeAt(0), this.#deps.pages());
    const structure = this.#deps.structure();
    if (!pages.length || !structure) return null;
    const captured = await structure.selectText({
      text: selection.toString(),
      pages,
    });
    if (!captured) {
      logger.debug("Text selection maps onto no character of its pages", {
        pageIndexes: pages.map(({ pageIndex }) => pageIndex),
      });
      return null;
    }
    return {
      captured,
      anchorAt: anchorFractionOf(pages, captured.pageIndex),
    };
  }

  /**
   * Where the popup hangs, for the popup host: the bottom centre of the
   * selection's own boxes, measured against the page as it now stands, so a
   * zoom or a re-render moves the popup with the text. `null` once the page is
   * off screen.
   */
  anchor(): Point | null {
    const floating = this.#floating();
    if (floating.kind !== "create") return null;
    const at = floating.anchorAt;
    const page = this.#deps
      .pages()
      .find(({ pageIndex }) => pageIndex === at.pageIndex);
    if (!page) return null;
    const rect = pageContentBox(page.view.div);
    if (rect.width <= 0 || rect.height <= 0) return null;
    const point = {
      x: rect.left + at.fx * rect.width,
      y: rect.top + at.fy * rect.height,
    };
    return onScreen(this.#deps.containerEl, point) ? point : null;
  }

  #pageUnder(client: Point): boolean {
    return this.#readerPageUnder(client) !== null;
  }

  /**
   * The page a press landed on. A page scrolled up under the reader's toolbar
   * still spans the toolbar's press point, so the press's target decides: a
   * press on the toolbar takes no capture that would keep its click from it.
   */
  #pressedPage(event: PointerEvent): ReaderPage | null {
    const page = this.#readerPageUnder({ x: event.clientX, y: event.clientY });
    return page?.view.div.contains(event.target as Node | null) ? page : null;
  }

  #readerPageUnder({ x, y }: Point): ReaderPage | null {
    return (
      this.#deps.pages().find(({ view }) => {
        const rect = view.div.getBoundingClientRect();
        return (
          x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
        );
      }) ?? null
    );
  }
}

/**
 * What the create-mode sheet says: the shared comment controls with no draft
 * behind them, since the comment goes with the create. It has no draft to save
 * by hand, and where nothing else speaks it names the keys that create.
 */
function sheetStatus(
  capability: EditingCapability,
  now: Temporal.Instant,
): CommentSheetStatus {
  const controls = commentEditorControls(capability, null, now);
  return {
    ...controls,
    manual: false,
    hint:
      controls.hint ??
      (Platform.isMacOS
        ? m.pdf_create_popup_comment_hint_mac()
        : m.pdf_create_popup_comment_hint()),
  };
}

/** The quoted text and the position a settled text selection is created with. */
function selectionDraft(captured: SelectedText) {
  return {
    text: captured.text,
    position: {
      pageIndex: captured.pageIndex,
      rects: captured.rects,
      ...(captured.nextPageRects && {
        nextPageRects: captured.nextPageRects,
      }),
    },
  };
}

/**
 * The Annotations the Page Label heuristic aligns a fresh one against, in the
 * reading order the Annotation Source answered them in. An Annotation whose
 * position names no PDF page cannot be aligned against and is left out.
 */
function previousAnnotations(
  records: readonly AnnotationRecord[],
): { pageLabel: string; pageIndex: number }[] {
  return records.flatMap((record) =>
    record.pageLabel !== null && "pageIndex" in record.position
      ? [{ pageLabel: record.pageLabel, pageIndex: record.position.pageIndex }]
      : [],
  );
}

/**
 * The popup's anchor as a fraction of its page box: the bottom centre of the
 * selected text's boxes on the page the Annotation is filed under.
 */
function anchorFractionOf(
  pages: readonly SelectionPage[],
  pageIndex: number,
): AnchorAt | null {
  const page = pages.find((one) => one.pageIndex === pageIndex);
  if (!page || page.clientRects.length === 0) return null;
  const width = page.box.right - page.box.left;
  const height = page.box.bottom - page.box.top;
  if (width <= 0 || height <= 0) return null;
  const left = Math.min(...page.clientRects.map((rect) => rect.left));
  const right = Math.max(...page.clientRects.map((rect) => rect.right));
  const bottom = Math.max(...page.clientRects.map((rect) => rect.bottom));
  return {
    pageIndex,
    fx: ((left + right) / 2 - page.box.left) / width,
    fy: (bottom - page.box.top) / height,
  };
}
