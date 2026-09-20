// One open Obsidian PDF view bound to the Zotero attachment it shows.
import type {
  FileSystemAdapter,
  HoverParent,
  HoverPopover,
  PDFFileView,
  PDFPageRenderedListener,
  PDFPageView,
  PDFViewerController,
} from "obsidian";

import { PdfTextStructure } from "@zotlit/pdf-structure";

import { EXTERNAL_FILE_PREFIX } from "@/lib/constants";
import {
  registerDomEvent,
  registerMigratingWindowEvent,
} from "@/lib/disposables";
import { getLogger } from "@/lib/log";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type {
  AnnotationRecord,
  AnnotationRepository,
} from "@/services/annotation-repository/service";
import type {
  AttachmentResolution,
  AttachmentResolver,
} from "@/services/attachment-resolver/service";
import { ReaderSessionHost } from "@/services/reader-session/session";
import type { ReaderSession } from "@/services/reader-session/session";
import { editingLive } from "@/views/annot-view/card-controls";

import { dropPendingAnchor, peekPendingAnchor } from "./anchor-capture";
import {
  isEditGesture,
  removeCapabilityAffordance,
  renderCapabilityAffordance,
} from "./capability-affordance";
import { MarkCreation } from "./creation";
import type { ReaderPage } from "./creation";
import { decideMarkLanding } from "./mark-landing";
import type { MarkLandingMiss, MarkLandingTarget } from "./mark-landing";
import {
  groupAnnotationsByPage,
  renderAnnotationOverlay,
  scrollMarkIntoView,
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
  toolbarSlotOf,
  whenViewerReady,
} from "./seam";
import type { PdfSeamProbeResult } from "./seam";
import { MarkSelection } from "./selection";
import type { MarkGestures } from "./selection";
import { pdfPageSource } from "./text-structure";
import type { ToolColorStore } from "./tools";

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
  | "commentDraftFor"
  | "createAnnotation"
  | "deleteAnnotation"
  | "discardCommentDraft"
  | "editComment"
  | "mutationFor"
  | "on"
  | "patchColor"
  | "probe"
  | "read"
  | "refresh"
  | "retryCommentDraft"
  | "submitComment"
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
   * The affordance's click: a Capability Probe, then the "Zotero editing"
   * settings row. The Annotation View's renderer hands over the same gesture.
   */
  showEditingCapability: () => void;
  /**
   * An edit gesture met a block on this Attachment, with a fresh probe already
   * behind it. The seam says why, once per reason per capability episode.
   */
  reportBlockedGesture: (attachmentKey: string) => void;
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
export class PdfViewBinding implements Disposable, HoverParent {
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
  /**
   * The pages PDF.js has built for this document, by zero-based index. A text
   * selection can only reach a page that has rendered, so this is the whole
   * search space selection capture and the popup's anchor walk.
   */
  readonly #rendered = new Set<number>();
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
  /**
   * This Reader Session's Structured Characters, memoized per page for as long
   * as the session lives. One PDF view is one Reader Session, so the memo is
   * built here and released with the binding.
   *
   * @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
   */
  #structure: PdfTextStructure | null = null;
  #refreshing = Promise.resolve();
  /** Serialises the refreshes, so a slower read never overwrites a later one. */
  #refreshSerial = 0;
  /** Redraws the Editing Capability affordance; a no-op until one is mounted. */
  #drawCapability: () => void = () => undefined;
  /** The Creation Toolbar's own slot for the affordance; `null` until mounted. */
  #capabilitySlot: HTMLElement | null = null;
  #toolbarMounted = false;
  #gesturing = Promise.resolve();

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

  /** This PDF view as a Reader Session, for a surface that follows a reader. */
  get session(): ReaderSession {
    return this.#session;
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
    this.#mountSelection(attachmentKey);
    this.#mountToolbar();
    this.#surfaces.defer(
      this.#annotations.on("annotations-changed", (changedKey) => {
        if (changedKey === attachmentKey) this.#refresh();
      }),
    );
    this.#surfaces.use(
      registerDomEvent(this.#view.containerEl, "focusin", () => {
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
    const pageIndex = [...this.#marks].find(([, annotations]) =>
      annotations.some((mark) => mark.annotation.key === annotationKey),
    )?.[0];
    if (pageIndex === undefined || !this.#controller) {
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
    this.#openStructure(controller);
    this.#mountToolbar();

    const onRender: PDFPageRenderedListener = (event) => {
      this.#probes.record(probeRenderEvent(event));
      this.#probePage(pageViewOf(controller, event.pageNumber));
      if (!this.supported) {
        this[Symbol.dispose]();
        return;
      }
      this.#rendered.add(event.pageNumber - 1);
      // PDF.js drops every child it does not keep on a zoom, a rotation and a
      // page recycle, so each render rebuilds this page's marks from data.
      this.#paint(event.pageNumber - 1);
      // A Landing waiting on this page has its Mark now that the page is
      // painted, which is the catch-up Obsidian's own subpath highlight lacks.
      if (this.#landing?.pageIndex === event.pageNumber - 1)
        this.#applyLanding();
      // The re-render can have wiped the mark the popup hangs over, so its
      // anchor is taken from the page as it now stands.
      this.#selection?.sync();
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
    if (this.#toolbarMounted || !creation) return;
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

    this.#drawCapability = () => {
      const capabilitySlot = this.#capabilitySlot;
      if (this.#surfaces.disposed || !capabilitySlot) return;
      const capability = this.#capability();
      renderCapabilityAffordance(capabilitySlot, {
        capability,
        now: this.#now(),
        onActivate: () => this.#gestures.showEditingCapability(),
      });
      if (capability.kind === "cooldown") {
        ticking ??= slot.win.setInterval(
          () => this.#drawCapability(),
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
      this.#annotations.on("capability-changed", () => this.#drawCapability()),
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
    const creation = new MarkCreation({
      containerEl: this.#view.containerEl,
      parent: this,
      attachmentKey,
      pages: () => this.#pages(),
      records: () => this.#records,
      structure: () => this.#structure,
      repaint: () => this.#repaint(),
      reveal: (annotationKey) => {
        // The create dropped the Attachment's list, so the mark exists once the
        // refresh it started has answered.
        void this.refreshed.then(() => this.#selection?.select(annotationKey));
      },
      renderCapability: (slot) => {
        this.#capabilitySlot = slot;
        this.#drawCapability();
      },
      colors: this.#toolColors,
      annotations: this.#annotations,
      now: this.#now,
    });
    this.#creation = creation;
    const selection = new MarkSelection({
      containerEl: this.#view.containerEl,
      scope: this.#view.scope!,
      parent: this,
      attachmentKey,
      marks: () => this.#visibleMarks(),
      records: () => this.#records,
      pageAt: (pageIndex) =>
        this.#controller && pageViewOf(this.#controller, pageIndex + 1),
      repaint: () => this.#repaint(),
      navigate: (annotationKey) => this.#navigate(annotationKey),
      report: (annotationKeys) => this.#session.reportSelection(annotationKeys),
      annotations: this.#annotations,
      gestures: {
        revealAnnotation: (annotationKey, options) =>
          this.#markGestures.revealAnnotation(annotationKey, options),
        reportBlockedGesture: () => this.#editGesture(),
      },
      creation,
      now: this.#now,
    });
    this.#selection = selection;
    this.#surfaces.defer(() => {
      this.#selection = null;
      this.#creation = null;
      selection[Symbol.dispose]();
      creation[Symbol.dispose]();
    });
    selection.load();
  }

  /**
   * The Structured Characters of the open document, and the Page Label pass
   * over them. The pass runs in idle time once the document is open, because a
   * creation that arrives first awaits the same pass rather than starting one.
   *
   * @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
   */
  #openStructure(controller: PDFViewerController): void {
    const document_ = pdfDocumentOf(controller);
    if (!document_ || this.#structure) return;
    const structure = new PdfTextStructure(pdfPageSource(document_));
    this.#structure = structure;
    const win = this.#view.containerEl.win;
    const idle = win.requestIdleCallback(() => {
      void structure.pageLabels().catch((error: unknown) => {
        logger.warn("The PDF page label pass did not finish", {
          error,
          path: this.filePath,
        });
      });
    });
    this.#surfaces.defer(() => {
      win.cancelIdleCallback(idle);
      this.#structure = null;
    });
  }

  /** The pages PDF.js still holds, of those this binding has seen render. */
  #pages(): ReaderPage[] {
    const controller = this.#controller;
    if (!controller) return [];
    return [...this.#rendered].flatMap((pageIndex) => {
      const view = pageViewOf(controller, pageIndex + 1);
      return view ? [{ pageIndex, view }] : [];
    });
  }

  /** The marks the overlay draws, which mark visibility can stand down whole. */
  #visibleMarks(): ReadonlyMap<number, readonly PdfPageAnnotation[]> {
    return this.#creation?.marksVisible === false ? new Map() : this.#marks;
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
      rendered: this.#rendered,
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
        logger.debug("Annotation marks rebuilt for a PDF view", {
          path: this.filePath,
          source: list.source.kind,
          annotations: list.annotations.length,
          pages: this.#marks.size,
        });
        this.#repaint();
        // A mark the read retired takes its selection with it; one that moved
        // takes the popup along.
        this.#selection?.sync();
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
    renderAnnotationOverlay(page, {
      annotations,
      selected: this.#selection?.selected,
    });
    if (annotations.length > 0) this.#painted.add(pageIndex);
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
 * An external file carries its absolute path behind {@link EXTERNAL_FILE_PREFIX},
 * already normalised by Obsidian; a vault path goes through the adapter's own
 * normalisation rather than a join onto the base path.
 */
function absolutePathOf(filePath: string, adapter: FileSystemAdapter): string {
  return filePath.startsWith(EXTERNAL_FILE_PREFIX)
    ? filePath.slice(EXTERNAL_FILE_PREFIX.length)
    : adapter.getFullPath(filePath);
}
