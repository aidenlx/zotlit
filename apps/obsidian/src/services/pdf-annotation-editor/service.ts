// Keeps one guarded binding per open Obsidian PDF view.
import type { App, FileSystemAdapter, PDFFileView } from "obsidian";

import { registerEvent } from "@/lib/disposables";
import { Service } from "@/services/service-base";

import { PdfViewBinding } from "./binding";
import type { ResolveAttachment } from "./binding";
import { openFilePathOf } from "./seam";

export type {
  AttachmentResolution,
  PdfViewBinding,
  ResolveAttachment,
} from "./binding";
export type { PdfSeamProbeId, PdfSeamProbeResult } from "./seam";

/** Obsidian's own view type for a PDF, in the vault and outside it alike. */
const PDF_VIEW_TYPE = "pdf";

export interface PdfAnnotationEditorDeps {
  app: App;
  resolveAttachment: ResolveAttachment;
}

/**
 * Owns the one guarded adapter to Obsidian's private PDF reader seam, and a
 * binding per open PDF view: created on file open and layout change, disposed
 * on file switch, leaf close, and plugin unload.
 *
 * Holds no database client. The attachment it binds a view to arrives through
 * the injected {@link ResolveAttachment}, so a seam that changed shape costs
 * the reader its surfaces and leaves every other ZotLit surface alone.
 */
export class PdfAnnotationEditor extends Service<void> {
  readonly #app;
  readonly #resolveAttachment;
  readonly #bindings = new Map<PDFFileView, PdfViewBinding>();
  #retired = false;

  ready: Promise<void>;

  constructor({ app, resolveAttachment }: PdfAnnotationEditorDeps) {
    super();
    this.#app = app;
    this.#resolveAttachment = resolveAttachment;
    this.ready = this.#load();
  }

  /** The live binding for each open PDF view, in workspace order. */
  get bindings(): readonly PdfViewBinding[] {
    return [...this.#bindings.values()];
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
        resolveAttachment: this.#resolveAttachment,
      });
      this.#bindings.set(view, binding);
      binding.load();
    }
  }
}
