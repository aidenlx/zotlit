// One Explorer owns its input references, inert data, navigation, and load lifetime.
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { parseIndexedKey } from "@zotlit/db";
import {
  initialTreeState,
  setAnchor,
  setFilter,
  toggleNode,
} from "@zotlit/workbench/explorer";
import type { TreeState } from "@zotlit/workbench/explorer";
import {
  restoreTemplateData,
  SAMPLE_ANNOTATIONS,
} from "@zotlit/workbench/render";
import type { AnnotationExample } from "@zotlit/workbench/render";
import type {
  ExplorerVariant,
  ExplorerPresentation,
  TemplateRoot,
  WorkbenchItemChoice,
} from "@zotlit/workbench/ui";
import { annotationSamples } from "@zotlit/workbench/ui";

import { getLogger } from "@/lib/log";
import { indexedKeyForClipboard } from "@/services/indexed-key/actions";
import { loadTemplateData } from "@/services/template-workbench/data";
import type {
  TemplateDataDeps,
  TemplateDataLoadResult,
} from "@/services/template-workbench/data";
import { getSampleItem } from "@/views/profile-editor/selection-data";
import type { ProfileAuthoringContext } from "@/views/profile-editor/view";

const logger = getLogger(["views", "template-data-explorer"]);
export interface ExplorerState {
  sourcePath: string | null;
  presentation: ExplorerPresentation;
  restore: ExplorerPresentation | null;
  context: ProfileAuthoringContext | null;
  item: WorkbenchItemChoice | null;
  root: TemplateRoot;
  annotationId: string | null;
  annotations: readonly Pick<AnnotationExample, "id" | "root">[] | null;
  data: Record<string, unknown> | null;
  status: "no-item" | "loading" | "ready" | "empty" | "error";
  error: string | null;
  navigation: TreeState;
  variant: ExplorerVariant;
  setNavigation: (navigation: TreeState) => void;
  setFilter: (query: string) => void;
  toggleNode: (key: string) => void;
  setVariant: (variant: ExplorerVariant) => void;
}
export function createExplorerStore() {
  return createStore<ExplorerState>()((set) => ({
    sourcePath: null,
    presentation: { top: 0, left: 0, field: null },
    restore: null,
    context: null,
    item: null,
    root: "note",
    annotationId: null,
    annotations: null,
    data: null,
    status: "no-item",
    error: null,
    navigation: initialTreeState(),
    variant: "simple",
    setNavigation: (navigation) => set({ navigation }),
    setFilter: (query) =>
      set((state) => ({ navigation: setFilter(state.navigation, query) })),
    toggleNode: (key) =>
      set((state) => ({ navigation: toggleNode(state.navigation, key) })),
    setVariant: (variant) => set({ variant }),
  }));
}
export type ExplorerStore = ReturnType<typeof createExplorerStore>;
export class NativeExplorerSession implements Disposable {
  readonly state = createExplorerStore();
  readonly #deps: TemplateDataDeps;
  #generation = 0;
  #closed = false;
  #loading = Promise.resolve();
  constructor(deps: TemplateDataDeps) {
    this.#deps = deps;
  }
  get ready(): Promise<void> {
    return this.#loading;
  }
  setContext(context: ProfileAuthoringContext): void {
    if (this.#closed) return;
    const previous = this.state.getState().context;
    this.state.setState({ context, sourcePath: context.path });
    // Display-only editor changes leave an Explorer's own annotation navigation intact.
    if (
      !previous ||
      previous.item?.id !== context.item?.id ||
      previous.root !== context.root
    )
      this.setTarget(
        context.item,
        context.root,
        context.root === "annotation" ? context.annotationId : null,
      );
    else if (
      this.state.getState().root === "annotation" &&
      previous.annotationId !== context.annotationId
    )
      this.setTarget(context.item, "annotation", context.annotationId);
  }
  setTarget(
    item: WorkbenchItemChoice | null,
    root: TemplateRoot,
    annotationId: string | null = null,
  ): void {
    if (this.#closed) return;
    const previous = this.state.getState();
    const anchor = root === "note" ? null : (annotationId ?? root);
    const navigation =
      previous.item?.id !== item?.id
        ? initialTreeState(anchor)
        : previous.root !== root || previous.annotationId !== annotationId
          ? setAnchor(previous.navigation, anchor)
          : previous.navigation;
    logger.debug("Explorer target changed", {
      indexedKey: item?.id,
      root,
      annotationId,
    });
    this.state.setState({
      item,
      root,
      annotationId,
      ...(previous.item?.id !== item?.id ? { annotations: null } : {}),
      navigation,
      ...(previous.item?.id !== item?.id ||
      previous.root !== root ||
      previous.annotationId !== annotationId
        ? { presentation: { top: 0, left: 0, field: null }, restore: null }
        : {}),
    });
    this.refresh();
  }
  refresh(): void {
    if (!this.#closed) this.#loading = this.#load();
  }
  async #load(): Promise<void> {
    const generation = ++this.#generation;
    const { item, root, annotationId } = this.state.getState();
    const sample =
      root === "annotation"
        ? SAMPLE_ANNOTATIONS.find(({ id }) => id === annotationId)
        : undefined;
    const snapshot = item ? getSampleItem(item.id) : null;
    this.state.setState({
      data: null,
      error: null,
      status: item || sample ? "loading" : "no-item",
    });
    logger.debug("Explorer data load started", {
      generation,
      indexedKey: item?.id,
      root,
    });
    if (!item && !sample) return;
    try {
      if (sample) {
        this.state.setState({
          data: restoreTemplateData(sample.root, sample.descriptors),
          status: "ready",
          annotations: snapshot
            ? annotationSamples(snapshot, annotationId).current
            : (this.state.getState().annotations ?? []),
        });
        if (!item || snapshot) return;
      }
      if (!item) return;
      const loadRoot = (
        key: string,
        target: TemplateRoot,
      ): Promise<TemplateDataLoadResult> => {
        if (!item.id.startsWith("sample:"))
          return loadTemplateData(this.#deps, key, target);
        if (!snapshot) return Promise.resolve({ kind: "not-found" });
        if (target !== "annotation")
          return Promise.resolve({
            kind: "data",
            data: restoreTemplateData(
              snapshot.roots[target],
              snapshot.descriptors[target],
            ),
          });
        const selected = annotationSamples(snapshot, annotationId).current.find(
          ({ id, root }) => id === annotationId || root.indexedKey === key,
        );
        return Promise.resolve(
          selected
            ? {
                kind: "data",
                data: restoreTemplateData(selected.root, selected.descriptors),
              }
            : { kind: annotationId ? "not-found" : "annotation-required" },
        );
      };
      const key =
        root === "annotation" && !sample
          ? (annotationIndexedKey(item.id, annotationId) ?? item.id)
          : item.id;
      const note =
        root === "annotation" ? await loadRoot(item.id, "note") : null;
      if (note) {
        if (this.#closed || generation !== this.#generation) {
          logger.trace("Discarded stale Explorer annotation choices", {
            generation,
            current: this.#generation,
            closed: this.#closed,
          });
          return;
        }
        if (note.kind === "data") {
          const values = (note.data as Record<string, unknown>).annotations;
          this.state.setState({
            annotations: snapshot
              ? annotationSamples(snapshot, annotationId).current
              : Array.isArray(values)
                ? values.flatMap((value: unknown) => {
                    if (
                      !value ||
                      typeof value !== "object" ||
                      !("key" in value) ||
                      typeof value.key !== "string"
                    )
                      return [];
                    const id = annotationIndexedKey(item.id, value.key);
                    return id
                      ? [{ id, root: value as Record<string, unknown> }]
                      : [];
                  })
                : [],
          });
        }
      }
      if (sample) return;
      const result = await loadRoot(key, root);
      if (this.#closed || generation !== this.#generation) {
        logger.trace("Discarded stale Explorer data", {
          generation,
          current: this.#generation,
          closed: this.#closed,
        });
        return;
      }
      if (result.kind !== "data") {
        logger.debug("Explorer data unavailable", {
          generation,
          indexedKey: key,
          root,
          reason: result.kind,
        });
        this.state.setState({
          status: result.kind === "annotation-required" ? "empty" : "error",
        });
        return;
      }
      const data = result.data as Record<string, unknown>;
      logger.debug("Explorer data loaded", {
        generation,
        indexedKey: key,
        root,
        fields: Object.keys(data).length,
      });
      this.state.setState({
        data,
        status: Object.keys(data).length ? "ready" : "empty",
      });
    } catch (error) {
      if (this.#closed || generation !== this.#generation) {
        logger.trace("Discarded stale Explorer data", {
          generation,
          current: this.#generation,
          closed: this.#closed,
        });
        return;
      }
      logger.warn("Explorer data load failed", {
        error,
        indexedKey: item?.id,
        root,
      });
      if (sample && this.state.getState().data !== null) return;
      this.state.setState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  [Symbol.dispose](): void {
    this.#closed = true;
    this.#generation++;
    this.state.setState({
      context: null,
      item: null,
      data: null,
      annotations: null,
      status: "no-item",
    });
  }
}
const ExplorerStoreContext = createContext<ExplorerStore | null>(null);
export const ExplorerStoreProvider = ExplorerStoreContext.Provider;
export function useExplorerStoreApi(): ExplorerStore {
  const store = useContext(ExplorerStoreContext);
  if (!store) throw new Error("ExplorerStoreProvider is required");
  return store;
}

export function useExplorerStore<T>(selector: (s: ExplorerState) => T): T {
  return useStore(useExplorerStoreApi(), selector);
}

/** Restored anchors use bare keys; copied authoring selections carry Indexed Keys. */
export function annotationIndexedKey(
  itemId: string,
  selectionId: string | null,
): string | null {
  if (!selectionId || SAMPLE_ANNOTATIONS.some(({ id }) => id === selectionId))
    return null;
  const selection: unknown = selectionId.startsWith("[")
    ? JSON.parse(selectionId)
    : selectionId;
  const key = Array.isArray(selection) ? selection[1] : selection;
  if (typeof key !== "string") return null;
  const annotation = parseIndexedKey(key);
  const item = parseIndexedKey(
    getSampleItem(itemId)?.item.indexedKey ?? itemId,
  );
  return annotation && item
    ? indexedKeyForClipboard({
        key: annotation.key,
        groupID: annotation.groupID ?? item.groupID,
      })
    : null;
}
