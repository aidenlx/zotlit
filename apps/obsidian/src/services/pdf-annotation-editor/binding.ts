// One open Obsidian PDF view bound to the Zotero attachment it shows.
import type {
  FileSystemAdapter,
  PDFFileView,
  PDFPageRenderedListener,
  PDFPageView,
  PDFViewerController,
} from "obsidian";

import { registerDomEvent } from "@/lib/disposables";
import { getLogger } from "@/lib/log";
import type { EditingCapability } from "@/services/annotation-repository/capability";
import type { AnnotationRepository } from "@/services/annotation-repository/service";
import type {
  AttachmentResolution,
  AttachmentResolver,
} from "@/services/attachment-resolver/service";
import { ReaderSessionHost } from "@/services/reader-session/session";
import type { ReaderSession } from "@/services/reader-session/session";

import {
  isEditGesture,
  removeCapabilityAffordance,
  renderCapabilityAffordance,
} from "./capability-affordance";
import { groupAnnotationsByPage, renderAnnotationOverlay } from "./render";
import type { PdfPageAnnotation } from "./render";
import {
  loadedPageOf,
  onPageRendered,
  openFilePathOf,
  pageViewOf,
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

const logger = getLogger("pdf-annotation-editor");

/** Obsidian prefixes an external file's path with this ahead of its absolute path. */
const EXTERNAL_FILE_PREFIX = "file:";

/** How often the affordance is redrawn while Zotero's rate limit runs. */
const COUNTDOWN_INTERVAL = Temporal.Duration.from({ seconds: 1 });

/**
 * What a binding reads Annotations and their Editing Capability through, and
 * hears both of their changes on.
 */
export type AnnotationReads = Pick<
  AnnotationRepository,
  "capability" | "capabilityFor" | "on" | "probe" | "read"
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
export class PdfViewBinding implements Disposable {
  readonly #view;
  readonly #adapter;
  readonly #attachments;
  readonly #annotations;
  readonly #gestures;
  readonly #now;
  readonly #probes = new PdfSeamProbeLog(() => this.filePath);
  /**
   * This view as a reader: what it holds and what is selected in it. ZotLit
   * owns the selection here, so a consumer's `setSelectedAnnotations` is
   * reported straight back.
   */
  readonly #session = new ReaderSessionHost({
    source: "obsidian-pdf",
    navigate: (annotationKey) => this.#navigate(annotationKey),
    select: (annotationKeys) => this.#session.reportSelection(annotationKeys),
  });
  /** Every listener and node this binding added for this view. */
  readonly #surfaces = new DisposableStack();
  /** The pages this binding currently holds an overlay on. */
  readonly #painted = new Set<number>();
  #attachment: AttachmentResolution = { kind: "pending" };
  #filePath: string | null = null;
  #absolutePath: string | null = null;
  #pageProbed = false;
  #probing = Promise.resolve();
  #controller: PDFViewerController | null = null;
  #marks: ReadonlyMap<number, readonly PdfPageAnnotation[]> = new Map();
  #refreshing = Promise.resolve();
  /** Serialises the refreshes, so a slower read never overwrites a later one. */
  #refreshSerial = 0;
  /** Redraws the Editing Capability affordance; a no-op until one is mounted. */
  #drawCapability: () => void = () => undefined;
  #capabilityMounted = false;
  #gesturing = Promise.resolve();

  constructor({
    view,
    adapter,
    attachments,
    annotations,
    capabilityGestures,
    now = () => Temporal.Now.instant(),
  }: PdfViewBindingDeps) {
    this.#view = view;
    this.#adapter = adapter;
    this.#attachments = attachments;
    this.#annotations = annotations;
    this.#gestures = capabilityGestures;
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
    if (!this.supported || this.#attachment.kind !== "resolved") return;
    const { attachmentKey } = this.#attachment;
    this.#mountCapability();
    this.#surfaces.defer(
      this.#annotations.on("annotations-changed", (changedKey) => {
        if (changedKey === attachmentKey) this.#refresh();
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
    this.#mountCapability();

    const onRender: PDFPageRenderedListener = (event) => {
      this.#probes.record(probeRenderEvent(event));
      this.#probePage(pageViewOf(controller, event.pageNumber));
      if (!this.supported) {
        this[Symbol.dispose]();
        return;
      }
      // PDF.js drops every child it does not keep on a zoom, a rotation and a
      // page recycle, so each render rebuilds this page's marks from data.
      this.#paint(event.pageNumber - 1);
    };
    this.#surfaces.use(onPageRendered(controller, onRender));
    this.#probePage(loadedPageOf(controller));
    if (!this.supported) {
      this[Symbol.dispose]();
      return;
    }
    this.#repaint();
  }

  /**
   * The always-present Editing Capability affordance, in the reader's own right
   * toolbar slot, beside the keystrokes that ask to edit under a block.
   *
   * Runs once, when both halves stand: the viewer child that owns the toolbar,
   * and an Attachment this view can edit. A PDF Zotero does not know is left
   * exactly as Obsidian opened it, because there is nothing there to edit and
   * nothing to say about it.
   *
   * The countdown is a `setInterval` on the toolbar's own window, held under
   * this binding's disposer so a closed leaf, a file switch and plugin unload
   * each stop it; the node goes the same way, and its removal is idempotent
   * because Obsidian's own `empty()` on unload may have cleared it first.
   *
   * @see apps/obsidian/docs/adr/0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md
   */
  #mountCapability(): void {
    if (this.#capabilityMounted || this.#attachment.kind !== "resolved") return;
    const controller = this.#controller;
    const slot = controller && toolbarSlotOf(controller);
    if (!slot) return;
    this.#capabilityMounted = true;
    let ticking: number | null = null;
    const stopTicking = (): void => {
      if (ticking === null) return;
      slot.win.clearInterval(ticking);
      ticking = null;
    };

    this.#drawCapability = () => {
      if (this.#surfaces.disposed) return;
      const capability = this.#capability();
      renderCapabilityAffordance(slot, {
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
      removeCapabilityAffordance(slot);
    });
    this.#surfaces.defer(
      this.#annotations.on("capability-changed", () => this.#drawCapability()),
    );
    this.#surfaces.use(
      registerDomEvent(this.#view.containerEl, "keydown", (event) => {
        if (isEditGesture(event)) this.#editGesture();
      }),
    );
    this.#drawCapability();
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
    if (this.#capability().kind === "writable") return;
    this.#gesturing = this.#annotations.probe().then(() => {
      if (this.#surfaces.disposed) return;
      if (this.#attachment.kind !== "resolved") return;
      this.#gestures.reportBlockedGesture(this.#attachment.attachmentKey);
    });
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
          return;
        }
        this.#marks = groupAnnotationsByPage(list.annotations);
        logger.debug("Annotation marks rebuilt for a PDF view", {
          path: this.filePath,
          source: list.source.kind,
          annotations: list.annotations.length,
          pages: this.#marks.size,
        });
        this.#repaint();
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
    const annotations = this.#marks.get(pageIndex) ?? [];
    renderAnnotationOverlay(page, { annotations });
    if (annotations.length > 0) this.#painted.add(pageIndex);
    else this.#painted.delete(pageIndex);
  }

  /** Leaves the reader as Obsidian built it, whatever this binding painted. */
  #unpaint(): void {
    this.#marks = new Map();
    this.#repaint();
    this.#controller = null;
  }

  /** The page-stage probes, run against the first page that reaches them. */
  #probePage(page: PDFPageView | null): void {
    if (this.#pageProbed || !page) return;
    this.#pageProbed = true;
    this.#probes.record(probePageView(page));
    if (this.supported) this.#probing = this.#probeTextContent(page);
  }

  async #probeTextContent(page: PDFPageView): Promise<void> {
    const result = await probeTextContent(page);
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
