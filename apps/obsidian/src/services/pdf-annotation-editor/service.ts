// Keeps one guarded binding per open Obsidian PDF view.
import type { App, FileSystemAdapter, PDFFileView } from "obsidian";

import { registerEvent } from "@/lib/disposables";
import type { ReaderSession } from "@/services/reader-session/session";
import { Service } from "@/services/service-base";

import { PdfViewBinding } from "./binding";
import type {
  AnnotationReads,
  AttachmentReads,
  CapabilityGestures,
} from "./binding";
import { openFilePathOf } from "./seam";
import type { MarkGestures } from "./selection";

// Re-exported so a consumer of the reader seam reaches the resolution it binds
// a view to without naming the resolver service.
export type { AttachmentResolution } from "@/services/attachment-resolver/service";
export type {
  ReaderSession,
  ReaderSessionTarget,
} from "@/services/reader-session/session";
export type {
  AnnotationReads,
  AttachmentReads,
  CapabilityGestures,
  PdfViewBinding,
} from "./binding";
export type { MarkGestures } from "./selection";
export type { PdfSeamProbeId, PdfSeamProbeResult } from "./seam";

/** Obsidian's own view type for a PDF, in the vault and outside it alike. */
const PDF_VIEW_TYPE = "pdf";

export interface PdfAnnotationEditorDeps {
  app: App;
  attachments: AttachmentReads;
  annotations: AnnotationReads;
  /** What the Editing Capability affordance and a blocked keystroke reach. */
  capabilityGestures: CapabilityGestures;
  /** What the Mark Popup's reveal and comment verbs reach in the sidebar. */
  markGestures: Pick<MarkGestures, "revealAnnotation">;
  /** The clock each binding's cooldown countdown is read against. */
  now?: () => Temporal.Instant;
}

/**
 * Owns the one guarded adapter to Obsidian's private PDF reader seam, and a
 * binding per open PDF view: created on file open and layout change, disposed
 * on file switch, leaf close, and plugin unload.
 *
 * Holds no database client. The attachment it binds a view to arrives through
 * the injected {@link AttachmentReads} and its Annotations through the
 * repository, so a seam that changed shape costs the reader its surfaces and
 * leaves every other ZotLit surface alone.
 */
export class PdfAnnotationEditor extends Service<void> {
  readonly #app;
  readonly #attachments;
  readonly #annotations;
  readonly #capabilityGestures;
  readonly #markGestures;
  readonly #now;
  readonly #bindings = new Map<PDFFileView, PdfViewBinding>();
  #retired = false;

  ready: Promise<void>;

  constructor({
    app,
    attachments,
    annotations,
    capabilityGestures,
    markGestures,
    now = () => Temporal.Now.instant(),
  }: PdfAnnotationEditorDeps) {
    super();
    this.#app = app;
    this.#attachments = attachments;
    this.#annotations = annotations;
    this.#capabilityGestures = capabilityGestures;
    this.#markGestures = markGestures;
    this.#now = now;
    this.ready = this.#load();
  }

  /** The live binding for each open PDF view, in workspace order. */
  get bindings(): readonly PdfViewBinding[] {
    return [...this.#bindings.values()];
  }

  /**
   * @param filePath a vault path, or a `file:`-prefixed absolute path for an
   *   external file — the same spelling Obsidian gives the open file.
   * @returns that PDF view as a Reader Session, or `null` while no open PDF
   *   view holds the file.
   */
  sessionForPath(filePath: string): ReaderSession | null {
    for (const binding of this.#bindings.values()) {
      if (binding.filePath === filePath) return binding.session;
    }
    return null;
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    const { workspace } = this.#app;
    stack.use(
      registerEvent(workspace.on("file-open", () => this.#reconcileViews())),
    );
    stack.use(
      registerEvent(
        workspace.on("layout-change", () => this.#reconcileViews()),
      ),
    );
    stack.defer(() => {
      this.#retired = true;
      for (const binding of this.#bindings.values()) binding[Symbol.dispose]();
      this.#bindings.clear();
    });

    workspace.onLayoutReady(() => this.#reconcileViews());
    this.commit(stack.move());
  }

  #reconcileViews(): void {
    if (this.#retired) return;
    const views = this.#app.workspace
      .getLeavesOfType(PDF_VIEW_TYPE)
      .map((leaf) => leaf.view as PDFFileView);
    const open = new Set(views);

    for (const [view, binding] of this.#bindings) {
      // A view that swapped files gets a fresh binding, so the seam probes and
      // the attachment resolution both run again for the file now on screen.
      if (open.has(view) && binding.filePath === openFilePathOf(view)) continue;
      binding[Symbol.dispose]();
      this.#bindings.delete(view);
    }

    // Desktop-only plugin: the adapter is always a FileSystemAdapter.
    const adapter = this.#app.vault.adapter as FileSystemAdapter;
    for (const view of views) {
      if (this.#bindings.has(view)) continue;
      const binding = new PdfViewBinding({
        view,
        adapter,
        attachments: this.#attachments,
        annotations: this.#annotations,
        capabilityGestures: this.#capabilityGestures,
        markGestures: this.#markGestures,
        now: this.#now,
      });
      this.#bindings.set(view, binding);
      binding.load();
    }
  }
}
