// One editor's paper for the preview: the Item Snapshot a render is shown
// against and the annotation examples the reader chooses between. Scheduling is
// the shared Render Scheduler's; this session only feeds it what Obsidian alone
// can read, and tells it when something outside the document changed.
import { createStore } from "zustand/vanilla";

import { parseIndexedKey } from "@zotlit/db";
import type { AnnotationExample } from "@zotlit/workbench/render";
import { exportItemSnapshot } from "@zotlit/workbench/snapshot";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";
import { annotationSamples } from "@zotlit/workbench/ui";
import type { RenderScheduler, WorkbenchStore } from "@zotlit/workbench/ui";

import { getLogger } from "@/lib/log";

import type { NativeRenderDeps, NativeRenderResult } from "./render";

const logger = getLogger(["note-preview", "session"]);

export interface NativePreviewState {
  snapshot: ItemSnapshot | null;
  current: readonly AnnotationExample[];
  example: AnnotationExample | null;
}
const EMPTY_PREVIEW: NativePreviewState = {
  snapshot: null,
  current: [],
  example: null,
};
export class NativePreviewSession implements Disposable {
  readonly state = createStore<NativePreviewState>(() => ({
    ...EMPTY_PREVIEW,
  }));
  readonly #deps: NativeRenderDeps;
  readonly #store: WorkbenchStore;
  readonly #scheduler: RenderScheduler<NativeRenderResult>;
  readonly #cleanup: DisposableStack;
  #dataGeneration = 0;
  #loading: Promise<void>;
  #selection: string | null = null;
  #closed = false;
  constructor(
    deps: NativeRenderDeps,
    scheduler: RenderScheduler<NativeRenderResult>,
    store: WorkbenchStore,
  ) {
    this.#deps = deps;
    this.#scheduler = scheduler;
    this.#store = store;
    using cleanup = new DisposableStack();
    cleanup.defer(
      store.subscribe((state, previous) => {
        if (state.item?.id !== previous.item?.id) this.refresh();
      }),
    );
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
    this.#loading = this.#loadSnapshot();
  }
  select(id: string): void {
    this.#selection = id;
    const snapshot = this.state.getState().snapshot;
    if (snapshot) this.state.setState(annotationSamples(snapshot, id));
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
          live: this.#store.getState().preview.live,
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
    const { snapshot, example } = this.state.getState();
    this.#scheduler.setInput({ snapshot, annotation: example });
  }
  async #loadSnapshot(): Promise<void> {
    const generation = ++this.#dataGeneration;
    logger.debug("Loading preview data", {
      generation,
      item: this.#store.getState().item?.id,
    });
    this.state.setState({ ...EMPTY_PREVIEW });
    this.#feed();
    const item = this.#store.getState().item;
    if (!item || this.#closed) return;
    try {
      const parsed = parseIndexedKey(item.id);
      if (!parsed) return;
      let snapshot: ItemSnapshot;
      {
        using lease = await this.#deps.db.acquireRead();
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
        ...annotationSamples(snapshot, this.#selection),
      });
      this.#feed();
    } catch (error) {
      if (generation !== this.#dataGeneration || this.#closed) return;
      logger.debug("Preview data failed", { error, item: item.id });
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
