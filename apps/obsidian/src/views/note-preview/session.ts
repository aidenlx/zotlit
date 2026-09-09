// One native render owner loads its own Item Snapshot and annotation examples.
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import { parseIndexedKey } from "@zotlit/db";
import { parseLiteratureNoteTemplate } from "@zotlit/templates/facade";
import { managedFrontmatterEntries } from "@zotlit/workbench/document";
import type { ManagedEntrySource } from "@zotlit/workbench/document";
import { SAMPLE_ANNOTATIONS } from "@zotlit/workbench/render";
import type { AnnotationExample } from "@zotlit/workbench/render";
import { exportItemSnapshot } from "@zotlit/workbench/snapshot";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";
import { annotationSamples } from "@zotlit/workbench/ui";
import type {
  RenderScheduler,
  WorkbenchItemChoice,
  PreviewMode,
} from "@zotlit/workbench/ui";

import { getLogger } from "@/lib/log";
import {
  getSampleAnnotationParent,
  getSampleItem,
} from "@/views/profile-editor/selection-data";
import type { ProfileAuthoringContext } from "@/views/profile-editor/view";

import type { NativeRenderDeps, NativeRenderResult } from "./render";

const logger = getLogger(["note-preview", "session"]);

export interface NativePreviewState {
  context: ProfileAuthoringContext | null;
  annotationId: string | null;
  presentation: { scrollTop: number; reveal: string | null; pending: boolean };
  source: string | null;
  sourceProblem: string | null;
  entries: readonly ManagedEntrySource[];
  item: WorkbenchItemChoice | null;
  preview: { mode: PreviewMode; live: boolean };
  status: "empty" | "loading" | "ready" | "error";
  error: string | null;
  showMarkdown: boolean;
  showManaged: boolean;
  snapshot: ItemSnapshot | null;
  current: readonly AnnotationExample[];
  example: AnnotationExample | null;
}
const EMPTY_PREVIEW: NativePreviewState = {
  context: null,
  annotationId: null,
  presentation: { scrollTop: 0, reveal: null, pending: false },
  source: null,
  sourceProblem: null,
  entries: [],
  item: null,
  preview: { mode: "create", live: true },
  status: "empty",
  error: null,
  showMarkdown: false,
  showManaged: false,
  snapshot: null,
  current: [],
  example: null,
};
export const createNativePreviewStore = () =>
  createStore<NativePreviewState>(() => ({ ...EMPTY_PREVIEW }));

export class NativePreviewSession implements Disposable {
  readonly state: StoreApi<NativePreviewState>;
  readonly #deps: NativeRenderDeps;
  readonly #scheduler: RenderScheduler<NativeRenderResult>;
  readonly #cleanup: DisposableStack;
  #dataGeneration = 0;
  #loading: Promise<void>;
  #closed = false;
  constructor(
    deps: NativeRenderDeps,
    scheduler: RenderScheduler<NativeRenderResult>,
    options: {
      item?: WorkbenchItemChoice | null;
      state?: StoreApi<NativePreviewState>;
    } = {},
  ) {
    this.#deps = deps;
    this.#scheduler = scheduler;
    this.state = options.state ?? createNativePreviewStore();
    if (options.item !== undefined) this.state.setState({ item: options.item });
    using cleanup = new DisposableStack();
    cleanup.defer(deps.db.on("changed", () => this.refresh()));
    cleanup.defer(
      deps.templates.on("compile-status-changed", () => scheduler.invalidate()),
    );
    cleanup.defer(
      deps.bibliographyRender.on("invalidated", () => scheduler.invalidate()),
    );
    const modify = deps.app.vault.on("modify", (file) => {
      if (file.path === scheduler.getState().result?.sourcePath)
        scheduler.invalidate();
    });
    cleanup.defer(() => deps.app.vault.offref(modify));
    cleanup.defer(this.#log());
    this.#cleanup = cleanup.move();
    this.#loading = this.#loadSnapshot();
  }
  /** Resolves once the paper a render reads is loaded. */
  get ready(): Promise<void> {
    return this.#loading;
  }
  /** Data choice remains live even while template execution is on demand. */
  refresh(): void {
    if (!this.#closed) this.#loading = this.#loadSnapshot();
  }
  setSource(source: string): void {
    const state = this.state.getState();
    if (
      this.#closed ||
      (source === state.source && state.sourceProblem === null)
    )
      return;
    let sourceProblem: string | null = null;
    let entries = this.state.getState().entries;
    try {
      parseLiteratureNoteTemplate(source);
      const list = managedFrontmatterEntries(source);
      entries = list.status === "rows" ? list.entries : [];
    } catch (error) {
      sourceProblem = error instanceof Error ? error.message : String(error);
    }
    this.state.setState({ source, sourceProblem, entries });
    this.#scheduler.setInput({ source, hold: sourceProblem !== null });
  }
  setItem(item: WorkbenchItemChoice | null): void {
    if (this.#closed || item?.id === this.state.getState().item?.id) return;
    this.state.setState({ item });
    this.refresh();
  }
  setPreview(value: Partial<NativePreviewState["preview"]>): void {
    if (this.#closed) return;
    const preview = { ...this.state.getState().preview, ...value };
    this.state.setState({ preview });
    this.#scheduler.setInput(preview);
  }
  select(id: string | null): void {
    if (this.#closed) return;
    this.state.setState({
      annotationId: id,
      ...(id !== this.state.getState().annotationId
        ? { presentation: { scrollTop: 0, reveal: null, pending: false } }
        : {}),
    });
    const { snapshot, item } = this.state.getState();
    if (snapshot) this.state.setState(annotationSamples(snapshot, id));
    else if (!item)
      this.state.setState({
        example: SAMPLE_ANNOTATIONS.find((sample) => sample.id === id) ?? null,
      });
    this.#feed();
  }
  /**
   * The scheduler decides on its own which render runs and which result the
   * reader sees; this reads its state transitions back out as the log lines a
   * diagnosis needs, so the shared package carries no logger of its own.
   */
  #log(): () => void {
    let previous = this.#scheduler.getState();
    return this.#scheduler.subscribe(() => {
      const next = this.#scheduler.getState();
      const before = previous;
      previous = next;
      if (next.busy === before.busy) return;
      if (next.busy) {
        logger.debug("Preview render started", {
          revision: this.state.getState().snapshot?.revision,
          live: this.state.getState().preview.live,
        });
      } else if (next.result !== null && next.result !== before.result) {
        logger.debug("Preview render published", {
          revision: next.result.snapshotRevision,
          diagnostics: next.result.diagnostics.length,
        });
      } else {
        logger.debug("Discarded stale preview render", {
          revision: this.state.getState().snapshot?.revision,
          closed: this.#closed,
        });
      }
    });
  }
  /** Hands the scheduler the paper and the example every render reads. */
  #feed(): void {
    const { snapshot, example, item } = this.state.getState();
    this.#scheduler.setInput({
      snapshot:
        snapshot ??
        (!item && example ? getSampleAnnotationParent(example.id) : null),
      annotation: example,
    });
  }
  async #loadSnapshot(): Promise<void> {
    const generation = ++this.#dataGeneration;
    logger.debug("Loading preview data", {
      generation,
      item: this.state.getState().item?.id,
    });
    this.state.setState({
      snapshot: null,
      current: [],
      example: !this.state.getState().item
        ? (SAMPLE_ANNOTATIONS.find(
            ({ id }) => id === this.state.getState().annotationId,
          ) ?? null)
        : null,
      error: null,
      status: this.state.getState().item ? "loading" : "empty",
    });
    this.#feed();
    const item = this.state.getState().item;
    if (!item || this.#closed) return;
    try {
      let snapshot = getSampleItem(item.id);
      if (!snapshot) {
        const parsed = item.id.startsWith("sample:")
          ? null
          : parseIndexedKey(item.id);
        if (!parsed) {
          this.state.setState({ status: "error" });
          return;
        }
        using lease = await this.#deps.db.acquireRead();
        if (generation !== this.#dataGeneration || this.#closed) return;
        snapshot = exportItemSnapshot(
          lease.client,
          {
            key: parsed.key,
            library:
              parsed.groupID === null
                ? { type: "personal" }
                : { type: "group", groupID: parsed.groupID },
          },
          {
            provenance: {
              kind: "connected",
              installationId: "obsidian",
              vault: "preview",
            },
          },
        );
      }
      if (generation !== this.#dataGeneration || this.#closed) {
        logger.debug("Discarded stale preview data", {
          generation,
          current: this.#dataGeneration,
          closed: this.#closed,
        });
        return;
      }
      logger.debug("Preview data loaded", {
        generation,
        revision: snapshot.revision,
      });
      this.state.setState({
        snapshot,
        status: "ready",
        ...annotationSamples(snapshot, this.state.getState().annotationId),
      });
      this.#feed();
    } catch (error) {
      if (generation !== this.#dataGeneration || this.#closed) return;
      logger.debug("Preview data failed", { error, item: item.id });
      this.state.setState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      this.#scheduler.fail({
        code: "render-error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  [Symbol.dispose](): void {
    logger.debug("Preview session closed", {
      dataGeneration: this.#dataGeneration,
    });
    this.#closed = true;
    this.#dataGeneration++;
    this.#cleanup.dispose();
  }
}
