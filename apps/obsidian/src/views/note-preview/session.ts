// One editor's paper data and render queue; Stop lets the running render finish.
import { useSyncExternalStore } from "react";
import { createStore } from "zustand/vanilla";

import { parseIndexedKey } from "@zotlit/db";
import type { WorkbenchDocumentController } from "@zotlit/workbench/document";
import type { AnnotationExample } from "@zotlit/workbench/render";
import { failedRender, profileSourceRevision } from "@zotlit/workbench/render";
import { exportItemSnapshot } from "@zotlit/workbench/snapshot";
import type { ItemSnapshot } from "@zotlit/workbench/snapshot";
import { annotationSamples } from "@zotlit/workbench/ui";
import type { WorkbenchStore } from "@zotlit/workbench/ui";

import { renderNativeProfile } from "./render";
import type { NativeRenderDeps, NativeRenderResult } from "./render";

export interface NativePreviewState {
  result: NativeRenderResult | null;
  snapshot: ItemSnapshot | null;
  current: readonly AnnotationExample[];
  example: AnnotationExample | null;
  busy: boolean;
}
const EMPTY_PREVIEW: NativePreviewState = {
  result: null,
  snapshot: null,
  current: [],
  example: null,
  busy: false,
};
const emptySubscribe = () => () => {};
const emptyState = () => EMPTY_PREVIEW;
export function useNativePreview(
  session: NativePreviewSession | null,
): NativePreviewState {
  return useSyncExternalStore(
    session?.state.subscribe ?? emptySubscribe,
    session?.state.getState ?? emptyState,
  );
}
export class NativePreviewSession implements Disposable {
  readonly state = createStore<NativePreviewState>(() => ({
    ...EMPTY_PREVIEW,
  }));
  readonly #deps: NativeRenderDeps;
  readonly #store: WorkbenchStore;
  readonly #cleanup: DisposableStack;
  #controller: WorkbenchDocumentController;
  #sourceSubscription: () => void;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #generation = 0;
  #dataGeneration = 0;
  #loading: Promise<void>;
  #selection: string | null = null;
  #closed = false;
  constructor(
    deps: NativeRenderDeps,
    controller: WorkbenchDocumentController,
    store: WorkbenchStore,
  ) {
    this.#deps = deps;
    this.#controller = controller;
    this.#store = store;
    using cleanup = new DisposableStack();
    this.#sourceSubscription = controller.subscribe(({ docChanged }) => {
      if (docChanged) this.changed();
    });
    cleanup.defer(() => this.#sourceSubscription());
    cleanup.defer(
      store.subscribe((state, previous) => {
        if (state.item?.id !== previous.item?.id) this.refresh();
        else if (state.preview.mode !== previous.preview.mode) this.changed();
        else if (state.preview.live !== previous.preview.live) {
          if (state.preview.live) this.changed();
          else this.pause();
        }
      }),
    );
    cleanup.defer(deps.db.on("changed", () => this.refresh()));
    cleanup.defer(
      deps.templates.on("compile-status-changed", () => this.changed()),
    );
    cleanup.defer(
      deps.bibliographyRender.on("invalidated", () => this.changed()),
    );
    const modify = deps.app.vault.on("modify", (file) => {
      if (file.path === this.state.getState().result?.sourcePath)
        this.changed();
    });
    cleanup.defer(() => deps.app.vault.offref(modify));
    this.#cleanup = cleanup.move();
    this.#loading = this.#loadSnapshot();
  }
  attach(controller: WorkbenchDocumentController): void {
    this.#sourceSubscription();
    this.#controller = controller;
    this.#sourceSubscription = controller.subscribe(({ docChanged }) => {
      if (docChanged) this.changed();
    });
    this.changed();
  }
  /** Data choice remains live even while template execution is on demand. */
  refresh(): void {
    this.#loading = this.#loadSnapshot();
  }
  select(id: string): void {
    this.#selection = id;
    const snapshot = this.state.getState().snapshot;
    if (snapshot) this.state.setState(annotationSamples(snapshot, id));
    this.changed();
  }
  changed(): void {
    this.#generation++;
    this.state.setState({ busy: false });
    this.pause();
    if (this.#store.getState().preview.live)
      this.#timer = setTimeout(() => {
        void this.run();
      }, 300);
  }
  pause(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
  async #loadSnapshot(): Promise<void> {
    const generation = ++this.#dataGeneration;
    this.#generation++;
    this.pause();
    this.state.setState({ ...EMPTY_PREVIEW });
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
      if (generation !== this.#dataGeneration || this.#closed) return;
      this.state.setState({
        snapshot,
        ...annotationSamples(snapshot, this.#selection),
      });
      this.changed();
    } catch (error) {
      if (generation === this.#dataGeneration && !this.#closed)
        this.#failed(error, item.id);
    }
  }
  async run(): Promise<void> {
    const item = this.#store.getState().item;
    if (!item || this.#closed) return;
    await this.#loading;
    if (this.#closed || this.#store.getState().item?.id !== item.id) return;
    const { snapshot, example } = this.state.getState();
    if (!snapshot || !example) return;
    this.pause();
    const generation = ++this.#generation;
    this.state.setState({ busy: true });
    try {
      const result = await renderNativeProfile(this.#deps, {
        source: this.#controller.source,
        snapshot,
        mode: this.#store.getState().preview.mode,
        annotation: example,
      });
      if (generation === this.#generation && !this.#closed)
        this.state.setState({ result });
    } catch (error) {
      if (generation === this.#generation && !this.#closed)
        this.#failed(error, snapshot.revision);
    } finally {
      if (generation === this.#generation && !this.#closed)
        this.state.setState({ busy: false });
    }
  }
  #failed(error: unknown, snapshotRevision: string): void {
    this.state.setState({
      result: {
        ...failedRender(
          {
            sourceRevision: profileSourceRevision(this.#controller.source),
            snapshotRevision,
            previewMode: this.#store.getState().preview.mode,
          },
          {
            code: "render-error",
            message: error instanceof Error ? error.message : String(error),
          },
        ),
        sourcePath: "",
        citations: [],
        annotationCitations: [],
      },
    });
  }
  [Symbol.dispose](): void {
    this.#closed = true;
    this.#generation++;
    this.#dataGeneration++;
    this.pause();
    this.#cleanup.dispose();
  }
}
