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
import type { Scope } from "obsidian";

import { ANNOTATION_COLORS } from "@/lib/annotation-colors";
import { registerDomEvent } from "@/lib/disposables";
import { bindEditorSubmitScope } from "@/lib/editor-scope";
import * as m from "@/lib/i18n/generated/messages";
import { showMenuAtButton } from "@/lib/menu";
import { BaseNotice } from "@/lib/notice";
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
import type { HeldDraftAction } from "@/views/annot-view/card-controls";

import { inTextEntry, isEditGesture } from "./capability-affordance";
import { renderCommentSheet } from "./create-popup";
import type { CreationGestures } from "./creation";
import {
  distance,
  markAnchor,
  pagePointOf,
  resolveMarkClick,
} from "./hit-test";
import type { HitPage, MarkSelectionPoint, PageBox, Point } from "./hit-test";
import { markPopupRow, renderMarkPopupRow } from "./mark-popup";
import type { MarkPopupControlId, MarkPopupRowInput } from "./mark-popup";
import type { MarkPopupHost } from "./mark-popup-host";
import {
  sameFlat,
  selectSelectedRowInput,
  selectFloatingHead,
  selectMark,
  selectSelectedDraft,
  selectSelectedKey,
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
import {
  colorMenu,
  onScreen,
  pageContentBox,
  selectionCollapsed,
} from "./surface";

/** What the selection reads and writes one Annotation through. */
export type AnnotationEdits = Pick<
  AnnotationRepository,
  | "commentDraftFor"
  | "deleteAnnotation"
  | "discardCommentDraft"
  | "editComment"
  | "patchColor"
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
  /** The PDF view's native key scope, active only while this editor is focused. */
  scope: Scope;
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
  #commentEditor: HTMLTextAreaElement | null = null;
  #commentEditorLife: DisposableStack | null = null;
  #pressedAt: Point | null = null;

  constructor(deps: MarkSelectionDeps) {
    this.#deps = deps;
  }

  /** The Indexed Keys the overlay draws as selected. */
  get selected(): ReadonlySet<string> {
    const key = this.#selectedKey();
    return new Set(key === null ? [] : [key]);
  }

  load(): void {
    const { containerEl } = this.#deps;
    this.#surfaces.use(
      registerDomEvent(containerEl, "pointerdown", (event) => {
        this.#pressedAt = { x: event.clientX, y: event.clientY };
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
      registerDomEvent(containerEl, "scroll", () => this.#deps.popup.sync(), {
        capture: true,
      }),
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
      this.#apply(null);
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
        this.#write(this.#deps.annotations.patchColor(key, swatch));
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
   * The popup's content in selected mode, for the popup host: the row, or the
   * comment editor while it is open. The editor is built into an empty content
   * element only; a refresh patches its controls and leaves its caret alone.
   */
  renderPopup(content: HTMLElement): void {
    const state = this.#state();
    const input = selectSelectedRowInput(state);
    if (!input) return;
    if (state.floating.kind === "selected" && state.floating.commenting) {
      if (!content.firstChild || !this.#commentEditor)
        this.#renderCommentEditor(content, input);
      else this.#updateCommentControls();
      return;
    }
    this.#closeCommentEditor();
    this.#renderRow(content, input);
  }

  #renderRow(content: HTMLElement, input: MarkPopupRowInput): void {
    const { annotation, mutation } = input;
    content.empty();
    const column = content.createDiv({
      cls: ["zt:flex", "zt:flex-col", "zt:gap-1"],
    });
    const row = column.createDiv({
      cls: ["zt:flex", "zt:items-center", "zt:gap-0.5"],
    });
    renderMarkPopupRow(row, markPopupRow(input), (id, node) =>
      this.#activate(id, node, annotation),
    );
    // The popup announces a held draft on the same rule the card does, and
    // carries the same verbs: the two surfaces reach one shared draft, so a
    // decision offered on one is offered on the other.
    const held = heldCommentDraft(
      this.#capability(),
      this.#deps.annotations.commentDraftFor(annotation.key),
      input.now,
    );
    if (held) {
      const preview = column.createDiv({
        cls: ["zt-pdf-comment-sheet", "zt:mt-2"],
      });
      preview.createDiv({
        cls: "zt:text-xs zt:text-muted-foreground",
        text: m.annot_view_comment_draft(),
      });
      preview.createDiv({
        cls: "zt:whitespace-pre-wrap zt:break-words zt:select-text",
        text: held.text,
      });
      if (held.reason !== null) {
        preview.createDiv({
          cls: "zt:text-xs zt:text-muted-foreground",
          attr: { role: "status" },
          text: held.reason,
        });
      }
      const verbs = preview.createDiv({
        cls: ["zt:flex", "zt:flex-wrap", "zt:gap-2", "zt:mt-2"],
      });
      for (const action of held.actions) {
        const button = verbs.createEl("button", {
          ...(action.primary && { cls: "mod-cta" }),
          text: action.label,
        });
        button.disabled = !action.enabled;
        button.addEventListener("click", () => {
          this.#runHeldDraftAction(action.kind, annotation);
        });
      }
    }
    if (
      mutation.kind === "conflict" &&
      mutation.conflict.write === "comment" &&
      this.#deps.annotations.commentDraftFor(annotation.key)
    ) {
      this.#renderCommentConflict(column, annotation, mutation.conflict);
    }
  }

  /** One verb from the held-draft panel, which both surfaces offer. */
  #runHeldDraftAction(
    kind: HeldDraftAction["kind"],
    annotation: AnnotationRecord,
  ): void {
    if (kind === "save") {
      this.#write(this.#deps.annotations.submitComment(annotation.key));
    } else if (kind === "allow-editing") {
      this.#deps.gestures.allowEditing();
    } else {
      this.#deps.annotations.discardCommentDraft(annotation.key);
    }
  }

  #renderCommentEditor(content: HTMLElement, input: MarkPopupRowInput): void {
    const { annotation } = input;
    const draft =
      selectSelectedDraft(this.#state()) ??
      this.#deps.annotations.editComment(annotation.key);
    if (!draft) {
      this.#closeCommentEditor();
      // Closed in the state too, so a later refresh does not try again.
      setCommenting(this.#deps.surfaceState, false);
      this.#renderRow(content, input);
      return;
    }
    this.#commentEditorLife?.[Symbol.dispose]();
    const life = new DisposableStack();
    this.#commentEditorLife = life;
    content.empty();
    const column = content.createDiv({
      cls: ["zt:flex", "zt:flex-col", "zt:gap-1"],
    });
    const editor = renderCommentSheet(column, {
      value: draft.text,
      onSave: (comment) => {
        this.#deps.annotations.editComment(annotation.key, comment);
        this.#write(this.#deps.annotations.submitComment(annotation.key));
      },
      onCancel: () => {
        this.#submitCommentEditor(annotation, true);
        setCommenting(this.#deps.surfaceState, false);
      },
      nativeSubmit: true,
    });
    editor.addEventListener("input", () => {
      this.#deps.annotations.editComment(annotation.key, editor.value);
    });
    this.#commentEditor = editor;
    const feedback = column.createDiv({
      cls: "zt:flex zt:flex-wrap zt:items-center zt:gap-2 zt:mt-2",
    });
    feedback.createSpan({
      cls: "zt:flex-1 zt:min-w-0 zt:text-xs zt:text-muted-foreground",
      attr: { "data-comment-status": "", role: "status" },
    });
    const save = feedback.createEl("button", {
      text: m.annot_view_comment_save(),
      attr: { "data-comment-save": "", type: "button" },
    });
    save.addEventListener("click", () => this.#submitCommentEditor(annotation));
    this.#updateCommentControls();
    life.use(
      bindEditorSubmitScope(editor, this.#deps.scope, () =>
        this.#submitCommentEditor(annotation),
      ),
    );
    life.use(
      registerDomEvent(editor, "blur", (event) => {
        const target = event.relatedTarget as Node | null;
        if (target?.instanceOf(Node) && column.contains(target)) return;
        const controls = commentEditorControls(
          this.#capability(),
          this.#deps.annotations.commentDraftFor(annotation.key),
          this.#state().capabilityAt,
        );
        if (controls.manual || controls.readOnly) return;
        this.#submitCommentEditor(annotation, true);
        setCommenting(this.#deps.surfaceState, false);
      }),
    );
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }

  #updateCommentControls(): void {
    const editor = this.#commentEditor;
    const annotation = this.#record();
    if (!editor || !annotation) return;
    const controls = commentEditorControls(
      this.#capability(),
      this.#deps.annotations.commentDraftFor(annotation.key),
      this.#state().capabilityAt,
    );
    editor.readOnly = controls.readOnly;
    const status = editor.parentElement?.querySelector<HTMLElement>(
      "[data-comment-status]",
    );
    if (status) status.textContent = controls.hint ?? "";
    const save = editor.parentElement?.querySelector<HTMLButtonElement>(
      "[data-comment-save]",
    );
    if (save) {
      save.toggle(controls.manual);
      save.disabled = controls.saveDisabled;
    }
  }

  #submitCommentEditor(annotation: AnnotationRecord, automatic = false): void {
    const editor = this.#commentEditor;
    if (!editor) return;
    this.#deps.annotations.editComment(annotation.key, editor.value);
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
    this.#commentEditorLife?.[Symbol.dispose]();
    this.#commentEditorLife = null;
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
    if (!draft || editor.value === draft.text) return;
    const { selectionStart, selectionEnd } = editor;
    editor.value = draft.text;
    editor.setSelectionRange(
      Math.min(selectionStart, draft.text.length),
      Math.min(selectionEnd, draft.text.length),
    );
  }

  #renderCommentConflict(
    content: HTMLElement,
    annotation: AnnotationRecord,
    conflict: Extract<MutationState, { kind: "conflict" }>["conflict"],
  ): void {
    const panel = conflictPanel(conflict);
    const box = content.createDiv({
      cls: ["zt:flex", "zt:flex-col", "zt:gap-1", "zt:px-2", "zt:pb-1"],
    });
    box.createDiv({ cls: "zt:font-medium", text: panel.title });
    for (const value of panel.values) {
      box.createDiv({ text: `${value.label}: ${value.value}` });
    }
    const actions = box.createDiv({
      cls: ["zt:flex", "zt:flex-wrap", "zt:gap-2", "zt:mt-2"],
    });
    for (const action of panel.actions) {
      const button = actions.createEl("button", {
        cls: "mod-cta",
        text: action.label,
      });
      button.disabled =
        action.kind !== "discard" && !editingLive(this.#capability());
      button.addEventListener("click", () => {
        if (action.kind === "apply-again") {
          this.#write(this.#deps.annotations.retryCommentDraft(annotation.key));
        } else {
          this.#deps.annotations.discardCommentDraft(annotation.key);
        }
      });
    }
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
            this.#write(annotations.patchColor(annotation.key, hex)),
          ),
          node,
        );
        return;
      case "comment":
        if (annotations.editComment(annotation.key))
          setCommenting(this.#deps.surfaceState, true);
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
