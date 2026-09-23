// Creating a highlight or an underline from a text selection in Obsidian's PDF
// reader: the Creation Toolbar's defaults, the Mark Popup in create mode, the
// keys that commit without the mouse, and the one command that writes.
//
// Two speeds of one commit path. Nothing armed: a settled selection opens the
// popup and one click commits. A tool armed from the toolbar: the selection
// commits at once in that tool's colour and the popup reopens on the new mark.
//
// @see https://github.com/aidenlx/zotlit/issues/1150
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
import { capabilityBlock, editingLive } from "@/views/annot-view/card-controls";

import { inTextEntry, isEditGesture } from "./capability-affordance";
import {
  createPopupRow,
  renderCommentSheet,
  renderCreatePopupRow,
} from "./create-popup";
import type { CreatePopupAction } from "./create-popup";
import {
  removeCreationToolbar,
  renderCreationToolbar,
} from "./creation-toolbar";
import type {
  CreationToolbarControl,
  CreationToolbarNodes,
} from "./creation-toolbar";
import type { Point } from "./hit-test";
import type { MarkPopupHost } from "./mark-popup-host";
import {
  arm,
  captureSelection,
  clearFloating,
  selectCreateRowInput,
  sameFlatList,
  selectCreationToolbar,
  setCommenting,
  setInFlight,
  setToolColor,
  toggleMarks,
} from "./reader-surface-state";
import type {
  AnchorAt,
  Floating,
  ReaderSurfaceState,
  ReaderSurfaceStore,
} from "./reader-surface-state";
import type { OverlayPageView } from "./render";
import { selectionPagesOf } from "./selection-capture";
import type { SelectionPage } from "./selection-capture";
import {
  colorMenu,
  onScreen,
  pageContentBox,
  selectionCollapsed,
} from "./surface";
import type { MarkTool, ToolColorStore } from "./tools";

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
}

export interface MarkCreationDeps {
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
  /** Draws the Editing Capability affordance into the toolbar's own slot. */
  renderCapability: (slot: HTMLElement) => void;
  /** Each tool's own colour, which is kept across PDFs rather than per view. */
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
  /** The comment sheet's editor, which holds the comment until the save. */
  #sheet: HTMLTextAreaElement | null = null;
  /**
   * Whether a create is waiting on Zotero, the armed tool's among them, so a
   * drag released meanwhile makes nothing.
   */
  #writing = false;
  #creating = Promise.resolve();
  #settling = Promise.resolve();
  /** Counts gestures, so a selection placed late never outlives its own. */
  #gesture = 0;
  #pressedOnPage = false;

  constructor(deps: MarkCreationDeps) {
    this.#deps = deps;
  }

  /**
   * Settles when the last create this surface started has run to its end.
   * Already settled while none has run. Never rejects.
   */
  get created(): Promise<void> {
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
        if (armed) {
          // The armed tool commits at once and opens no popup, so the
          // selection never floats.
          this.#creating = this.#create({
            type: armed,
            color: colors[armed],
            captured: placed.captured,
            comment: "",
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
    const tool =
      key === "h" ? "highlight" : key === "u" ? "underline" : (null as null);
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
      const target = this.#state().armed ?? "highlight";
      if (waiting) this.#commit(target, swatch);
      else if (live) this.#setColor(target, swatch);
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

  [Symbol.dispose](): void {
    this.#gesture++;
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
   * One step back: the comment sheet closes first, then the popup with its
   * selection, then the armed tool stands down.
   *
   * @returns whether a level was there to step back from.
   */
  #stepBack(): boolean {
    const floating = this.#floating();
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
        this.#arm(this.#state().armed === id ? null : id);
        return;
      case "highlight-color":
        this.#openColorMenu("highlight", node);
        return;
      case "underline-color":
        this.#openColorMenu("underline", node);
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
   * The tool's own colour list, under the chevron half of its split button.
   * The toolbar sits at the right of the reader's own toolbar, so the menu
   * lines up with the chevron's far edge and grows inward.
   */
  #openColorMenu(tool: MarkTool, node: HTMLElement): void {
    showMenuAtButton(
      colorMenu(this.#state().colors[tool], (hex) => this.#setColor(tool, hex)),
      node,
      "end",
    );
  }

  /**
   * The popup's row in create mode, for the popup host. Into an empty content
   * element it builds the row and, while commenting, the sheet; into the one it
   * built it redraws the row and leaves the sheet and its text standing.
   */
  renderPopup(content: HTMLElement): void {
    const input = selectCreateRowInput(this.#state());
    if (!input) return;
    const blocked =
      capabilityBlock(input.capability, input.now)?.reason ?? null;
    let built = false;
    if (!content.firstChild || !this.#row) {
      built = true;
      // The popup's own content element is the row in selected mode, so create
      // mode lays its row and its sheet out in a column of its own rather than
      // restyling what both modes share.
      const column = content.createDiv({
        cls: ["zt:flex", "zt:flex-col", "zt:gap-1"],
      });
      this.#row = column.createDiv({
        cls: ["zt:flex", "zt:items-center", "zt:gap-0.5"],
      });
      this.#sheet = input.commenting
        ? renderCommentSheet(column.createDiv(), {
            value: "",
            blocked,
            onSave: () => {
              const tool = this.#state().armed ?? "highlight";
              this.#commit(tool, this.#state().colors[tool]);
            },
            onCancel: () => setCommenting(this.#deps.surfaceState, false),
          })
        : null;
    }
    renderCreatePopupRow(this.#row, createPopupRow(input), (action) =>
      this.#activate(action),
    );
    const editor = this.#sheet;
    if (!editor) return;
    if (!built) {
      editor.readOnly = blocked !== null;
      const hint = editor.nextElementSibling;
      if (hint) hint.textContent = blocked ?? m.pdf_create_popup_comment_hint();
      return;
    }
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }

  #activate(action: CreatePopupAction): void {
    switch (action.kind) {
      case "tool":
        this.#commit(action.tool, this.#state().colors[action.tool]);
        return;
      case "color": {
        // A colour chosen in the popup becomes that tool's colour, so the
        // toolbar and the popup never disagree.
        const tool = this.#state().armed ?? "highlight";
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
  #commit(type: MarkTool, color: string): void {
    const floating = this.#floating();
    if (floating.kind !== "create" || this.#writing) return;
    this.#creating = this.#create({
      type,
      color,
      captured: floating.captured,
      comment: floating.commenting ? (this.#sheet?.value ?? "") : "",
    });
  }

  async #create({
    type,
    color,
    captured,
    comment,
  }: {
    type: MarkTool;
    color: string;
    captured: SelectedText;
    comment: string;
  }): Promise<void> {
    const structure = this.#deps.structure();
    // A blocked gesture is answered by the binding's own edit-gesture listener,
    // which hears every key of the shared edit keymap.
    if (!editingLive(this.#capability())) return;
    if (!structure) {
      logger.warn("No text structure stands for this PDF; nothing was created");
      return;
    }
    this.#writing = true;
    setInFlight(this.#deps.surfaceState, true);
    let created = false;
    try {
      const position = {
        pageIndex: captured.pageIndex,
        rects: captured.rects,
        ...(captured.nextPageRects && {
          nextPageRects: captured.nextPageRects,
        }),
      };
      const [sortIndex, pageLabel] = await Promise.all([
        structure.sortIndex(position),
        structure.pageLabel(
          captured.pageIndex,
          previousAnnotations(this.#deps.records()),
        ),
      ]);
      const outcome = await this.#deps.annotations.createAnnotation(
        this.#deps.attachmentKey,
        {
          type,
          color,
          comment,
          text: captured.text,
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
        return;
      }
      created = true;
      this.#deps.reveal(outcome.annotationKey);
    } finally {
      this.#writing = false;
      setInFlight(this.#deps.surfaceState, false);
      if (created) {
        this.#clear();
        this.#collapse();
      }
    }
  }

  /** The gesture is over: the popup, the sheet, and the selection all go. */
  #clear(): void {
    this.#row = null;
    this.#sheet = null;
    if (this.#floating().kind === "create")
      clearFloating(this.#deps.surfaceState);
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

  #pageUnder({ x, y }: Point): boolean {
    return this.#deps.pages().some(({ view }) => {
      const rect = view.div.getBoundingClientRect();
      return (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      );
    });
  }
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
