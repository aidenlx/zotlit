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
import { Menu } from "obsidian";
import type { HoverParent } from "obsidian";

import {
  ANNOTATION_COLORS,
  annotationColorLabel,
  isColor,
} from "@/lib/annotation-colors";
import { registerDomEvent } from "@/lib/disposables";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import * as toast from "@/lib/toast";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationRecord,
  AnnotationRepository,
} from "@/services/annotation-repository/service";
import { writeFailureMessage } from "@/services/annotation-repository/write";
import type { MutationState } from "@/services/annotation-repository/write";
import { editingLive } from "@/views/annot-view/card-controls";

import { inTextEntry } from "./capability-affordance";
import type { CreationGestures } from "./creation";
import {
  distance,
  markAnchor,
  pagePointOf,
  resolveMarkClick,
} from "./hit-test";
import type { HitPage, MarkSelectionPoint, PageBox, Point } from "./hit-test";
import { MarkPopup, markPopupRow, renderMarkPopupRow } from "./mark-popup";
import type { MarkPopupControlId } from "./mark-popup";
import { readingOrder, stepReadingOrder } from "./reading-order";
import { markTargets, pageUnitSize } from "./render";
import type { OverlayPageView, PdfPageAnnotation } from "./render";

/** What the selection reads and writes one Annotation through. */
export type AnnotationEdits = Pick<
  AnnotationRepository,
  "capabilityFor" | "deleteAnnotation" | "mutationFor" | "on" | "patchColor"
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
}

export interface MarkSelectionDeps {
  /** The PDF view's container: where the gestures are heard, and what scrolls. */
  containerEl: HTMLElement;
  /**
   * The popup's hover parent. It is the binding rather than the PDF view, so
   * Obsidian's Page Preview on that view keeps its own `hoverPopover`.
   */
  parent: HoverParent;
  /** The Attachment whose Annotations are on screen, by Indexed Key. */
  attachmentKey: string;
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
  gestures: MarkGestures;
  /**
   * The creation surfaces, which hear the same pointer, key and scroll gestures
   * this class already owns. One listener set serves both, so the selected mark
   * and a fresh text selection can never both have a popup open.
   *
   * @see https://github.com/aidenlx/zotlit/issues/1150
   */
  creation: CreationGestures | null;
  /** The clock a cooldown's remaining seconds are read against. */
  now: () => Temporal.Instant;
}

/**
 * One selected mark per PDF view, and one popup retargeted across marks rather
 * than rebuilt per mark.
 */
export class MarkSelection implements Disposable {
  readonly #deps;
  readonly #surfaces = new DisposableStack();
  #selected: string | null = null;
  /** Where the click that made the selection fell, which a repeat click steps from. */
  #at: MarkSelectionPoint | null = null;
  /** The marks under that point, smallest first, which the stepper walks. */
  #stack: readonly string[] = [];
  #popup: MarkPopup | null = null;
  #pressedAt: Point | null = null;

  constructor(deps: MarkSelectionDeps) {
    this.#deps = deps;
  }

  /** The Indexed Keys the overlay draws as selected. */
  get selected(): ReadonlySet<string> {
    return new Set(this.#selected === null ? [] : [this.#selected]);
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
      registerDomEvent(containerEl, "scroll", () => this.sync(), {
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
        if (this.#selected !== null && !this.#collapsed()) this.#apply(null);
        this.#deps.creation?.changed();
      }),
    );
    this.#surfaces.defer(
      this.#deps.annotations.on("capability-changed", () =>
        this.#popup?.refresh(),
      ),
    );
    this.#surfaces.defer(
      this.#deps.annotations.on("mutation-changed", (annotationKey) => {
        if (annotationKey === this.#selected) this.#popup?.refresh();
      }),
    );
    this.#surfaces.defer(() => this.#close());
  }

  /**
   * Take this Annotation as the selection, from a surface outside the reader —
   * a click on its card in the Annotation View.
   */
  select(annotationKey: string | null): void {
    this.#apply(annotationKey);
  }

  /**
   * The page moved or its marks were rebuilt: a selection whose Annotation is
   * gone stands down, and the popup follows whatever is left. A mark that
   * scrolled out of the reader hides the popup and keeps the selection.
   */
  sync(): void {
    this.#deps.creation?.sync();
    const key = this.#selected;
    if (key !== null && !this.#deps.records().some((one) => one.key === key)) {
      this.#apply(null);
      return;
    }
    const anchor = this.#anchor();
    if (!anchor) {
      this.#close();
      return;
    }
    if (this.#popup) {
      this.#popup.retarget(anchor);
      return;
    }
    const popup = new MarkPopup({
      parent: this.#deps.parent,
      anchor,
      render: (row) => this.#renderRow(row),
    });
    popup.register(() => {
      if (this.#popup === popup) this.#popup = null;
    });
    this.#popup = popup;
  }

  [Symbol.dispose](): void {
    this.#surfaces.dispose();
  }

  #close(): void {
    const popup = this.#popup;
    this.#popup = null;
    popup?.hide();
  }

  #apply(
    key: string | null,
    at: {
      pageIndex: number;
      point: Point;
      stack: readonly string[];
    } | null = null,
  ): void {
    this.#selected = key;
    this.#at =
      key !== null && at !== null
        ? { key, pageIndex: at.pageIndex, point: at.point }
        : null;
    this.#stack = at?.stack ?? (key === null ? [] : [key]);
    this.#deps.repaint();
    this.#deps.report(key === null ? [] : [key]);
    // A popup that was already open now stands over another mark, so it says
    // what that one offers; one this opened drew itself as it was built.
    const open = this.#popup;
    this.sync();
    if (open !== null && this.#popup === open) open.refresh();
  }

  #click(event: MouseEvent): void {
    const pressed = this.#pressedAt;
    this.#pressedAt = null;
    const client = { x: event.clientX, y: event.clientY };
    const page = this.#pageUnder(client);
    const outcome = resolveMarkClick({
      page,
      travel: pressed === null ? 0 : distance(pressed, client),
      collapsed: this.#collapsed(),
      onLink: linkUnder(event.target),
      altKey: event.altKey,
      previous: this.#at,
    });
    switch (outcome.kind) {
      case "ignore":
        return;
      case "deselect":
        if (this.#selected !== null) this.#apply(null);
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
        this.#selected,
        walk,
      );
      if (next === null) return;
      event.preventDefault();
      this.#apply(next);
      this.#deps.navigate(next);
      return;
    }
    const key = this.#selected;
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
    if (this.#selected === null) return;
    const target = event.target as Node | null;
    if (this.#deps.containerEl.contains(target)) return;
    if (this.#popup?.hoverEl.contains(target) === true) return;
    this.#apply(null);
  }

  #renderRow(row: HTMLElement): void {
    const annotation = this.#record();
    if (!annotation) return;
    const stack = this.#stack.indexOf(annotation.key);
    renderMarkPopupRow(
      row,
      markPopupRow({
        annotation,
        capability: this.#capability(),
        mutation: this.#deps.annotations.mutationFor(annotation.key),
        stack: {
          index: stack === -1 ? 0 : stack,
          total: stack === -1 ? 1 : this.#stack.length,
        },
        now: this.#deps.now(),
      }),
      (id, node) => this.#activate(id, node, annotation),
    );
  }

  #activate(
    id: MarkPopupControlId,
    node: HTMLElement,
    annotation: AnnotationRecord,
  ): void {
    const { annotations, gestures } = this.#deps;
    switch (id) {
      case "color":
        this.#colorMenu(annotation).showAtPosition(belowOf(node), node.doc);
        return;
      case "comment":
        gestures.revealAnnotation(annotation.key, { comment: true });
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
    const at = this.#at;
    if (at === null || this.#stack.length < 2) return;
    const next =
      this.#stack[(this.#stack.indexOf(at.key) + 1) % this.#stack.length]!;
    this.#apply(next, {
      pageIndex: at.pageIndex,
      point: at.point,
      stack: this.#stack,
    });
  }

  #colorMenu(annotation: AnnotationRecord): Menu {
    const menu = new Menu();
    for (const hex of ANNOTATION_COLORS) {
      menu.addItem((item) =>
        item
          .setTitle(annotationColorLabel(hex))
          .setChecked(isColor(annotation.color, hex))
          .onClick(() =>
            this.#write(this.#deps.annotations.patchColor(annotation.key, hex)),
          ),
      );
    }
    return menu;
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
    return this.#deps.annotations.capabilityFor(this.#deps.attachmentKey);
  }

  #record(): AnnotationRecord | null {
    const key = this.#selected;
    return this.#deps.records().find((record) => record.key === key) ?? null;
  }

  #collapsed(): boolean {
    return this.#deps.containerEl.win.getSelection()?.isCollapsed !== false;
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
   * Where the popup hangs: the bottom centre of the selected mark's union rect,
   * recomputed from the page as it stands now — a page re-render can wipe the
   * mark while the popup is open. `null` once the mark is off screen, which
   * hides the popup and keeps the selection.
   */
  #anchor(): Point | null {
    const key = this.#selected;
    if (key === null) return null;
    for (const [index, annotations] of this.#deps.marks()) {
      const drawn = annotations.filter(
        ({ annotation }) => annotation.key === key,
      );
      const page = drawn.length === 0 ? null : this.#deps.pageAt(index);
      if (!page) continue;
      const [target] = markTargets(page, drawn);
      const point = target && markAnchor(target.rects, pageBoxOf(page));
      if (point && this.#onScreen(point)) return point;
    }
    return null;
  }

  #onScreen({ x, y }: Point): boolean {
    const rect = this.#deps.containerEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return (
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    );
  }
}

/** Under the control, which is where Obsidian opens a menu from a button. */
function belowOf(node: HTMLElement): Point {
  const rect = node.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}

function pageBoxOf(page: OverlayPageView): PageBox {
  const rect = page.div.getBoundingClientRect();
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
