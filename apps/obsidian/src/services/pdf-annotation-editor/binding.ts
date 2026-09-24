// One open Obsidian PDF view bound to the Zotero attachment it shows.
import { Platform } from "obsidian";
import type {
  FileSystemAdapter,
  HoverParent,
  HoverPopover,
  PDFDocumentProxy,
  PDFFileView,
  PDFPageRenderedListener,
  PDFPageView,
  PDFViewerController,
} from "obsidian";

import { PdfTextStructure } from "@zotlit/pdf-structure";
import type {
  PdfPosition,
  RangeAdjustment,
  SelectedText,
} from "@zotlit/pdf-structure";

import { EXTERNAL_FILE_PREFIX } from "@/lib/constants";
import {
  registerDomEvent,
  registerMigratingWindowEvent,
} from "@/lib/disposables";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { themeAttribute } from "@/lib/theme-hooks";
import type { HistorySurface } from "@/services/annotation-repository/actions";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type { CapabilityAffordance } from "@/services/annotation-repository/capability-copy";
import type {
  AnnotationRecord,
  AnnotationRepository,
  HistoryDirection,
} from "@/services/annotation-repository/service";
import { writeFailureMessage } from "@/services/annotation-repository/write";
import type {
  AttachmentResolution,
  AttachmentResolver,
} from "@/services/attachment-resolver/service";
import type { BorrowedExcerptDocument } from "@/services/excerpt-image/reader-borrow";
import { ReaderSessionHost } from "@/services/reader-session/session";
import type { ReaderSession } from "@/services/reader-session/session";
import { editingLive } from "@/views/annot-view/card-controls";

import { dropPendingAnchor, peekPendingAnchor } from "./anchor-capture";
import { borrowReaderDocument } from "./borrow";
import {
  isEditGesture,
  removeCapabilityAffordance,
  renderCapabilityAffordance,
} from "./capability-affordance";
import { MarkCreation } from "./creation";
import type { ReaderPage } from "./creation";
import { isRangeGrip, rangeHandles } from "./geometry-edit";
import type { TextRotation } from "./geometry-edit";
import { decideMarkLanding } from "./mark-landing";
import type { MarkLandingMiss, MarkLandingTarget } from "./mark-landing";
import { MarkPopupHost } from "./mark-popup-host";
import { mountReaderKeymap } from "./reader-keymap";
import {
  createReaderSurfaceState,
  ingestAnnotations,
  ingestCapability,
  listenAnnotationEvents,
  sameCapability,
  sameFlat,
  selectAdjust,
  selectCapabilityAffordance,
  selectCapture,
  selectSelectedKey,
  selectTextDraft,
} from "./reader-surface-state";
import type { Adjustment, ReaderSurfaceStore } from "./reader-surface-state";
import {
  groupAnnotationsByPage,
  interfaceFont,
  patchSelectedMark,
  renderAnnotationOverlay,
  renderCapture,
  renderLiveStroke,
  scrollMarkIntoView,
  withPosition,
} from "./render";
import type { PdfPageAnnotation } from "./render";
import {
  loadedPageOf,
  onPageRendered,
  openFilePathOf,
  pageViewOf,
  pdfDocumentOf,
  PdfSeamProbeLog,
  probeController,
  probeFileView,
  probePageView,
  probeRenderEvent,
  probeTextContent,
  renderedPagesOf,
  toolbarSlotOf,
  whenViewerReady,
} from "./seam";
import type { PdfSeamProbeResult } from "./seam";
import { MarkSelection } from "./selection";
import type { MarkGestures } from "./selection";
import {
  createTextDraftArea,
  placeTextDraft,
  removeTextDraftArea,
} from "./text-draft";
import { pdfPageSource } from "./text-structure";
import type { MarkTool, ToolColorStore } from "./tools";

const logger = getLogger("pdf-annotation-editor");

/**
 * The Landing misses a later answer can still turn into a Mark, so the Anchor
 * stays on its leaf through them. Every other miss is final.
 */
const KEPT_MISSES = new Set<MarkLandingMiss>([
  "attachment-pending",
  "annotations-pending",
]);

/** How often the affordance is redrawn while Zotero's rate limit runs. */
const COUNTDOWN_INTERVAL = Temporal.Duration.from({ seconds: 1 });

/**
 * What a binding reads Annotations and their Editing Capability through, and
 * hears both of their changes on.
 */
export type AnnotationReads = Pick<
  AnnotationRepository,
  | "capability"
  | "capabilityFor"
  | "closeHistory"
  | "commentDraftFor"
  | "createAnnotation"
  | "deleteAnnotation"
  | "discardCommentDraft"
  | "editComment"
  | "mutationFor"
  | "on"
  | "openHistory"
  | "patchColor"
  | "patchGeometry"
  | "probe"
  | "read"
  | "redo"
  | "refresh"
  | "retryCommentDraft"
  | "submitComment"
  | "undo"
>;

/** What a binding names its Attachment through, and hears a re-resolution on. */
export type AttachmentReads = Pick<AttachmentResolver, "resolve" | "on">;

/**
 * The two gestures the Editing Capability affordance drives, which render and
 * decide nothing themselves — the UI seam owns both answers.
 *
 * @see apps/obsidian/policies/ui-seams.md
 */
export interface CapabilityGestures {
  /**
   * An edit gesture met a block on this Attachment, with a fresh probe already
   * behind it. The seam says why, once per reason per capability episode.
   */
  reportBlockedGesture: (attachmentKey: string) => void;
  /** Ask Zotero for editing again, from a gesture that names the grant itself. */
  allowEditing: () => void;
}

export interface PdfViewBindingDeps {
  view: PDFFileView;
  adapter: FileSystemAdapter;
  attachments: AttachmentReads;
  annotations: AnnotationReads;
  capabilityGestures: CapabilityGestures;
  /**
   * The one gesture the Mark Popup reaches outside the reader's own surfaces;
   * a block it meets is answered by the binding's own edit-gesture path.
   */
  markGestures: Pick<MarkGestures, "revealAnnotation">;
  /** Each annotation tool's own colour, which every open PDF view shares. */
  toolColors: ToolColorStore;
  /** The clock the affordance's cooldown countdown is read against. */
  now?: () => Temporal.Instant;
}

/**
 * Runs the seam probes for one PDF view, resolves the file it shows, and holds
 * every listener and node the reader surfaces add, so a file switch, a closed
 * leaf, and plugin unload each remove all of them.
 *
 * A probe miss fails closed to the reader surfaces alone: the attachment still
 * resolves, and the annotation repository, the attachment resolver, and the
 * Annotation View never see the difference.
 */
export class PdfViewBinding implements Disposable, HistorySurface, HoverParent {
  /**
   * The Mark Popup hangs off the binding rather than off the PDF view, so
   * Obsidian's Page Preview on that view keeps its own popover and neither
   * closes the other.
   */
  hoverPopover: HoverPopover | null = null;
  readonly #view;
  readonly #adapter;
  readonly #attachments;
  readonly #annotations;
  readonly #gestures;
  readonly #markGestures;
  readonly #toolColors;
  readonly #now;
  readonly #probes = new PdfSeamProbeLog(() => this.filePath);
  /**
   * This view as a reader: what it holds and what is selected in it. ZotLit
   * owns the selection here, so a consumer's `setSelectedAnnotations` is taken
   * by the selection itself, which paints it and reports it back.
   */
  readonly #session = new ReaderSessionHost({
    source: "obsidian-pdf",
    navigate: (annotationKey) => this.#navigate(annotationKey),
    select: (annotationKeys) =>
      this.#selection?.select(annotationKeys[0] ?? null),
  });
  /** Every listener and node this binding added for this view. */
  readonly #surfaces = new DisposableStack();
  /** The pages this binding currently holds an overlay on. */
  readonly #painted = new Set<number>();
  /** The page an image capture's rectangle was last drawn on. */
  #capturedOn: number | null = null;
  /** The page the Live Stroke was last drawn on. */
  #strokeOn: number | null = null;
  /** The Text Draft's textarea, kept across page renders; `null` while none stands. */
  #draftArea: HTMLTextAreaElement | null = null;
  /** The pages the selected mark's last in-place redraw drew it on. */
  #patchedOn: { key: string; pages: ReadonlySet<number> } | null = null;
  #attachment: AttachmentResolution = { kind: "pending" };
  #filePath: string | null = null;
  #absolutePath: string | null = null;
  #pageProbed = false;
  #probing = Promise.resolve();
  #controller: PDFViewerController | null = null;
  #marks: ReadonlyMap<number, readonly PdfPageAnnotation[]> = new Map();
  #records: readonly AnnotationRecord[] = [];
  /** Whether a read of this Attachment's Annotations has answered yet. */
  #read = false;
  /** The selected Annotation Mark of this view; `null` until one can be made. */
  #selection: MarkSelection | null = null;
  /**
   * The Mark an Annotation Anchor asked for, waiting on the page it sits on to
   * render. `null` while no Landing is in flight.
   */
  #landing: MarkLandingTarget | null = null;
  /** The frame a Landing's scroll is waiting on; `null` while none is. */
  #landingFrame: number | null = null;
  /** The creation surfaces of this view; `null` until they can be mounted. */
  #creation: MarkCreation | null = null;
  /** The one Mark Popup of this view; `null` until the surfaces are mounted. */
  #popupHost: MarkPopupHost | null = null;
  /** What the reader surfaces draw from; `null` until they are mounted. */
  #surfaceState: ReaderSurfaceStore | null = null;
  /**
   * This Reader Session's Structured Characters, memoized per page beside the
   * document they were read from. The view opens its document after the
   * binding attached when its tab is hidden, and reopens a new document proxy
   * in place on a vault modify and a pop-out migration, so the memo is read
   * against the live document on every ask and rebuilt once that changed.
   *
   * @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
   */
  #held: {
    document: PDFDocumentProxy;
    structure: PdfTextStructure;
    /** The Page Label pass, scheduled in idle time on `win`. */
    idle: number;
    win: Window;
  } | null = null;
  /**
   * The text rotation under a rect, read from the Structured Characters the
   * document's structure already holds. A page it has not structured reads as
   * upright until it has, and the selection of a text range asks for it.
   */
  readonly #textRotation: TextRotation = (pageIndex, rect) =>
    this.#held?.structure.textRotation(pageIndex, rect) ?? 0;
  #refreshing = Promise.resolve();
  /** Serialises the refreshes, so a slower read never overwrites a later one. */
  #refreshSerial = 0;
  /** Redraws the Editing Capability affordance; a no-op until one is mounted. */
  #drawCapability: (affordance: CapabilityAffordance | null) => void = () =>
    undefined;
  /** The Creation Toolbar's own slot for the affordance; `null` until mounted. */
  #capabilitySlot: HTMLElement | null = null;
  #toolbarMounted = false;
  #gesturing = Promise.resolve();
  /** The Annotation History press this view is answering; settled while none is. */
  #stepping = Promise.resolve();

  constructor({
    view,
    adapter,
    attachments,
    annotations,
    capabilityGestures,
    markGestures,
    toolColors,
    now = () => Temporal.Now.instant(),
  }: PdfViewBindingDeps) {
    this.#view = view;
    this.#adapter = adapter;
    this.#attachments = attachments;
    this.#annotations = annotations;
    this.#gestures = capabilityGestures;
    this.#markGestures = markGestures;
    this.#toolColors = toolColors;
    this.#now = now;
  }

  /**
   * The file this binding loaded, as its vault path or its `file:`-prefixed
   * absolute path. Snapshotted, so the owner can tell a view that swapped files
   * from one still showing what it bound.
   */
  get filePath(): string | null {
    return this.#filePath;
  }

  /** The open file's absolute path; `null` while the view holds no file. */
  get absolutePath(): string | null {
    return this.#absolutePath;
  }

  /**
   * What the open file names in Zotero. `pending` until the resolver can
   * answer — a binding built while the database is still loading holds that,
   * and takes the answer the resolver announces.
   */
  get attachment(): AttachmentResolution {
    return this.#attachment;
  }

  /**
   * The Attachment whose Annotation History this view steps, which is the one
   * it shows; `null` while the file it holds names none in Zotero.
   */
  get historyAttachment(): string | null {
    return this.#attachment.kind === "resolved"
      ? this.#attachment.attachmentKey
      : null;
  }

  /** This PDF view as a Reader Session, for a surface that follows a reader. */
  get session(): ReaderSession {
    return this.#session;
  }

  /**
   * This view's open document, as excerpt work may borrow it instead of loading
   * the file again. `null` while no document stands — a view whose file Zotero
   * does not know, one still loading its PDF, and one whose viewer closed all
   * answer `null`, and the caller renders detached from the file instead.
   *
   * The reader keeps ownership of the document, its pages, and its visible
   * render tasks; the borrow reads a page and starts its own render task on its
   * own canvas.
   *
   * @see apps/obsidian/docs/adr/0054-reader-and-detached-excerpts-share-cache-publication.md
   */
  borrow(): BorrowedExcerptDocument | null {
    return borrowReaderDocument({
      controller: () => this.#controller,
      path: this.#absolutePath,
    });
  }

  /**
   * The Sort Index Zotero's reader would give this position in the open
   * document — the call a creation makes, and the one a Geometry Edit makes
   * again for the position it moved to.
   *
   * @param position unrounded, as the gesture computed it.
   * @returns `null` while no document is open.
   * @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
   */
  async sortIndex(position: PdfPosition): Promise<string | null> {
    const structure = this.#structure();
    return structure ? await structure.sortIndex(position) : null;
  }

  /**
   * A highlight's or underline's range with one end dragged to a page point,
   * from the open document's Structured Characters — the proposal of a
   * Geometry Edit on a text range.
   *
   * @returns `null` while no document is open, or for a point no range can be
   *   placed from.
   */
  async adjustRange(adjustment: RangeAdjustment): Promise<SelectedText | null> {
    const structure = this.#structure();
    return structure ? await structure.adjustRange(adjustment) : null;
  }

  /** Whether the reader surfaces may mount: every probe so far passed. */
  get supported(): boolean {
    return this.#probes.ok && !this.#surfaces.disposed;
  }

  get probes(): readonly PdfSeamProbeResult[] {
    return this.#probes.results;
  }

  /**
   * Settles when the page-stage probes have finished against the page the
   * binding last saw, so a caller that mounts reader surfaces knows when
   * {@link supported} stops moving. Already settled while no page has reached
   * the binding. Never rejects.
   */
  get probed(): Promise<void> {
    return this.#probing;
  }

  /**
   * Settles when the Annotation Marks on screen match the last read this
   * binding started. Already settled while the view shows a file Zotero does
   * not know. Never rejects.
   */
  get refreshed(): Promise<void> {
    return this.#refreshing;
  }

  /**
   * Settles when the last Editing Capability gesture this binding started has
   * run to its end — the affordance's click, or a keystroke under a block. Both
   * probe Zotero first, so neither is done when the gesture returns. Already
   * settled while none has run. Never rejects.
   */
  get gestured(): Promise<void> {
    return this.#gesturing;
  }

  /**
   * Settles when the last Annotation History press in this reader has been
   * answered — the write sent, the step dropped, or the press turned away by a
   * guard — and the reader has landed on what it changed. Already settled while
   * none has run. Never rejects.
   */
  get stepped(): Promise<void> {
    return this.#stepping;
  }

  /**
   * Settles when the last text selection released in this reader has been
   * placed on the page's characters, or refused. Already settled while none
   * has. Never rejects.
   */
  get settled(): Promise<void> {
    return this.#creation?.settled ?? Promise.resolve();
  }

  /** Revalidates this PDF surface when Obsidian activates its leaf. */
  activate(): void {
    if (this.#attachment.kind === "resolved") {
      void this.#annotations.refresh(this.#attachment.attachmentKey);
    }
  }

  /**
   * Honour the Annotation Anchor waiting on this view's leaf, once the marks on
   * screen match the last read. Safe to call for a view that has none: each
   * Anchor is honoured once, and one that cannot be placed leaves the reader on
   * the page Obsidian already jumped to.
   */
  land(): void {
    void this.refreshed.then(() => this.#land());
  }

  load(): void {
    this.#probes.record(probeFileView(this.#view));
    const filePath = openFilePathOf(this.#view);
    this.#filePath = filePath;
    if (filePath === null) {
      logger.debug("PDF view holds no file yet");
      return;
    }
    const absolutePath = absolutePathOf(filePath, this.#adapter);
    this.#absolutePath = absolutePath;
    // A view bound while the Zotero database is still loading — plugin startup
    // over an open PDF tab — is told `pending`, and takes its answer here.
    this.#surfaces.defer(() => this.#cancelScroll());
    this.#surfaces.defer(
      this.#attachments.on("resolutions-changed", () =>
        this.#resolve(absolutePath),
      ),
    );
    this.#resolve(absolutePath);
    if (!this.supported) return;
    whenViewerReady(this.#view.viewer, (controller) =>
      this.#attach(controller),
    );
  }

  [Symbol.dispose](): void {
    this.#session[Symbol.dispose]();
    this.#surfaces.dispose();
  }

  /**
   * Names the open file's Attachment and binds its Annotations, then paints
   * whatever page the reader already holds. The first answer that is not
   * `pending` stands: a file Zotero does not know is asked about once, however
   * often the resolver announces a change.
   */
  #resolve(absolutePath: string): void {
    if (this.#surfaces.disposed || this.#attachment.kind !== "pending") return;
    this.#attachment = this.#attachments.resolve(absolutePath);
    logger.debug("PDF view resolved", {
      path: this.#filePath,
      attachment: this.#attachment,
    });
    // The session names the Attachment even when a probe failed: a probe miss
    // costs this view its own surfaces, and leaves every consumer that only
    // follows what the view holds — the Annotation View — reading as before.
    this.#session.setTarget(
      this.#attachment.kind === "resolved"
        ? {
            attachmentKey: this.#attachment.attachmentKey,
            itemKey: this.#attachment.itemKey,
          }
        : null,
    );
    if (!this.supported || this.#attachment.kind !== "resolved") {
      // No read runs for this view, so an Anchor waiting on its leaf is
      // answered here rather than off a refresh that never comes.
      this.land();
      return;
    }
    const { attachmentKey } = this.#attachment;
    // Two views of one Attachment share one history, and the last of them to
    // close ends it, so the open is matched on the surfaces stack.
    this.#annotations.openHistory(attachmentKey);
    this.#surfaces.defer(() => this.#annotations.closeHistory(attachmentKey));
    this.#mountSelection(attachmentKey);
    this.#mountToolbar();
    this.#surfaces.defer(
      this.#annotations.on("annotations-changed", (changedKey) => {
        if (changedKey === attachmentKey) this.#refresh();
      }),
    );
    this.#surfaces.use(
      registerDomEvent(this.#view.containerEl, "focusin", (event) => {
        // The Text Draft focuses itself as it opens; a read started then would
        // race the create its finish sends.
        if (event.target === this.#draftArea) return;
        void this.#annotations.refresh(attachmentKey);
      }),
    );
    this.#surfaces.use(
      registerMigratingWindowEvent(this.#view.containerEl, "focus", () => {
        void this.#annotations.refresh(attachmentKey);
      }),
    );
    this.#surfaces.defer(() => this.#unpaint());
    this.#refresh();
  }

  /**
   * Obsidian's own page subpath is what moves the reader, so an Annotation the
   * marks do not place — a position this build draws nowhere — moves nothing.
   */
  #navigate(annotationKey: string): void {
    const pageIndex = pageOfMark(this.#marks, annotationKey);
    if (pageIndex === null || !this.#controller) {
      logger.debug("No page holds this annotation", {
        path: this.filePath,
        annotationKey,
      });
      return;
    }
    this.#controller.applySubpath(`#page=${pageIndex + 1}`);
  }

  #attach(controller: PDFViewerController): void {
    if (this.#surfaces.disposed) return;
    this.#probes.record(probeController(this.#view.viewer, controller));
    if (!this.supported) return;

    this.#controller = controller;
    this.#surfaces.defer(() => this.#closeStructure());
    this.#structure();
    this.#mountToolbar();

    const onRender: PDFPageRenderedListener = (event) => {
      this.#probes.record(probeRenderEvent(event));
      this.#probePage(pageViewOf(controller, event.pageNumber));
      if (!this.supported) {
        this[Symbol.dispose]();
        return;
      }
      // A document that opened after the attach, or replaced the one this
      // binding read, is painted before it is asked about.
      this.#structure();
      // PDF.js drops every child it does not keep on a zoom, a rotation and a
      // page recycle, so each render rebuilds this page's marks from data.
      this.#paint(event.pageNumber - 1);
      // A Landing waiting on this page has its Mark now that the page is
      // painted, which is the catch-up Obsidian's own subpath highlight lacks.
      if (this.#landing?.pageIndex === event.pageNumber - 1)
        this.#applyLanding();
      // The re-render can have wiped the mark the popup hangs over, so its
      // anchor is taken from the page as it now stands.
      this.#popupHost?.sync();
    };
    this.#surfaces.use(onPageRendered(controller, onRender));
    this.#probePage(loadedPageOf(controller));
    if (!this.supported) {
      this[Symbol.dispose]();
      return;
    }
    this.#repaint();
    // An Anchor that arrived before the viewer did waited for this: the pages
    // it asks about exist only once the controller stands.
    this.land();
  }

  /**
   * The Creation Toolbar in the reader's own right toolbar slot, carrying the
   * always-present Editing Capability affordance in its own slot, beside the
   * keystrokes that ask to edit under a block.
   *
   * Runs once, when both halves stand: the viewer child that owns the toolbar,
   * and an Attachment this view can edit. A PDF Zotero does not know is left
   * exactly as Obsidian opened it, because there is nothing there to edit and
   * nothing to say about it.
   *
   * The countdown is a `setInterval` on the toolbar's own window, held under
   * this binding's disposer so a closed leaf, a file switch and plugin unload
   * each stop it; the nodes go the same way, and their removal is idempotent
   * because Obsidian's own `empty()` on unload may have cleared them first.
   *
   * @see apps/obsidian/docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md
   */
  #mountToolbar(): void {
    const creation = this.#creation;
    const state = this.#surfaceState;
    if (this.#toolbarMounted || !creation || !state) return;
    const controller = this.#controller;
    const slot = controller && toolbarSlotOf(controller);
    if (!slot) return;
    this.#toolbarMounted = true;
    let ticking: number | null = null;
    const stopTicking = (): void => {
      if (ticking === null) return;
      slot.win.clearInterval(ticking);
      ticking = null;
    };

    this.#drawCapability = (affordance) => {
      const capabilitySlot = this.#capabilitySlot;
      if (this.#surfaces.disposed || !capabilitySlot) return;
      renderCapabilityAffordance(capabilitySlot, affordance);
    };
    // The clock runs only while a cooldown counts down. Each tick reads the
    // capability afresh, because a cooldown lapses without an announcement.
    const runClock = (capability: EditingCapability): void => {
      if (capability.kind === "cooldown") {
        ticking ??= slot.win.setInterval(
          () => this.#ingestCapability(),
          COUNTDOWN_INTERVAL.total("milliseconds"),
        );
      } else stopTicking();
    };

    this.#surfaces.defer(() => {
      stopTicking();
      this.#drawCapability = () => undefined;
      // The Creation Toolbar takes its own slot out with it, and Obsidian's
      // `empty()` on unload may have cleared both first, so this is the third
      // idempotent removal of the same node rather than the only one.
      if (this.#capabilitySlot)
        removeCapabilityAffordance(this.#capabilitySlot);
      this.#capabilitySlot = null;
    });
    this.#surfaces.defer(
      state.subscribe(
        selectCapabilityAffordance,
        (affordance) => this.#drawCapability(affordance),
        { equalityFn: sameFlat },
      ),
    );
    this.#surfaces.defer(
      state.subscribe(({ capability }) => capability, runClock, {
        equalityFn: sameCapability,
        fireImmediately: true,
      }),
    );
    this.#surfaces.use(
      registerDomEvent(this.#view.containerEl, "keydown", (event) => {
        if (isEditGesture(event)) this.#editGesture();
      }),
    );
    creation.mountToolbar(slot);
  }

  /**
   * The selected Annotation Mark, the Mark Popup over it, and the creation
   * surfaces that share that popup, for the Attachment this view holds. Runs
   * once: a file switch builds a new binding, and the gestures are heard on the
   * view's own container, which outlives every page.
   *
   * @see https://github.com/aidenlx/zotlit/issues/1148
   * @see https://github.com/aidenlx/zotlit/issues/1150
   */
  #mountSelection(attachmentKey: string): void {
    if (this.#selection) return;
    const state = createReaderSurfaceState({
      colors: this.#toolColors.current(),
      recentColors: this.#toolColors.recent(),
      capability: this.#capability(),
      now: this.#now(),
    });
    this.#surfaceState = state;
    // The one listener the reader surfaces hear the Editing Capability through.
    this.#surfaces.defer(
      this.#annotations.on("capability-changed", () =>
        this.#ingestCapability(),
      ),
    );
    // The per-Annotation facts the Mark Popup reads come in the same way.
    this.#surfaces.use(listenAnnotationEvents(state, this.#annotations));
    const popup = {
      contains: (node: Node | null) => host.contains(node),
      sync: () => host.sync(),
    };
    const creation = new MarkCreation({
      app: this.#view.app,
      containerEl: this.#view.containerEl,
      popup,
      attachmentKey,
      pages: () => this.#pages(),
      records: () => this.#records,
      structure: () => this.#structure(),
      repaint: () => this.#repaint(),
      reveal: (annotationKey, { commenting } = {}) => {
        // The create dropped the Attachment's list, so the mark exists once the
        // refresh it started has answered.
        void this.refreshed.then(() =>
          this.#selection?.select(annotationKey, { commenting }),
        );
      },
      reportBlockedGesture: () => this.#editGesture(),
      reportCreateFailure: (reason) => {
        new BaseNotice(m.pdf_create_failed({ reason }));
      },
      renderCapability: (slot) => {
        this.#capabilitySlot = slot;
        this.#drawCapability(selectCapabilityAffordance(state.getState()));
      },
      // Obsidian's own way into a view: the PDF view focuses its pages.
      focusReader: () =>
        this.#view.app.workspace.setActiveLeaf(this.#view.leaf, {
          focus: true,
        }),
      colors: this.#toolColors,
      surfaceState: state,
      annotations: this.#annotations,
      now: this.#now,
    });
    this.#creation = creation;
    const selection = new MarkSelection({
      app: this.#view.app,
      containerEl: this.#view.containerEl,
      popup,
      marks: () => this.#visibleMarks(),
      records: () => this.#records,
      pageAt: (pageIndex) =>
        this.#controller && pageViewOf(this.#controller, pageIndex + 1),
      repaint: () => this.#repaint(),
      navigate: (annotationKey) => this.#navigate(annotationKey),
      report: (annotationKeys) => this.#session.reportSelection(annotationKeys),
      annotations: this.#annotations,
      colors: this.#toolColors,
      surfaceState: state,
      gestures: {
        revealAnnotation: (annotationKey, options) =>
          this.#markGestures.revealAnnotation(annotationKey, options),
        reportBlockedGesture: () => this.#editGesture(),
        allowEditing: () => this.#gestures.allowEditing(),
      },
      creation,
      sortIndex: (position) => this.sortIndex(position),
      adjustRange: (adjustment) => this.adjustRange(adjustment),
      textRotation: this.#textRotation,
      refreshed: () => this.refreshed,
      now: this.#now,
    });
    this.#selection = selection;
    this.#surfaces.defer(
      mountReaderKeymap(
        this.#view,
        {
          escape: () => selection.escape() || creation.escape(),
          undo: () => this.stepHistory("undo"),
          redo: () => this.stepHistory("redo"),
        },
        { isMacOS: Platform.isMacOS },
      ),
    );
    // A Geometry Edit redraws the one mark it moves; the handles come and go
    // with the capability to save one.
    this.#surfaces.defer(
      state.subscribe(selectAdjust, (adjust) => {
        this.#patchSelected();
        this.#showAdjusting(adjust);
      }),
    );
    this.#surfaces.defer(() => this.#showAdjusting(null));
    this.#surfaces.defer(
      state.subscribe(selectSelectedKey, (key) => this.#readRangeText(key)),
    );
    // An image capture draws its rectangle on the page it was pressed on.
    this.#surfaces.defer(
      state.subscribe(selectCapture, () => this.#drawCapture()),
    );
    // A Text Draft stands as a textarea over its page until it goes.
    this.#surfaces.defer(
      state.subscribe(selectTextDraft, () => this.#drawTextDraft()),
    );
    this.#surfaces.defer(() => this.#dropTextDraftArea());
    // An ink stroke draws on the page it was pressed on, one `d` per frame;
    // the strokes saving draw under the marks until their records arrive.
    this.#surfaces.defer(
      state.subscribe(
        ({ liveStroke }) => liveStroke,
        () => this.#drawLiveStroke(),
      ),
    );
    this.#surfaces.defer(
      state.subscribe(
        (current) =>
          current.liveStroke !== null || selectCapture(current) !== null,
        (drawing) => this.#showDrawing(drawing),
      ),
    );
    this.#surfaces.defer(() => this.#showDrawing(false));
    this.#surfaces.defer(
      state.subscribe(
        ({ pendingStrokes }) => pendingStrokes,
        (pending, before) => {
          const pages = new Set(
            [...pending, ...before].map(({ pageIndex }) => pageIndex),
          );
          for (const pageIndex of pages) this.#paint(pageIndex);
        },
      ),
    );
    // A finger on an armed ink tool draws rather than pans, which the browser
    // decides at contact, so the page takes it before any press.
    this.#surfaces.defer(
      state.subscribe(
        ({ armed }) => armed,
        (armed) => this.#showArmed(armed),
        { fireImmediately: true },
      ),
    );
    this.#surfaces.defer(() => this.#showArmed(null));
    this.#surfaces.defer(
      state.subscribe(
        ({ capability }) => editingLive(capability),
        () => this.#repaint(),
      ),
    );
    // The owners subscribe first, so an editor that closes is let go before
    // the host redraws or hides the popup it stood in.
    selection.load();
    const host = new MarkPopupHost({
      parent: this,
      store: state,
      variants: {
        selected: {
          anchor: () => selection.anchor(),
          render: (content) => selection.renderPopup(content),
        },
        create: {
          anchor: () => creation.anchor(),
          render: (content) => creation.renderPopup(content),
          unanchored: () => creation.unanchored(),
        },
      },
    });
    this.#popupHost = host;
    // Owners before the host, so an editor is let go before its popup goes.
    this.#surfaces.defer(() => {
      this.#selection = null;
      this.#creation = null;
      this.#popupHost = null;
      this.#surfaceState = null;
      selection[Symbol.dispose]();
      creation[Symbol.dispose]();
      host[Symbol.dispose]();
    });
  }

  /**
   * The Structured Characters of the document the viewer holds right now, and
   * the Page Label pass over them. The pass runs in idle time once the
   * document is open, because a creation that arrives first awaits the same
   * pass rather than starting one. `null` while no document is open.
   *
   * @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
   */
  #structure(): PdfTextStructure | null {
    const controller = this.#controller;
    const document_ = controller && pdfDocumentOf(controller);
    if (!document_) return null;
    if (this.#held?.document === document_) return this.#held.structure;
    this.#closeStructure();
    const structure = new PdfTextStructure(pdfPageSource(document_));
    const win = this.#view.containerEl.win;
    const idle = win.requestIdleCallback(() => {
      void structure.pageLabels().catch((error: unknown) => {
        logger.warn("The PDF page label pass did not finish", {
          error,
          path: this.filePath,
        });
      });
    });
    this.#held = { document: document_, structure, idle, win };
    return structure;
  }

  /** Releases the held Structured Characters and their pending label pass. */
  #closeStructure(): void {
    const held = this.#held;
    if (!held) return;
    held.win.cancelIdleCallback(held.idle);
    this.#held = null;
  }

  /**
   * The pages PDF.js holds painted right now, read from the viewer on each
   * ask. A text selection can only reach a page that has rendered, so this is
   * the whole search space of selection capture and the popup's anchor walk.
   */
  #pages(): ReaderPage[] {
    const controller = this.#controller;
    if (!controller) return [];
    return renderedPagesOf(controller).flatMap((pageIndex) => {
      const view = pageViewOf(controller, pageIndex + 1);
      return view ? [{ pageIndex, view }] : [];
    });
  }

  /**
   * The marks the overlay draws, which mark visibility can stand down whole.
   * The selected mark is drawn from a Geometry Edit's proposal while one
   * stands, so a re-render or a read mid-drag keeps it where the pointer put
   * it.
   */
  #visibleMarks(): ReadonlyMap<number, readonly PdfPageAnnotation[]> {
    const state = this.#surfaceState?.getState();
    if (state?.marksVisible === false) return new Map();
    const key = state ? selectSelectedKey(state) : null;
    const adjust = state ? selectAdjust(state) : null;
    return key !== null && adjust
      ? withPosition(this.#marks, key, adjust.proposal)
      : this.#marks;
  }

  /** Whether the selected mark carries its Mark Handles. */
  #handles(): boolean {
    const state = this.#surfaceState?.getState();
    return state !== undefined && editingLive(state.capability);
  }

  /**
   * Redraws the selected mark in place on each page that draws it, and
   * repaints a page whose overlay cannot be patched.
   */
  #patchSelected(): void {
    const controller = this.#controller;
    const state = this.#surfaceState?.getState();
    const key = state ? selectSelectedKey(state) : null;
    if (!controller || key === null) return;
    const drawn = new Set<number>();
    for (const [pageIndex, placements] of this.#visibleMarks()) {
      const placement = placements.find(
        ({ annotation }) => annotation.key === key,
      );
      if (placement) drawn.add(pageIndex);
      const page = placement && pageViewOf(controller, pageIndex + 1);
      if (!page) continue;
      if (
        !patchSelectedMark(page, placement, {
          handles: this.#handles(),
          textRotation: this.#textRotation,
          font: interfaceFont(page.div.win),
        })
      )
        this.#paint(pageIndex);
    }
    // A page the mark left — the next page of a range that no longer spills
    // onto it — is painted without it.
    const before =
      this.#patchedOn?.key === key
        ? this.#patchedOn.pages
        : pagesDrawing(this.#marks, key);
    for (const pageIndex of before.difference(drawn)) this.#paint(pageIndex);
    this.#patchedOn = { key, pages: drawn };
  }

  /**
   * Draws the image capture's rectangle on its page, and takes it off the
   * page it was last drawn on once it ends.
   */
  #drawCapture(): void {
    const controller = this.#controller;
    const state = this.#surfaceState?.getState();
    const capture = state ? selectCapture(state) : null;
    const held = this.#capturedOn;
    this.#capturedOn = capture?.pageIndex ?? null;
    if (!controller) return;
    if (held !== null && held !== capture?.pageIndex) {
      const page = pageViewOf(controller, held + 1);
      if (page) renderCapture(page, null);
    }
    if (!capture || !state) return;
    const page = pageViewOf(controller, capture.pageIndex + 1);
    if (page)
      renderCapture(page, { rect: capture.rect, color: state.colors.image });
  }

  /**
   * Places the Text Draft's textarea over its page, building it for a new
   * draft and focusing it; a page render that took it off the page puts it
   * back, still focused. It goes with the draft.
   */
  #drawTextDraft(): void {
    const controller = this.#controller;
    const creation = this.#creation;
    const state = this.#surfaceState?.getState();
    const draft = state ? selectTextDraft(state) : null;
    if (!draft || !controller || !creation) {
      this.#dropTextDraftArea();
      return;
    }
    const page = pageViewOf(controller, draft.pageIndex + 1);
    if (!page) return;
    const area = (this.#draftArea ??= createTextDraftArea(page.div.doc, {
      input: (text) => creation.typeDraft(text),
      finish: () => creation.finishDraft(),
    }));
    placeTextDraft(area, page, {
      draft,
      font: interfaceFont(page.div.win),
    });
    if (area.parentElement === page.div) return;
    page.div.append(area);
    if (draft.phase === "typing") area.focus({ preventScroll: true });
  }

  #dropTextDraftArea(): void {
    if (this.#draftArea) removeTextDraftArea(this.#draftArea);
    this.#draftArea = null;
  }

  /** Draws the Live Stroke on its page, as {@link #drawCapture} does. */
  #drawLiveStroke(): void {
    const controller = this.#controller;
    const stroke = this.#surfaceState?.getState().liveStroke ?? null;
    const held = this.#strokeOn;
    this.#strokeOn = stroke?.pageIndex ?? null;
    if (!controller) return;
    if (held !== null && held !== stroke?.pageIndex) {
      const page = pageViewOf(controller, held + 1);
      if (page) renderLiveStroke(page, null);
    }
    if (!stroke) return;
    const page = pageViewOf(controller, stroke.pageIndex + 1);
    if (page) renderLiveStroke(page, stroke);
  }

  /**
   * Marks the reader with the armed tool, so the stylesheet shows that tool's
   * cursor over the pages; and while the ink tool is armed, so it takes touch
   * panning off them.
   */
  #showArmed(armed: MarkTool | null): void {
    const { containerEl } = this.#view;
    containerEl.toggleAttribute(themeAttribute.pdfInking, armed === "ink");
    if (armed) containerEl.dataset.ztArmed = armed;
    else delete containerEl.dataset.ztArmed;
  }

  /**
   * Marks the reader while a Live Stroke or an image capture holds the
   * pointer, so the stylesheet keeps the crosshair over the captured pointer.
   */
  #showDrawing(drawing: boolean): void {
    this.#view.containerEl.toggleAttribute("data-zt-drawing", drawing);
  }

  /**
   * Marks the reader while a text range's end moves, so the stylesheet shows
   * the text cursor, as Zotero's reader does, over the captured pointer.
   */
  #showAdjusting(adjust: Adjustment | null): void {
    const moving =
      adjust?.phase === "dragging" && isRangeGrip(adjust.grip) ? "text" : null;
    if (moving) this.#view.containerEl.dataset.ztAdjusting = moving;
    else delete this.#view.containerEl.dataset.ztAdjusting;
  }

  /** Takes the Attachment's capability as the repository now answers it. */
  #ingestCapability(): void {
    const state = this.#surfaceState;
    if (state) ingestCapability(state, this.#capability(), this.#now());
  }

  /** What this view may do to its Attachment's Annotations right now. */
  #capability(): EditingCapability {
    return this.#attachment.kind === "resolved"
      ? this.#annotations.capabilityFor(this.#attachment.attachmentKey)
      : this.#annotations.capability;
  }

  /**
   * A keystroke asked to edit the document. A fresh probe runs first, because
   * the block may be one a probe clears — a Zotero that was closed and is now
   * open — and only what survives it is worth a notice.
   */
  #editGesture(): void {
    // A gesture that can still act carries its own answer: under
    // `authorization-required` the create opens Zotero's dialog and goes on, so
    // a notice saying the edit was blocked would contradict it.
    if (editingLive(this.#capability())) return;
    this.#gesturing = this.#annotations.probe().then(() => {
      if (this.#surfaces.disposed) return;
      if (this.#attachment.kind !== "resolved") return;
      this.#gestures.reportBlockedGesture(this.#attachment.attachmentKey);
    });
  }

  /**
   * The undo or redo verb, answered for the Attachment this view shows — the
   * reader's own keys, the palette's two commands, and the More options menu.
   * The repository decides and writes; this seam renders its answer — the
   * reader lands on what changed, a step Zotero moved under says so, and a
   * block is reported the way every other blocked edit gesture is.
   *
   * @see apps/obsidian/policies/ui-seams.md
   */
  stepHistory(direction: HistoryDirection): void {
    if (this.#attachment.kind !== "resolved") return;
    const { attachmentKey } = this.#attachment;
    const stepping =
      direction === "undo"
        ? this.#annotations.undo(attachmentKey)
        : this.#annotations.redo(attachmentKey);
    const answered = stepping.then((outcome) => {
      if (this.#surfaces.disposed) return;
      switch (outcome.kind) {
        case "stepped":
          return this.#landOn(outcome.annotationKey);
        case "removed":
          return this.#landOnPage(outcome.pageIndex);
        case "changed":
          new BaseNotice(m.annot_history_changed_in_zotero());
          return;
        case "failed":
          new BaseNotice(writeFailureMessage(outcome.failure, this.#now()));
          return;
        case "blocked":
          this.#editGesture();
          return;
        case "idle":
          return;
      }
    });
    // Chained rather than replaced, so a second press in flight leaves this
    // settling behind both rather than behind the later one alone. Settled
    // rather than resolved, so it answers however each press ended.
    this.#stepping = Promise.allSettled([this.#stepping, answered]).then(
      () => undefined,
    );
  }

  /**
   * Bring the reader to the Annotation a History Step changed, once the marks
   * on screen match the read that step announced.
   *
   * A page PDF.js has not built yet is reached by Obsidian's own page jump,
   * and the render it triggers is what the waiting Landing lands on — the
   * Annotation Anchor's own path.
   */
  #landOn(annotationKey: string): Promise<void> {
    return this.refreshed.then(() => {
      if (this.#surfaces.disposed) return;
      const controller = this.#controller;
      const pageIndex = pageOfMark(this.#marks, annotationKey);
      if (pageIndex === null || !controller) {
        logger.debug("No page holds this annotation", {
          path: this.filePath,
          annotationKey,
        });
        return;
      }
      this.#landing = { annotationKey, pageIndex };
      if (renderedPagesOf(controller).includes(pageIndex)) {
        this.#applyLanding();
        return;
      }
      controller.applySubpath(`#page=${pageIndex + 1}`);
    });
  }

  /**
   * Bring the reader back to where the Annotation a History Step took away
   * was. Nothing is left to select, so the selection goes and Obsidian's own
   * page jump answers for the scroll.
   */
  #landOnPage(pageIndex: number): Promise<void> {
    return this.refreshed.then(() => {
      if (this.#surfaces.disposed) return;
      // A Landing left waiting by an earlier press names an Annotation this
      // step erased, so it goes rather than selecting one on the next render.
      this.#landing = null;
      this.#selection?.select(null, { popup: false });
      this.#controller?.applySubpath(`#page=${pageIndex + 1}`);
    });
  }

  /**
   * Decide the Anchor this view's leaf carries, and act on it. The Annotation's
   * own page wins over the page the link recorded, so a link written before the
   * PDF was replaced still lands on its passage.
   *
   * An Anchor that cannot be honoured leaves the reader on Obsidian's own page
   * jump, in silence: a `debug` record names the reason, and nothing is drawn
   * or announced. A miss waiting on a source that has not answered is kept for
   * it; every other miss is final and the Anchor goes with it.
   */
  #land(): void {
    if (this.#surfaces.disposed || !this.supported) return;
    const { leaf } = this.#view;
    const anchor = peekPendingAnchor(leaf);
    const controller = this.#controller;
    // The pages a Landing asks about exist only behind the viewer child, so an
    // Anchor that arrived first waits where it is; `#attach` asks again.
    if (!anchor || !controller) return;

    const landing = decideMarkLanding({
      anchor,
      attachment: this.#attachment,
      read: this.#read,
      records: this.#records,
      marks: this.#marks,
      rendered: new Set(renderedPagesOf(controller)),
    });
    if (landing.kind === "drop") return;
    if (landing.kind === "page") {
      logger.debug("An Annotation Anchor did not reach its Mark", {
        path: this.filePath,
        annotationKey: anchor.annotation,
        reason: landing.reason,
      });
      if (!KEPT_MISSES.has(landing.reason)) dropPendingAnchor(leaf);
      return;
    }

    dropPendingAnchor(leaf);
    this.#landing = {
      annotationKey: landing.annotationKey,
      pageIndex: landing.pageIndex,
    };
    logger.debug("An Annotation Anchor reached its Mark", {
      path: this.filePath,
      annotationKey: landing.annotationKey,
      page: landing.pageIndex + 1,
      rendered: landing.kind === "select",
    });
    // A page PDF.js has not built yet is Obsidian's own jump to make; the
    // render it triggers is what the waiting Landing lands on.
    if (landing.kind === "wait")
      controller.applySubpath(`#page=${landing.pageIndex + 1}`);
    else this.#applyLanding();
  }

  /** Selects the Landing's Mark without a popup, and scrolls it into view. */
  #applyLanding(): void {
    const landing = this.#landing;
    if (!landing) return;
    this.#landing = null;
    this.#selection?.select(landing.annotationKey, { popup: false });
    this.#scrollToMark(landing);
  }

  /**
   * Brings the landed Mark on screen, a frame after the selection.
   *
   * Obsidian's own `#page=N` rides the same open and scrolls on its own
   * schedule — on a reader that is already showing the file, after this. A Mark
   * placed before that jump is scrolled off again, so the Landing takes the
   * frame after it and has the last word, which is what makes the Annotation
   * win over the page the link named.
   */
  #scrollToMark(target: MarkLandingTarget): void {
    const win = this.#view.containerEl.win;
    this.#cancelScroll();
    this.#landingFrame = win.requestAnimationFrame(() => {
      this.#landingFrame = null;
      const controller = this.#controller;
      const page = controller && pageViewOf(controller, target.pageIndex + 1);
      if (page) scrollMarkIntoView(page, target.annotationKey);
    });
  }

  #cancelScroll(): void {
    if (this.#landingFrame === null) return;
    this.#view.containerEl.win.cancelAnimationFrame(this.#landingFrame);
    this.#landingFrame = null;
  }

  /** Reads this Attachment's Annotations and redraws every page they touch. */
  #refresh(): void {
    if (this.#attachment.kind !== "resolved") return;
    const { attachmentKey } = this.#attachment;
    const serial = ++this.#refreshSerial;
    this.#refreshing = this.#annotations
      .read(attachmentKey)
      .then((list) => {
        if (this.#surfaces.disposed || serial !== this.#refreshSerial) return;
        if (list === null) {
          logger.debug("No annotation list stands for this attachment yet", {
            path: this.filePath,
            attachmentKey,
          });
          this.#land();
          return;
        }
        this.#read = true;
        this.#records = list.annotations;
        this.#marks = groupAnnotationsByPage(list.annotations);
        if (this.#surfaceState)
          ingestAnnotations(
            this.#surfaceState,
            list.annotations,
            this.#annotations,
          );
        logger.debug("Annotation marks rebuilt for a PDF view", {
          path: this.filePath,
          source: list.source.kind,
          annotations: list.annotations.length,
          pages: this.#marks.size,
        });
        this.#repaint();
        // A mark the read retired took its selection with it above; one that
        // moved takes the popup along.
        this.#popupHost?.sync();
        // The Attachment's marks now stand, which is what an Anchor waiting on
        // this view — a cold open, or a read that answered after it — needs.
        this.#land();
      })
      .catch((error: unknown) => {
        logger.warn("Failed to read the annotations of an open PDF", {
          error,
          path: this.filePath,
          attachmentKey,
        });
      });
  }

  /**
   * Asks for the Structured Characters under a selected text range's ends, so
   * its handles lie across its text once they are read.
   */
  #readRangeText(key: string | null): void {
    const record = this.#records.find((held) => held.key === key);
    const handles = record ? rangeHandles(record, 0, this.#textRotation) : [];
    const structure = handles.length > 0 ? this.#structure() : null;
    if (
      !structure ||
      handles.every(
        ({ pageIndex, rect }) =>
          structure.textRotation(pageIndex, rect) !== null,
      )
    )
      return;
    void Promise.all(
      handles.map(({ pageIndex }) => structure.page(pageIndex)),
    ).then(
      () => this.#patchSelected(),
      (error: unknown) => {
        logger.debug("Could not read the text under a range's handles", {
          error,
          annotationKey: key,
        });
      },
    );
  }

  /** Every page holding marks, and every page that has just lost them. */
  #repaint(): void {
    for (const pageIndex of this.#painted.union(new Set(this.#marks.keys()))) {
      this.#paint(pageIndex);
    }
  }

  #paint(pageIndex: number): void {
    const controller = this.#controller;
    const page = controller && pageViewOf(controller, pageIndex + 1);
    if (!page) return;
    const annotations = this.#visibleMarks().get(pageIndex) ?? [];
    const pending = (
      this.#surfaceState?.getState().pendingStrokes ?? []
    ).filter((stroke) => stroke.pageIndex === pageIndex);
    renderAnnotationOverlay(page, {
      annotations,
      pending,
      selected: this.#selection?.selected,
      handles: this.#handles(),
      textRotation: this.#textRotation,
      font: interfaceFont(page.div.win),
    });
    // The rebuild took the capture's rectangle and the Live Stroke with the
    // overlay.
    if (this.#capturedOn === pageIndex) this.#drawCapture();
    if (this.#strokeOn === pageIndex) this.#drawLiveStroke();
    if (
      this.#surfaceState &&
      selectTextDraft(this.#surfaceState.getState())?.pageIndex === pageIndex
    )
      this.#drawTextDraft();
    if (annotations.length > 0 || pending.length > 0)
      this.#painted.add(pageIndex);
    else this.#painted.delete(pageIndex);
  }

  /** Leaves the reader as Obsidian built it, whatever this binding painted. */
  #unpaint(): void {
    this.#landing = null;
    this.#marks = new Map();
    this.#records = [];
    this.#repaint();
    this.#controller = null;
  }

  /** The page-stage probes, run against the first page that reaches them. */
  #probePage(page: PDFPageView | null): void {
    const controller = this.#controller;
    if (this.#pageProbed || !page || !controller) return;
    this.#pageProbed = true;
    this.#probes.record(probePageView(page));
    if (this.supported)
      this.#probing = this.#probeTextContent(controller, page);
  }

  async #probeTextContent(
    controller: PDFViewerController,
    page: PDFPageView,
  ): Promise<void> {
    const result = await probeTextContent(controller, page);
    if (this.#surfaces.disposed) return;
    this.#probes.record([result]);
    if (!this.supported) this[Symbol.dispose]();
  }
}

/**
 * The first page that draws an Annotation, which is the page the reader scrolls
 * to for it; `null` where no page on screen draws it.
 */
function pageOfMark(
  marks: ReadonlyMap<number, readonly PdfPageAnnotation[]>,
  key: string,
): number | null {
  for (const [pageIndex, placements] of marks) {
    if (placements.some(({ annotation }) => annotation.key === key))
      return pageIndex;
  }
  return null;
}

/** The pages that draw an Annotation, by its Indexed Key. */
function pagesDrawing(
  marks: ReadonlyMap<number, readonly PdfPageAnnotation[]>,
  key: string,
): Set<number> {
  const pages = new Set<number>();
  for (const [pageIndex, placements] of marks) {
    if (placements.some(({ annotation }) => annotation.key === key))
      pages.add(pageIndex);
  }
  return pages;
}

/**
 * An external file carries its absolute path behind {@link EXTERNAL_FILE_PREFIX},
 * already normalised by Obsidian; a vault path goes through the adapter's own
 * normalisation rather than a join onto the base path.
 */
function absolutePathOf(filePath: string, adapter: FileSystemAdapter): string {
  return filePath.startsWith(EXTERNAL_FILE_PREFIX)
    ? filePath.slice(EXTERNAL_FILE_PREFIX.length)
    : adapter.getFullPath(filePath);
}
