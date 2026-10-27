// An in-memory workspace for tests. The test drives it; the tag's own layer
// runs over it (`layerWorkspaceFrom`, or `layerHostApp` from
// ./obsidian-host-app). It copies the shape of ./obsidian-metadata-cache.
import type { EditorView } from "@codemirror/view";
import { MarkdownView, TFile } from "obsidian";
import type {
  Constructor,
  Editor,
  EventRef,
  OpenViewState,
  PaneType,
  View,
  WorkspaceLeaf,
} from "obsidian";

import type { WorkspaceSource } from "@/lib/obsidian-workspace";

import { stubService } from "./service-stub";

type Callback = (...args: unknown[]) => unknown;

/**
 * The layout state, the active file and view, and Obsidian's workspace events
 * of a test host. A module under test that still reads `app.workspace` takes
 * this object, so it sees the same state as the tag.
 */
export class MemoryWorkspace implements WorkspaceSource {
  /** What `getActiveFile` returns. */
  activeFile: TFile | null = null;
  /** The view of the active leaf, for `getActiveViewOfType`. */
  activeView: unknown = null;
  /** The open leaves, by view type, for `getLeavesOfType`. */
  readonly leaves = new Map<string, WorkspaceLeaf[]>();
  /** The path of each editor a dispatch reached, in order. */
  readonly dispatched: string[] = [];
  /** How many times `updateOptions` reconfigured the editors. */
  reconfigures = 0;
  /** Each `openLinkText` call, in order. */
  readonly opened: {
    linktext: string;
    sourcePath: string;
    newLeaf: PaneType | boolean | undefined;
    openViewState: OpenViewState | undefined;
  }[] = [];
  /** What `readWorkspaceFile` answers: the layout Obsidian restored the leaves from. */
  savedLayout: unknown = {};
  /** Each leaf `setActiveLeaf` activated, in order. */
  readonly activated: WorkspaceLeaf[] = [];
  /** The pane of each `getLeaf` call, in order. */
  readonly leafRequests: (PaneType | boolean | undefined)[] = [];
  /**
   * As Obsidian's debounced active-leaf events: `run` opens each file
   * {@link deferOpen} held, now.
   */
  readonly requestActiveLeafEvents = {
    run: (): void => {
      for (const file of this.#deferred.splice(0)) this.open(file);
    },
  };
  readonly #listeners = new Map<string, Set<Callback>>();
  readonly #readyCallbacks: (() => void)[] = [];
  readonly #deferred: TFile[] = [];
  #layoutReady: boolean;

  /** `layoutReady: true` is a plugin enabled at runtime; the default is startup. */
  constructor(options: { layoutReady?: boolean } = {}) {
    this.#layoutReady = options.layoutReady ?? false;
  }

  /** As Obsidian: at once when the layout is ready, else when it is. */
  onLayoutReady(callback: () => void): void {
    if (this.#layoutReady) callback();
    else this.#readyCallbacks.push(callback);
  }

  /** The layout is ready: `layout-ready` fires, then queued callbacks run. */
  layoutReady(): void {
    this.#layoutReady = true;
    this.trigger("layout-ready");
    for (const callback of this.#readyCallbacks.splice(0)) callback();
  }

  getActiveFile(): TFile | null {
    return this.activeFile;
  }

  getActiveViewOfType<T extends View>(type: Constructor<T>): T | null {
    return this.activeView instanceof type ? this.activeView : null;
  }

  getLeavesOfType(type: string): WorkspaceLeaf[] {
    return [...(this.leaves.get(type) ?? [])];
  }

  /** As Obsidian: each open leaf, of every view type. */
  iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => void): void {
    for (const leaves of this.leaves.values()) leaves.forEach(callback);
  }

  /** Open a leaf of `type` that shows `view`. */
  openLeaf(type: string, view: View): WorkspaceLeaf {
    const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", { view });
    const leaves = this.leaves.get(type) ?? [];
    leaves.push(leaf);
    this.leaves.set(type, leaves);
    return leaf;
  }

  /**
   * Open a Markdown leaf showing `path` in an editor; each dispatch to that
   * editor lands in {@link dispatched}.
   */
  openMarkdownEditor(path: string): MarkdownView {
    const file = Object.assign(new TFile(), { path });
    const editor = stubService<Editor>("Editor", {
      cm: stubService<EditorView>("EditorView", {
        dispatch: () => {
          this.dispatched.push(path);
        },
      }),
    });
    const view = Object.assign(
      new MarkdownView(stubService<WorkspaceLeaf>("WorkspaceLeaf", {})),
      { file, editor },
    );
    this.openLeaf("markdown", view);
    return view;
  }

  async readWorkspaceFile(): Promise<unknown> {
    return this.savedLayout;
  }

  updateOptions(): void {
    this.reconfigures += 1;
  }

  /** Records the call; no leaf opens. */
  async openLinkText(
    ...[linktext, sourcePath, newLeaf, openViewState]: Parameters<
      WorkspaceSource["openLinkText"]
    >
  ): Promise<void> {
    this.opened.push({ linktext, sourcePath, newLeaf, openViewState });
  }

  /** Records the pane; the leaf shows no view. */
  getLeaf(newLeaf?: PaneType | boolean): WorkspaceLeaf {
    this.leafRequests.push(newLeaf);
    return stubService<WorkspaceLeaf>("WorkspaceLeaf", {});
  }

  /** Records the leaf; the active file stays. */
  setActiveLeaf(leaf: WorkspaceLeaf): void {
    this.activated.push(leaf);
  }

  /** The active file becomes `file`, then `file-open`. */
  open(file: TFile | null): void {
    this.activeFile = file;
    this.trigger("file-open", file);
  }

  /** Hold an open of `file`, as Obsidian defers it, until `requestActiveLeafEvents.run()`. */
  deferOpen(file: TFile): void {
    this.#deferred.push(file);
  }

  on(name: string, callback: Callback): EventRef {
    let listeners = this.#listeners.get(name);
    if (!listeners) this.#listeners.set(name, (listeners = new Set()));
    listeners.add(callback);
    const ref = { e: this, name, fn: callback };
    return ref;
  }

  offref(ref: EventRef): void {
    const { name, fn } = ref as unknown as { name: string; fn: Callback };
    this.#listeners.get(name)?.delete(fn);
  }

  /** How many listeners are registered for `name`. */
  listenerCount(name: string): number {
    return this.#listeners.get(name)?.size ?? 0;
  }

  /** Call each listener of `name`, in registration order. */
  trigger(name: string, ...args: unknown[]): void {
    for (const callback of this.#listeners.get(name) ?? [])
      callback(...args);
  }
}
