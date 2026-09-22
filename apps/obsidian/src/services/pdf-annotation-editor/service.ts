// Keeps one guarded binding per open Obsidian PDF view.
import type {
  App,
  FileSystemAdapter,
  PDFFileView,
  WorkspaceLeaf,
} from "obsidian";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { registerEvent } from "@/lib/disposables";
import type { BorrowedExcerptDocument } from "@/services/excerpt-image/reader-borrow";
import type { ReaderSession } from "@/services/reader-session/session";
import { Service } from "@/services/service-base";
import type { SettingsService } from "@/services/settings/service";

import { registerAnnotationAnchorCapture } from "./anchor-capture";
import { PdfViewBinding } from "./binding";
import type {
  AnnotationReads,
  AttachmentReads,
  CapabilityGestures,
} from "./binding";
import { openFilePathOf, PDF_VIEW_TYPE } from "./seam";
import type { MarkGestures } from "./selection";
import { resolveToolColors, TOOL_COLORS_SETTING } from "./tools";
import type { AnnotationTool, ToolColorStore } from "./tools";

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

export interface PdfAnnotationEditorDeps {
  app: App;
  attachments: AttachmentReads;
  annotations: AnnotationReads;
  /** What the Editing Capability affordance and a blocked keystroke reach. */
  capabilityGestures: CapabilityGestures;
  /** What the Mark Popup's reveal and comment verbs reach in the sidebar. */
  markGestures: Pick<MarkGestures, "revealAnnotation">;
  /** Where each annotation tool's colour is kept, so it holds across PDFs. */
  settings: Pick<SettingsService, "current" | "update">;
  /** The clock each binding's cooldown countdown is read against. */
  now?: () => Temporal.Instant;
}

export interface PdfAnnotationEditorEvents {
  "session-added": (filePath: string) => void;
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
  readonly #toolColors;
  readonly #now;
  readonly #emitter = createNanoEvents<PdfAnnotationEditorEvents>();
  readonly #bindings = new Map<PDFFileView, PdfViewBinding>();
  #retired = false;

  ready: Promise<void>;

  constructor({
    app,
    attachments,
    annotations,
    capabilityGestures,
    markGestures,
    settings,
    now = () => Temporal.Now.instant(),
  }: PdfAnnotationEditorDeps) {
    super();
    this.#app = app;
    this.#attachments = attachments;
    this.#annotations = annotations;
    this.#capabilityGestures = capabilityGestures;
    this.#markGestures = markGestures;
    this.#toolColors = toolColorStore(settings);
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

  /**
   * The document an open PDF view holds for a file, for excerpt work that
   * crops from the reader instead of loading the file again.
   *
   * @param absolutePath the file's absolute path, the one an excerpt request
   *   resolves for an Attachment.
   * @returns that view's document, or `null` while no open view holds the file
   *   or holds no document for it yet.
   */
  borrowDocument(absolutePath: string): BorrowedExcerptDocument | null {
    for (const binding of this.#bindings.values()) {
      if (binding.absolutePath === absolutePath) return binding.borrow();
    }
    return null;
  }

  on<K extends keyof PdfAnnotationEditorEvents>(
    event: K,
    cb: PdfAnnotationEditorEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
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
    stack.use(
      registerEvent(
        workspace.on("active-leaf-change", (leaf) => {
          if (leaf) this.#bindings.get(leaf.view as PDFFileView)?.activate();
        }),
      ),
    );
    // A view already open takes its Anchor here: the patch fires on every open,
    // and a cold one has no binding yet — that one lands off its first read.
    stack.use(
      registerAnnotationAnchorCapture({
        onAnchor: (leaf) => this.#landAnchor(leaf),
      }),
    );
    stack.defer(() => {
      this.#retired = true;
      for (const binding of this.#bindings.values()) binding[Symbol.dispose]();
      this.#bindings.clear();
    });

    workspace.onLayoutReady(() => this.#reconcileViews());
    this.commit(stack.move());
  }

  /** Re-aims a PDF view that is already open at the Annotation an Anchor named. */
  #landAnchor(leaf: WorkspaceLeaf): void {
    if (this.#retired) return;
    this.#bindings.get(leaf.view as PDFFileView)?.land();
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
        toolColors: this.#toolColors,
        now: this.#now,
      });
      this.#bindings.set(view, binding);
      binding.load();
      if (binding.filePath)
        this.#emitter.emit("session-added", binding.filePath);
    }
  }
}

/**
 * Each tool's colour, read and written through the settings file, so a colour
 * chosen in one PDF is the colour the next one opens with. A choice made before
 * the settings have loaded is dropped rather than written over what is on disk.
 */
function toolColorStore(
  settings: Pick<SettingsService, "current" | "update">,
): ToolColorStore {
  return {
    current: () => resolveToolColors(settings.current?.[TOOL_COLORS_SETTING]),
    set: (tool: AnnotationTool, color: string) => {
      const stored = settings.current?.[TOOL_COLORS_SETTING];
      if (!stored) return;
      settings.update({ [TOOL_COLORS_SETTING]: { ...stored, [tool]: color } });
    },
  };
}
