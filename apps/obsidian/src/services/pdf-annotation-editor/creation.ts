// Creating a highlight or an underline from a text selection in Obsidian's PDF
// reader: the Creation Toolbar's defaults, the Mark Popup in create mode, the
// keys that commit without the mouse, and the one command that writes.
//
// Two speeds of one commit path. Nothing armed: a settled selection opens the
// popup and one click commits. A tool armed from the toolbar: the selection
// commits at once in that tool's colour and the popup reopens on the new mark.
//
// @see https://github.com/aidenlx/zotlit/issues/1150
import type { HoverParent } from "obsidian";

import type { PdfTextStructure } from "@zotlit/pdf-structure";

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
import { editingLive } from "@/views/annot-view/card-controls";

import { inTextEntry, isEditGesture } from "./capability-affordance";
import {
  createPopupRow,
  renderCommentSheet,
  renderCreatePopupRow,
} from "./create-popup";
import type { CreatePopupAction } from "./create-popup";
import {
  creationToolbar,
  removeCreationToolbar,
  renderCreationToolbar,
} from "./creation-toolbar";
import type { CreationToolbarNodes } from "./creation-toolbar";
import type { Point } from "./hit-test";
import { MarkPopup } from "./mark-popup";
import type { OverlayPageView } from "./render";
import { captureSelection, selectionPagesOf } from "./selection-capture";
import type { CapturedSelection, SelectionPage } from "./selection-capture";
import { colorMenu, onScreen, selectionCollapsed } from "./surface";
import type { AnnotationTool, MarkTool, ToolColorStore } from "./tools";

const logger = getLogger("pdf-annotation-editor");

/** One page of the reader, as selection capture and the anchor read it. */
export interface ReaderPage {
  pageIndex: number;
  view: OverlayPageView;
}

/** What the creation surfaces write Annotations through. */
export type AnnotationCreates = Pick<
  AnnotationRepository,
  "capabilityFor" | "createAnnotation" | "on"
>;

/**
 * The gestures the reader's own listeners hand to the creation surfaces. One
 * listener set serves both the selected mark and the fresh selection, so the
 * two floating surfaces can never both be open.
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
  /** The pages moved, so the popup re-hangs from where the selection now sits. */
  sync: () => void;
}

export interface MarkCreationDeps {
  /** The PDF view's container: what scrolls, and what the gestures come from. */
  containerEl: HTMLElement;
  /** The popup's hover parent, which is the binding rather than the PDF view. */
  parent: HoverParent;
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
  #armed: MarkTool | null = null;
  #marksVisible = true;
  /** The reader's right toolbar slot, once the toolbar is mounted into it. */
  #slot: HTMLElement | null = null;
  #popup: MarkPopup | null = null;
  /** The settled selection the popup is acting on; `null` while none is. */
  #captured: CapturedSelection | null = null;
  /** Where the popup hangs, as a fraction of its page box, so a zoom keeps it. */
  #anchorAt: { pageIndex: number; fx: number; fy: number } | null = null;
  #commenting = false;
  #comment = "";
  #inFlight = false;
  #creating = Promise.resolve();
  #pressedOnPage = false;

  constructor(deps: MarkCreationDeps) {
    this.#deps = deps;
  }

  /** Whether the Annotation Marks are drawn over the pages. */
  get marksVisible(): boolean {
    return this.#marksVisible;
  }

  /**
   * Settles when the last create this surface started has run to its end.
   * Already settled while none has run. Never rejects.
   */
  get created(): Promise<void> {
    return this.#creating;
  }

  /**
   * Draws the Creation Toolbar into the reader's right toolbar slot and keeps
   * it in step with the Editing Capability. The slot is emptied again by this
   * object's disposal, and the removal is idempotent because Obsidian's own
   * `empty()` on unload may have cleared it first.
   *
   * @returns the toolbar's nodes, so the caller can draw into its capability slot.
   */
  mountToolbar(slot: HTMLElement): CreationToolbarNodes {
    this.#slot = slot;
    this.#surfaces.defer(() => {
      this.#slot = null;
      removeCreationToolbar(slot);
    });
    this.#surfaces.defer(
      this.#deps.annotations.on("capability-changed", () => {
        this.#drawToolbar();
        this.#popup?.refresh();
      }),
    );
    const nodes = renderCreationToolbar(slot, this.#model(), (id, node) =>
      this.#toolbarActivate(id, node),
    );
    this.#deps.renderCapability(nodes.capabilitySlot);
    return nodes;
  }

  press(event: PointerEvent): void {
    const inPopup =
      this.#popup?.hoverEl.contains(event.target as Node) === true;
    // The press that follows a settled selection dismisses its popup, wherever
    // it lands — the popup is only ever opened from a release.
    if (!inPopup) this.#clear();
    this.#pressedOnPage =
      !inPopup && this.#pageUnder({ x: event.clientX, y: event.clientY });
  }

  settle(): void {
    const onPage = this.#pressedOnPage;
    this.#pressedOnPage = false;
    if (!onPage || this.#inFlight) return;
    const captured = this.#capture();
    if (!captured) return;
    this.#captured = captured;
    const armed = this.#armed;
    if (armed) {
      this.#commit(armed, this.#colors()[armed]);
      return;
    }
    this.#open();
  }

  changed(): void {
    // The comment sheet takes focus, which collapses the window selection; the
    // geometry the popup is acting on was captured when the drag ended.
    if (this.#commenting || this.#inFlight) return;
    if (this.#captured !== null && selectionCollapsed(this.#deps.containerEl))
      this.#clear();
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
    const waiting = this.#captured !== null;

    // Arming a tool and colouring one move controls the block has already
    // disabled, so under a block they stand still: the binding's own notice is
    // the whole answer, and a toolbar that moved with it would contradict it.
    const live = editingLive(this.#capability());
    if (tool !== null) {
      event.preventDefault();
      if (waiting) this.#commit(tool, this.#colors()[tool]);
      else if (live) this.#arm(this.#armed === tool ? null : tool);
      return;
    }
    if (swatch !== undefined) {
      event.preventDefault();
      const target = this.#armed ?? "highlight";
      if (waiting) this.#commit(target, swatch);
      else if (live) this.#setColor(target, swatch);
      return;
    }
    if (key !== "c" || !waiting) return;
    event.preventDefault();
    this.#setCommenting(true);
  }

  sync(): void {
    if (!this.#popup) return;
    const anchor = this.#anchor();
    if (anchor) this.#popup.retarget(anchor);
    else this.#clear();
  }

  [Symbol.dispose](): void {
    this.#closePopup();
    this.#surfaces.dispose();
  }

  /** The tool the toolbar shows as armed, or `null` while none is. */
  #arm(tool: MarkTool | null): void {
    this.#armed = tool;
    this.#drawToolbar();
    this.#popup?.refresh();
  }

  #setColor(tool: MarkTool, color: string): void {
    this.#deps.colors.set(tool, color);
    this.#drawToolbar();
    this.#popup?.refresh();
  }

  /** Every tool's colour as it now stands, which is a settings read. */
  #colors(): Readonly<Record<AnnotationTool, string>> {
    return this.#deps.colors.current();
  }

  /**
   * One step back: the comment sheet closes first, then the popup with its
   * selection, then the armed tool stands down.
   *
   * @returns whether a level was there to step back from.
   */
  #stepBack(): boolean {
    if (this.#commenting) {
      this.#setCommenting(false);
      return true;
    }
    if (this.#captured !== null) {
      this.#clear();
      return true;
    }
    if (this.#armed === null) return false;
    this.#arm(null);
    return true;
  }

  #setCommenting(open: boolean): void {
    this.#commenting = open;
    if (!open) this.#comment = "";
    this.#popup?.refresh();
  }

  #toolbarActivate(id: string, node: HTMLElement): void {
    switch (id) {
      case "highlight":
      case "underline":
        this.#arm(this.#armed === id ? null : id);
        return;
      case "highlight-color":
        this.#openColorMenu("highlight", node);
        return;
      case "underline-color":
        this.#openColorMenu("underline", node);
        return;
      case "visibility":
        this.#marksVisible = !this.#marksVisible;
        this.#drawToolbar();
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
      colorMenu(this.#colors()[tool], (hex) => this.#setColor(tool, hex)),
      node,
      "end",
    );
  }

  #drawToolbar(): void {
    const slot = this.#slot;
    if (!slot) return;
    renderCreationToolbar(slot, this.#model(), (id, node) =>
      this.#toolbarActivate(id, node),
    );
  }

  #model() {
    return creationToolbar({
      armed: this.#armed,
      colors: this.#colors(),
      marksVisible: this.#marksVisible,
      capability: this.#capability(),
      now: this.#deps.now(),
    });
  }

  /** The popup in create mode, over the selection this gesture settled on. */
  #open(): void {
    const anchor = this.#anchor();
    if (!anchor) return;
    if (this.#popup) {
      this.#popup.retarget(anchor);
      this.#popup.refresh();
      return;
    }
    const popup = new MarkPopup({
      parent: this.#deps.parent,
      anchor,
      render: (content) => this.#renderPopup(content),
    });
    popup.register(() => {
      if (this.#popup === popup) this.#popup = null;
    });
    this.#popup = popup;
  }

  #renderPopup(content: HTMLElement): void {
    content.empty();
    // The popup's own content element is the row in selected mode, so create
    // mode lays its row and its sheet out in a column of its own rather than
    // restyling what both modes share.
    const column = content.createDiv({
      cls: ["zt:flex", "zt:flex-col", "zt:gap-1"],
    });
    const row = column.createDiv({
      cls: ["zt:flex", "zt:items-center", "zt:gap-0.5"],
    });
    renderCreatePopupRow(
      row,
      createPopupRow({
        armed: this.#armed,
        colors: this.#colors(),
        capability: this.#capability(),
        mutation: this.#inFlight ? { kind: "pending" } : { kind: "idle" },
        commenting: this.#commenting,
        now: this.#deps.now(),
      }),
      (action) => this.#activate(action),
    );
    if (!this.#commenting) return;
    const editor = renderCommentSheet(column.createDiv(), {
      value: this.#comment,
      onSave: (comment) => {
        this.#comment = comment;
        const tool = this.#armed ?? "highlight";
        this.#commit(tool, this.#colors()[tool]);
      },
      onCancel: () => this.#setCommenting(false),
    });
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }

  #activate(action: CreatePopupAction): void {
    switch (action.kind) {
      case "tool":
        this.#commit(action.tool, this.#colors()[action.tool]);
        return;
      case "color": {
        // A colour chosen in the popup becomes that tool's colour, so the
        // toolbar and the popup never disagree.
        const tool = this.#armed ?? "highlight";
        this.#setColor(tool, action.color);
        this.#commit(tool, action.color);
        return;
      }
      case "comment":
        this.#setCommenting(!this.#commenting);
        return;
      case "copy": {
        const text = this.#captured?.text;
        if (text === undefined) return;
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
    if (this.#inFlight) return;
    this.#creating = this.#create(type, color);
  }

  async #create(type: MarkTool, color: string): Promise<void> {
    const captured = this.#captured;
    const structure = this.#deps.structure();
    if (!captured) return;
    // A blocked gesture is answered by the binding's own edit-gesture listener,
    // which hears every key of the shared edit keymap.
    if (!editingLive(this.#capability())) return;
    if (!structure) {
      logger.warn("No text structure stands for this PDF; nothing was created");
      return;
    }
    this.#inFlight = true;
    this.#popup?.refresh();
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
          comment: this.#comment,
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
      this.#inFlight = false;
      if (created) {
        this.#clear();
        this.#collapse();
      } else {
        this.#popup?.refresh();
      }
    }
  }

  /** The gesture is over: the popup, the sheet, and the selection all go. */
  #clear(): void {
    this.#captured = null;
    this.#anchorAt = null;
    this.#commenting = false;
    this.#comment = "";
    this.#closePopup();
  }

  #closePopup(): void {
    const popup = this.#popup;
    this.#popup = null;
    popup?.hide();
  }

  /** Drops the window selection, as Zotero's reader does once a mark is made. */
  #collapse(): void {
    this.#deps.containerEl.win.getSelection()?.removeAllRanges();
  }

  #capability(): EditingCapability {
    return this.#deps.annotations.capabilityFor(this.#deps.attachmentKey);
  }

  /**
   * What the live window selection quotes, with the anchor the popup hangs
   * from recorded beside it. `null` for a selection this reader cannot place.
   */
  #capture(): CapturedSelection | null {
    const range = this.#range();
    if (!range) return null;
    const pages = selectionPagesOf(range, this.#deps.pages());
    const captured = captureSelection(pages);
    if (!captured) return null;
    this.#anchorAt = anchorFractionOf(pages, captured.pageIndex);
    return captured;
  }

  #range(): Range | null {
    const selection = this.#deps.containerEl.win.getSelection();
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
      return null;
    }
    return selection.getRangeAt(0);
  }

  /**
   * Where the popup hangs: the bottom centre of the selection's own boxes,
   * measured against the page as it now stands, so a zoom or a re-render moves
   * the popup with the text. `null` once the page is off screen.
   */
  #anchor(): Point | null {
    const at = this.#anchorAt;
    const page =
      at &&
      this.#deps.pages().find(({ pageIndex }) => pageIndex === at.pageIndex);
    if (!at || !page) return null;
    const rect = page.view.div.getBoundingClientRect();
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
 * selection's boxes on the page the Annotation is filed under.
 */
function anchorFractionOf(
  pages: readonly SelectionPage[],
  pageIndex: number,
): { pageIndex: number; fx: number; fy: number } | null {
  const page = pages.find((one) => one.pageIndex === pageIndex);
  if (!page || page.rects.length === 0) return null;
  const width = page.box.right - page.box.left;
  const height = page.box.bottom - page.box.top;
  if (width <= 0 || height <= 0) return null;
  const left = Math.min(...page.rects.map((rect) => rect.left));
  const right = Math.max(...page.rects.map((rect) => rect.right));
  const bottom = Math.max(...page.rects.map((rect) => rect.bottom));
  return {
    pageIndex,
    fx: ((left + right) / 2 - page.box.left) / width,
    fy: (bottom - page.box.top) / height,
  };
}
