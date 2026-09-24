// Creating a highlight or an underline from a text selection in Obsidian's PDF
// reader, and an image from a rectangle dragged on a page: the Creation
// Toolbar's defaults, the Mark Popup in create mode, the keys that commit
// without the mouse, and the one command that writes.
//
// Two speeds of one commit path. Nothing armed: a settled selection opens the
// popup and one click commits. A tool armed from the toolbar: the selection
// commits at once in that tool's colour and the popup reopens on the new mark.
// The armed image tool takes a rectangle instead of a selection, and stands
// down once it has created one. The armed ink tool takes a freehand stroke,
// creates it in the background, and stays armed for the next one.
//
// @see https://github.com/aidenlx/zotlit/issues/1150
// @see https://github.com/aidenlx/zotlit/issues/1206
// @see https://github.com/aidenlx/zotlit/issues/1209
import type { App } from "obsidian";

import type { PdfTextStructure, SelectedText } from "@zotlit/pdf-structure";

import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { showMenuAtButton } from "@/lib/menu";
import { BaseNotice } from "@/lib/notice";
import * as toast from "@/lib/toast";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationRecord,
  AnnotationRepository,
} from "@/services/annotation-repository/service";
import { writeFailureReason } from "@/services/annotation-repository/write";
import type { InkPosition } from "@/services/annotation-repository/write";
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
import type { PdfRect } from "./geometry-edit";
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
  endCapture,
  moveCapture,
  recordColorUse,
  selectCapture,
  selectCreateRowInput,
  sameFlatList,
  sameFlat,
  selectCreationToolbar,
  selectFloatingHead,
  setCommenting,
  setInFlight,
  settlePendingStroke,
  setToolColor,
  toggleMarks,
} from "./reader-surface-state";
import type {
  AnchorAt,
  Floating,
  PendingStroke,
  ReaderSurfaceState,
  ReaderSurfaceStore,
} from "./reader-surface-state";
import type { OverlayPageView } from "./render";
import { selectionPagesOf } from "./selection-capture";
import type { SelectionPage } from "./selection-capture";
import {
  addInkWidths,
  colorMenu,
  onScreen,
  pageContentBox,
  pdfPointAt,
  selectionCollapsed,
  releaseCapture,
} from "./surface";
import { textToolOf } from "./tools";
import type { MarkTool, TextTool, ToolColorStore } from "./tools";

const logger = getLogger("pdf-annotation-editor");

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
   * A press in the reader that took no Mark Handle, which the armed image
   * tool may begin a capture from, and the armed ink tool a stroke.
   *
   * @param options.onMark whether an Annotation Mark lies under the press,
   *   which keeps the press the mark's; asked only of a press the image tool
   *   could take. The ink tool draws over marks.
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
  /** The quoted text; empty for an image and ink, which quote none. */
  text: string;
  position:
    | {
        pageIndex: number;
        rects: SelectedText["rects"];
        nextPageRects?: SelectedText["rects"];
      }
    | InkPosition;
}

/**
 * What a create does around its write, by the tool it creates for. A
 * foreground create holds the reader until Zotero answers — no second text or
 * image create begins meanwhile — and takes the new mark as the selection; an
 * ink create runs in the background, selects nothing, and leaves the tool
 * armed. The image tool stands down once it created, as Zotero's does.
 */
const CREATE_EFFECTS: Record<
  MarkTool,
  { foreground: boolean; disarm: boolean }
> = {
  highlight: { foreground: true, disarm: false },
  underline: { foreground: true, disarm: false },
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
  /** Takes the new mark as the selection, so the popup reopens on it. */
  reveal: (annotationKey: string) => void;
  /**
   * A press met a block on this Attachment. The seam probes Zotero and says
   * why, once per reason per capability episode.
   */
  reportBlockedGesture: () => void;
  /** Draws the Editing Capability affordance into the toolbar's own slot. */
  renderCapability: (slot: HTMLElement) => void;
  /**
   * Each tool's own colour and the ink tool's pen width, which are kept
   * across PDFs rather than per view.
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
   * Whether a text or image create is waiting on Zotero, the armed tool's
   * among them, so a drag released meanwhile makes nothing. An ink create
   * holds nothing.
   */
  #writing = false;
  #creating: Promise<unknown> = Promise.resolve();
  #settling = Promise.resolve();
  /** Counts gestures, so a selection placed late never outlives its own. */
  #gesture = 0;
  #pressedOnPage = false;
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
    // A tool change takes the stroke in progress with it.
    this.#surfaces.defer(
      deps.surfaceState.subscribe(
        ({ armed }) => armed,
        (armed) => {
          if (armed !== "ink") this.#discardStroke();
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
        // The image and ink tools take no text selection, so a selection made
        // under either waits in the popup as one made unarmed does.
        if (armed === "highlight" || armed === "underline") {
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
    if (event.key === "Escape") {
      if (this.#stepBack()) event.preventDefault();
      return;
    }
    if (!isEditGesture(event)) return;
    const key = event.key.toLowerCase();
    const tool: TextTool | null =
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
      if (waiting) this.#commit(textToolOf(armed), swatch);
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
    if (this.#state().armed === "ink") {
      if (!pinching) this.#beginStroke(event);
      return;
    }
    if (this.#state().armed !== "image") return;
    if (this.#capturing || this.#writing || onMark()) return;
    const client = { x: event.clientX, y: event.clientY };
    const page = this.#readerPageUnder(client);
    if (!page || this.#inSelection(client)) return;
    if (!editingLive(this.#capability())) {
      this.#deps.reportBlockedGesture();
      return;
    }
    // The press selects no text, and drops the selection that stood, as
    // Zotero's reader does before it draws a rectangle.
    event.preventDefault();
    this.#collapse();
    this.#deps.containerEl.setPointerCapture(event.pointerId);
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
    const capturing = this.#capturing;
    if (!capturing || event.pointerId !== capturing.pointerId) return;
    this.#capturing = releaseCapture(this.#deps.containerEl, this.#capturing);
    const rect = endCapture(this.#deps.surfaceState);
    if (!rect) return;
    this.#creating = this.#createImage(capturing.page.pageIndex, rect);
  }

  cancel(event: PointerEvent): void {
    if (event.pointerId === this.#capturing?.pointerId) this.#cancelCapture();
    if (event.pointerId === this.#stroke?.pointerId) this.#discardStroke();
  }

  get capturing(): boolean {
    return this.#capturing !== null || this.#stroke !== null;
  }

  [Symbol.dispose](): void {
    this.#gesture++;
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
   * One step back: an ink stroke or an image capture is taken back first, the
   * comment sheet closes, then the popup with its selection, then the armed
   * tool stands down.
   *
   * @returns whether a level was there to step back from.
   */
  #stepBack(): boolean {
    if (this.#stroke) {
      this.#discardStroke();
      return true;
    }
    const floating = this.#floating();
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
    switch (id) {
      case "highlight":
      case "underline":
      case "image":
      case "ink":
        this.#arm(this.#state().armed === id ? null : id);
        return;
      case "highlight-color":
        this.#openColorMenu("highlight", node);
        return;
      case "underline-color":
        this.#openColorMenu("underline", node);
        return;
      case "image-color":
        this.#openColorMenu("image", node);
        return;
      case "ink-color":
        this.#openColorMenu("ink", node);
        return;
      case "visibility":
        toggleMarks(this.#deps.surfaceState);
        this.#deps.repaint();
        return;
      default:
        return;
    }
  }

  /**
   * The tool's own colour list, under the chevron half of its split button,
   * and for the ink tool its pen widths below the colours. The toolbar sits at
   * the right of the reader's own toolbar, so the menu lines up with the
   * chevron's far edge and grows inward.
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
                const tool = textToolOf(this.#state().armed);
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
        const tool = textToolOf(this.#state().armed);
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
  #commit(type: TextTool, color: string): void {
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
   * gives its tool.
   *
   * @returns the created Annotation's Indexed Key, or `null` for a create
   *   that did not run or did not land.
   */
  async #create({
    type,
    color,
    comment,
    text,
    position,
  }: MarkDraft): Promise<string | null> {
    const structure = this.#deps.structure();
    // A blocked gesture is answered by the binding's own edit-gesture listener,
    // which hears every key of the shared edit keymap.
    if (!editingLive(this.#capability())) return null;
    if (!structure) {
      cancelCapture(this.#deps.surfaceState);
      logger.warn("No text structure stands for this PDF; nothing was created");
      new BaseNotice(
        m.pdf_create_failed({ reason: m.pdf_create_reason_no_document() }),
      );
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
      );
      if (outcome.kind === "failed") {
        new BaseNotice(
          m.pdf_create_failed({
            reason: writeFailureReason(outcome.failure, this.#deps.now()),
          }),
        );
        return null;
      }
      created = true;
      recordColorUse(this.#deps.surfaceState, this.#deps.colors, color);
      if (foreground) this.#deps.reveal(outcome.annotationKey);
      if (disarm) this.#arm(null);
      return outcome.annotationKey;
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
    const page = this.#readerPageUnder(client);
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
          { path, reason: "split" },
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
    releaseCapture(this.#deps.containerEl, stroke);
    this.#queueStroke(
      {
        pageIndex: stroke.page.pageIndex,
        width: stroke.width,
        // The colour the stroke was drawn in, whatever the tool took since.
        color: stroke.color,
      },
      { path: stroke.finish(), reason: "release" },
    );
  }

  /**
   * Holds a finished stroke on the page as a Pending Stroke, and queues its
   * create behind the ones finished before it: a stroke at its release, or the
   * part a long stroke finished at the position ceiling.
   */
  #queueStroke(
    stroke: Pick<PendingStroke, "pageIndex" | "width" | "color">,
    { path, reason }: { path: number[]; reason: "release" | "split" },
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
    this.#inking = this.#inking.then(() => this.#createInk(pending));
    this.#creating = this.#inking;
  }

  /**
   * One ink create; its Pending Stroke goes once Zotero answered, and a create
   * that made nothing says why. The capability can lapse while the stroke
   * waits behind the creates released before it. Never rejects.
   */
  async #createInk(pending: PendingStroke): Promise<void> {
    const { id, pageIndex, width, color, paths } = pending;
    let key: string | null = null;
    try {
      if (!editingLive(this.#capability())) {
        this.#deps.reportBlockedGesture();
        return;
      }
      key = await this.#create({
        type: "ink",
        color,
        comment: "",
        text: "",
        position: { pageIndex, width, paths },
      });
    } catch (error) {
      logger.warn("An ink stroke was not created", { error });
      new BaseNotice(
        m.pdf_create_failed({
          reason: m.annot_view_write_reason_unknown_outcome(),
        }),
      );
    } finally {
      if (key === null) dropPendingStroke(this.#deps.surfaceState, id);
      else settlePendingStroke(this.#deps.surfaceState, { id, key });
    }
  }

  /** Takes back the stroke in progress, drawing and creating nothing for it. */
  #discardStroke(): void {
    const stroke = this.#stroke;
    if (!stroke) return;
    this.#stroke = null;
    releaseCapture(this.#deps.containerEl, stroke);
    stroke[Symbol.dispose]();
    logger.debug("An ink stroke was discarded");
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
    hint: controls.hint ?? m.pdf_create_popup_comment_hint(),
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
