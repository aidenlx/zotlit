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

import type { PdfPosition } from "@zotlit/pdf-structure";

import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import { registerDomEvent } from "@/lib/disposables";
import * as m from "@/lib/i18n/generated/messages";
import { showMenuAtButton } from "@/lib/menu";
import { BaseNotice } from "@/lib/notice";
import { themeHook } from "@/lib/theme-hooks";
import * as toast from "@/lib/toast";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationRecord,
  AnnotationRepository,
  CommentDraft,
} from "@/services/annotation-repository/service";
import { writeFailureMessage } from "@/services/annotation-repository/write";
import type { MutationState } from "@/services/annotation-repository/write";
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
  gripAt,
  HANDLE_RADIUS,
  handleLayout,
  movesByBody,
  proposePosition,
} from "./geometry-edit";
import type { EditablePosition, PdfPoint } from "./geometry-edit";
import {
  distance,
  markAnchor,
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
import { markTargets, pageUnitSize } from "./render";
import type { OverlayPageView, PdfPageAnnotation } from "./render";
import { applyTransform, inverseTransform } from "./selection-capture";
import {
  colorMenu,
  onScreen,
  pageContentBox,
  selectionCollapsed,
} from "./surface";
import type { ToolColorStore } from "./tools";

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
  #adjusting = Promise.resolve();

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
      }),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "pointermove", (event) => {
        if (event.pointerId !== this.#dragging?.pointerId) return;
        this.#dragging.client = { x: event.clientX, y: event.clientY };
        this.#propose();
      }),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "pointerup", (event) => {
        if (event.pointerId === this.#dragging?.pointerId) this.#release();
      }),
    );
    // A drag on a grip moves the mark; the browser selects no text under it.
    this.#surfaces.use(
      registerDomEvent(containerEl, "selectstart", (event) => {
        if (this.#dragging) event.preventDefault();
      }),
    );
    this.#surfaces.use(
      registerDomEvent(containerEl, "pointercancel", (event) => {
        if (event.pointerId === this.#dragging?.pointerId) this.#cancelDrag();
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
   */
  select(
    annotationKey: string | null,
    { popup = true }: { popup?: boolean } = {},
  ): void {
    this.#apply(annotationKey, null, { popup });
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
    { popup = true }: { popup?: boolean } = {},
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

  #key(event: KeyboardEvent): void {
    // A modified keystroke belongs to Obsidian's own commands, and one inside a
    // text field belongs to the field.
    if (event.ctrlKey || event.metaKey || inTextEntry(event.target)) return;
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
    if (event.key === "Escape") {
      event.preventDefault();
      // Escape takes back a drag first, and the selection only after.
      if (this.#dragging) this.#cancelDrag();
      else this.#apply(null);
      return;
    }
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
    if (record.position.kind !== "pdf-rects") return;
    const page = this.#deps.pageAt(record.position.pageIndex);
    if (!page) return;
    const box = drawnBoxOf(page);
    const point = unitsOf(box, { x: event.clientX, y: event.clientY });
    const rect = record.position.rects[0];
    let body: [number, number, number, number] | null = null;
    if (rect && movesByBody(record.type)) {
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
      radius: (HANDLE_RADIUS * box.unitWidth) / box.width,
    });
    if (!grip) return;
    event.preventDefault();
    this.#deps.containerEl.setPointerCapture(event.pointerId);
    this.#dragging = {
      pointerId: event.pointerId,
      client: { x: event.clientX, y: event.clientY },
    };
    this.#pressedHandle = grip !== "body";
    beginAdjust(this.#deps.surfaceState, {
      grip,
      from: pdfPointOf(page, point),
    });
  }

  /** Proposes the position the held grip reaches at the pointer's last place. */
  #propose(): void {
    const record = this.#record();
    const adjust = selectAdjust(this.#state());
    const dragging = this.#dragging;
    if (!record || !adjust || !dragging) return;
    if (record.position.kind !== "pdf-rects") return;
    // Read on every move, so a scroll or a zoom mid-drag is measured against
    // the page as it now stands.
    const page = this.#deps.pageAt(record.position.pageIndex);
    if (!page) return;
    moveAdjust(
      this.#deps.surfaceState,
      proposePosition({
        confirmed: record.position,
        grip: adjust.grip,
        from: adjust.from,
        to: pdfPointOf(page, unitsOf(drawnBoxOf(page), dragging.client)),
        viewBox: page.viewport.viewBox,
      }),
    );
  }

  #release(): void {
    this.#releasePointer();
    const key = this.#selectedKey();
    const proposal = endAdjust(this.#deps.surfaceState);
    if (key !== null && proposal)
      this.#adjusting = this.#saveGeometry(key, proposal);
  }

  #cancelDrag(): void {
    this.#releasePointer();
    cancelAdjust(this.#deps.surfaceState);
  }

  #releasePointer(): void {
    const dragging = this.#dragging;
    this.#dragging = null;
    if (!dragging) return;
    this.#deps.containerEl.releasePointerCapture(dragging.pointerId);
  }

  /**
   * Saves a released proposal with the Sort Index recomputed from it. The mark
   * draws the proposal until the write settles: a saved one then draws the
   * record Zotero answered, and any other snaps back to the confirmed record,
   * with a failure told at the notice seam.
   */
  async #saveGeometry(key: string, proposal: EditablePosition): Promise<void> {
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
    });
    this.#write(outcome);
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
   * @see apps/obsidian/policies/ui-seams.md
   */
  #write(outcome: Promise<MutationState>): void {
    void outcome.then((state) => {
      if (state.kind !== "failed") return;
      new BaseNotice(writeFailureMessage(state.failure, this.#deps.now()));
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

function pageBoxOf(page: OverlayPageView): PageBox {
  const rect = pageContentBox(page.div);
  const unit = pageUnitSize(page);
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    unitWidth: unit.width,
    unitHeight: unit.height,
  };
}

/**
 * The page as the overlay is laid out on it, which is what a drag has to track
 * to the pixel. The page's border widths are rounded to whole pixels, so the
 * box inside them can be a pixel off the overlay's; the page box stands in
 * while no overlay is drawn.
 */
function drawnBoxOf(page: OverlayPageView): PageBox {
  const box = pageBoxOf(page);
  const overlay = page.div.querySelector(`.${themeHook.pdfAnnotationOverlay}`);
  if (!overlay) return box;
  const { left, top, width, height } = overlay.getBoundingClientRect();
  return { ...box, left, top, width, height };
}

/**
 * Where a client point falls on a page, in the page's own units, however far
 * outside the page a drag has carried it.
 */
function unitsOf(box: PageBox, client: Point): Point {
  return {
    x: ((client.x - box.left) * box.unitWidth) / box.width,
    y: ((client.y - box.top) * box.unitHeight) / box.height,
  };
}

/**
 * A PDF point in the page's own units: the viewport's transform read at scale
 * 1, which is the scale the overlay's units are measured at.
 */
function unitPointOf(page: OverlayPageView, [x, y]: PdfPoint): Point {
  const { transform, scale } = page.viewport;
  const [px, py] = applyTransform(transform, x, y);
  return { x: px / scale, y: py / scale };
}

/** The inverse of {@link unitPointOf}. */
function pdfPointOf(page: OverlayPageView, { x, y }: Point): PdfPoint {
  const { transform, scale } = page.viewport;
  return applyTransform(inverseTransform(transform)!, x * scale, y * scale);
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
