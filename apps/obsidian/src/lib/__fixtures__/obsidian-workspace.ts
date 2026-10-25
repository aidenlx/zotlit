// An in-memory workspace for tests. The test drives it; the tag's own layer
// runs over it (`layerWorkspaceFrom`, or `layerHostApp` from
// ./obsidian-host-app). It copies the shape of ./obsidian-metadata-cache.
import type {
  Constructor,
  EventRef,
  OpenViewState,
  PaneType,
  TFile,
  View,
} from "obsidian";

import type { WorkspaceSource } from "@/lib/obsidian-workspace";

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
  /** How many times `updateOptions` reconfigured the editors. */
  reconfigures = 0;
  /** Each `openLinkText` call, in order. */
  readonly opened: {
    linktext: string;
    sourcePath: string;
    newLeaf: PaneType | boolean | undefined;
    openViewState: OpenViewState | undefined;
  }[] = [];
  readonly #listeners = new Map<string, Set<Callback>>();
  readonly #readyCallbacks: (() => void)[] = [];
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

  /** The active file becomes `file`, then `file-open`. */
  open(file: TFile | null): void {
    this.activeFile = file;
    this.trigger("file-open", file);
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
