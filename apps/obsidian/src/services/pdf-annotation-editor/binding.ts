// One open Obsidian PDF view bound to the Zotero attachment it shows.
import type {
  FileSystemAdapter,
  PDFFileView,
  PDFPageRenderedListener,
  PDFPageView,
  PDFViewerController,
} from "obsidian";

import { getLogger } from "@/lib/log";
import type { AnnotationRepository } from "@/services/annotation-repository/service";
import type {
  AttachmentResolution,
  ResolveAttachment,
} from "@/services/attachment-resolver/service";

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
  whenViewerReady,
} from "./seam";
import type { PdfSeamProbeResult } from "./seam";

const logger = getLogger("pdf-annotation-editor");

/** Obsidian prefixes an external file's path with this ahead of its absolute path. */
const EXTERNAL_FILE_PREFIX = "file:";

/** What a binding reads Annotations through, and hears their replacement on. */
export type AnnotationReads = Pick<AnnotationRepository, "read" | "on">;

export interface PdfViewBindingDeps {
  view: PDFFileView;
  adapter: FileSystemAdapter;
  resolveAttachment: ResolveAttachment;
  annotations: AnnotationReads;
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
  readonly #resolveAttachment;
  readonly #annotations;
  readonly #probes = new PdfSeamProbeLog(() => this.filePath);
  /** Every listener and node the reader surfaces added for this view. */
  readonly #surfaces = new DisposableStack();
  /** The pages this binding currently holds an overlay on. */
  readonly #painted = new Set<number>();
  #attachment: AttachmentResolution = { kind: "unresolved" };
  #filePath: string | null = null;
  #absolutePath: string | null = null;
  #pageProbed = false;
  #probing = Promise.resolve();
  #controller: PDFViewerController | null = null;
  #marks: ReadonlyMap<number, readonly PdfPageAnnotation[]> = new Map();
  #refreshing = Promise.resolve();
  /** Serialises the refreshes, so a slower read never overwrites a later one. */
  #refreshSerial = 0;

  constructor({
    view,
    adapter,
    resolveAttachment,
    annotations,
  }: PdfViewBindingDeps) {
    this.#view = view;
    this.#adapter = adapter;
    this.#resolveAttachment = resolveAttachment;
    this.#annotations = annotations;
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

  get attachment(): AttachmentResolution {
    return this.#attachment;
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

  load(): void {
    this.#probes.record(probeFileView(this.#view));
    const filePath = openFilePathOf(this.#view);
    this.#filePath = filePath;
    if (filePath === null) {
      logger.debug("PDF view holds no file yet");
      return;
    }
    this.#absolutePath = absolutePathOf(filePath, this.#adapter);
    this.#attachment = this.#resolveAttachment(this.#absolutePath);
    logger.debug("PDF view resolved", {
      path: filePath,
      attachment: this.#attachment,
    });
    if (!this.supported) return;
    if (this.#attachment.kind === "resolved") {
      const { attachmentKey } = this.#attachment;
      this.#surfaces.defer(
        this.#annotations.on("annotations-changed", (changedKey) => {
          if (changedKey === attachmentKey) this.#refresh();
        }),
      );
      this.#surfaces.defer(() => this.#unpaint());
      this.#refresh();
    }
    whenViewerReady(this.#view.viewer, (controller) =>
      this.#attach(controller),
    );
  }

  [Symbol.dispose](): void {
    this.#surfaces.dispose();
  }

  #attach(controller: PDFViewerController): void {
    if (this.#surfaces.disposed) return;
    this.#probes.record(probeController(this.#view.viewer, controller));
    if (!this.supported) return;

    this.#controller = controller;

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
