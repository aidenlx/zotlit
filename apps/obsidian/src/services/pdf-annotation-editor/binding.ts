// One open Obsidian PDF view bound to the Zotero attachment it shows.
import type {
  FileSystemAdapter,
  PDFFileView,
  PDFPageRenderedListener,
  PDFPageView,
  PDFViewerController,
} from "obsidian";

import { getLogger } from "@/lib/log";
import type {
  AttachmentResolution,
  ResolveAttachment,
} from "@/services/attachment-resolver/service";

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

export interface PdfViewBindingDeps {
  view: PDFFileView;
  adapter: FileSystemAdapter;
  resolveAttachment: ResolveAttachment;
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
  readonly #probes = new PdfSeamProbeLog(() => this.filePath);
  /** Every listener and node the reader surfaces added for this view. */
  readonly #surfaces = new DisposableStack();
  #attachment: AttachmentResolution = { kind: "unresolved" };
  #filePath: string | null = null;
  #absolutePath: string | null = null;
  #pageProbed = false;
  #probing = Promise.resolve();

  constructor({ view, adapter, resolveAttachment }: PdfViewBindingDeps) {
    this.#view = view;
    this.#adapter = adapter;
    this.#resolveAttachment = resolveAttachment;
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

    const onRender: PDFPageRenderedListener = (event) => {
      this.#probes.record(probeRenderEvent(event));
      this.#probePage(pageViewOf(controller, event.pageNumber));
      if (!this.supported) this[Symbol.dispose]();
    };
    this.#surfaces.use(onPageRendered(controller, onRender));
    this.#probePage(loadedPageOf(controller));
    if (!this.supported) this[Symbol.dispose]();
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
