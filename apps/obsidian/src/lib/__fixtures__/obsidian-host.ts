// An in-memory Obsidian host for tests of note and document reads and writes:
// the vault's files, the text views that have them open, and a metadata cache
// that follows the disk text — or lags it, where a test holds it.
import { dirname } from "node:path/posix";
import { getFrontMatterInfo, TextFileView, TFile, TFolder } from "obsidian";
import type {
  App,
  CachedMetadata,
  EventRef,
  TAbstractFile,
  WorkspaceLeaf,
} from "obsidian";
import { vi } from "vitest";

import { parseFrontMatter } from "@/lib/live-text";

type VaultEvent = "create" | "modify" | "rename" | "delete";
type VaultCallback = (...args: unknown[]) => void;

export class MockVault {
  /** App settings the rendered surfaces read; tests run with Obsidian's defaults. */
  getConfig(_key: string): boolean {
    return false;
  }
  readonly root = makeFolder("", null, this);
  readonly files = new Map<string, TFile>();
  readonly folders = new Map<string, TFolder>([["", this.root]]);
  readonly contents = new Map<string, string>();
  readonly cachedRead = vi.fn(async (file: TFile) => {
    return this.contents.get(file.path) ?? "";
  });

  #mtime = 1;
  readonly #listeners: Record<VaultEvent, Set<VaultCallback>> = {
    create: new Set(),
    modify: new Set(),
    rename: new Set(),
    delete: new Set(),
  };

  getRoot(): TFolder {
    return this.root;
  }

  getFolderByPath(path: string): TFolder | null {
    return this.folders.get(path) ?? null;
  }

  getFileByPath(path: string): TFile | null {
    return this.files.get(path) ?? null;
  }

  on(name: VaultEvent, callback: VaultCallback): EventRef {
    this.#listeners[name].add(callback);
    return { e: this, name, callback } as unknown as EventRef;
  }

  offref(ref: EventRef): void {
    const eventRef = ref as unknown as {
      name: VaultEvent;
      callback: VaultCallback;
    };
    this.#listeners[eventRef.name].delete(eventRef.callback);
  }

  addFile(path: string, content: string): TFile {
    const file = makeFile(path, this.#nextStat(content), this);
    this.files.set(path, file);
    this.contents.set(path, content);
    this.#ensureFolder(dirname(path)).children.push(file);
    return file;
  }

  async create(path: string, content: string): Promise<TFile> {
    if (this.files.has(path)) throw new Error("File already exists.");
    return this.createFile(path, content);
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.files.get(path) ?? this.folders.get(path) ?? null;
  }

  async createFolder(path: string): Promise<TFolder> {
    return this.#ensureFolder(path);
  }

  getMarkdownFiles(): TFile[] {
    return [...this.files.values()].filter((file) => file.extension === "md");
  }

  createFile(path: string, content: string): TFile {
    const file = this.addFile(path, content);
    this.#emit("create", file);
    return file;
  }

  async read(file: TFile): Promise<string> {
    const source = this.contents.get(file.path);
    if (source === undefined) throw new Error(`Missing file: ${file.path}`);
    return source;
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.modifyFile(file.path, content);
  }

  async process(
    file: TFile,
    transform: (source: string) => string,
  ): Promise<string> {
    const source = this.contents.get(file.path);
    if (source === undefined) throw new Error(`Missing file: ${file.path}`);
    const result = transform(source);
    this.modifyFile(file.path, result);
    return result;
  }

  modifyFile(path: string, content: string): void {
    const file = this.files.get(path);
    if (!file) throw new Error(`Missing file: ${path}`);
    file.stat = this.#nextStat(content);
    this.contents.set(path, content);
    this.#emit("modify", file);
  }

  renameFile(oldPath: string, newPath: string): void {
    const file = this.files.get(oldPath);
    const content = this.contents.get(oldPath);
    if (!file || content === undefined)
      throw new Error(`Missing file: ${oldPath}`);

    this.#detach(file);
    this.files.delete(oldPath);
    this.contents.delete(oldPath);

    file.path = newPath;
    file.name = basename(newPath);
    file.basename = file.name.replace(/\.[^.]+$/, "");
    file.extension = file.name.split(".").at(-1) ?? "";
    file.parent = this.#ensureFolder(dirname(newPath));
    file.parent.children.push(file);
    this.files.set(newPath, file);
    this.contents.set(newPath, content);
    this.#emit("rename", file, oldPath);
  }

  deleteFile(path: string): void {
    const file = this.files.get(path);
    if (!file) throw new Error(`Missing file: ${path}`);
    this.#detach(file);
    this.files.delete(path);
    this.contents.delete(path);
    this.#emit("delete", file);
  }

  #ensureFolder(path: string): TFolder {
    const normalized = path === "." ? "" : path;
    const existing = this.folders.get(normalized);
    if (existing) return existing;

    const parent = this.#ensureFolder(dirname(normalized));
    const folder = makeFolder(normalized, parent, this);
    parent.children.push(folder);
    this.folders.set(normalized, folder);
    return folder;
  }

  #detach(file: TAbstractFile): void {
    const siblings = file.parent?.children;
    if (!siblings) return;
    const index = siblings.indexOf(file);
    if (index >= 0) siblings.splice(index, 1);
  }

  #nextStat(content: string) {
    const now = this.#mtime++;
    return {
      type: "file" as const,
      ctime: now,
      mtime: now,
      size: content.length,
    };
  }

  #emit(name: VaultEvent, ...args: unknown[]): void {
    for (const callback of this.#listeners[name]) {
      callback(...args);
    }
  }
}

export class PluginStub {
  constructor(
    readonly app: App,
    public data: unknown,
  ) {}

  loadData(): Promise<unknown> {
    return Promise.resolve(this.data);
  }

  async saveData(data: unknown): Promise<void> {
    this.data = data;
  }
}

/**
 * A text view with a file open, saving as Obsidian 1.14.2's `TextFileView`
 * does: a save writes the text it took when it started, a save asked for
 * during another one runs after it, and a disk change that lands during a save
 * is ignored. A disk change at any other time reloads a view without unsaved
 * edits; a view with unsaved edits keeps them (Obsidian merges the two).
 */
export class HostTextView extends TextFileView {
  saving = false;
  #saveAgain = false;

  constructor(
    readonly host: ObsidianHost,
    readonly lineEndings: "keep" | "lf",
  ) {
    super({ app: host.app } as unknown as WorkspaceLeaf);
  }

  /** Type into the editor: the view holds `text` as an unsaved edit. */
  edit(text: string): void {
    this.setViewData(text, false);
  }

  override getViewData(): string {
    return this.data;
  }

  override clear(): void {
    this.data = "";
  }

  override setViewData(data: string, _clear: boolean): void {
    this.data = this.lineEndings === "lf" ? data.replaceAll("\r\n", "\n") : data;
  }

  override getViewType(): string {
    return "markdown";
  }

  override save(): Promise<void> {
    return this.host.saves.track(this.#save());
  }

  async #save(): Promise<void> {
    const file = this.file;
    if (file === null) return;
    if (this.saving) {
      this.#saveAgain = true;
      return;
    }
    const data = this.getViewData();
    this.lastSavedData = data;
    this.saving = true;
    try {
      await this.host.saves.gate();
      await this.host.vault.modify(file, data);
    } finally {
      this.saving = false;
    }
    if (this.#saveAgain) {
      this.#saveAgain = false;
      await this.#save();
    }
  }

  /** The host's `modify` event for this view's file. */
  onDiskChange(text: string): void {
    if (this.saving || text === this.lastSavedData) return;
    if (this.getViewData() !== this.lastSavedData) return;
    this.lastSavedData = text;
    this.setViewData(text, false);
  }
}

/** The editor saves in flight; a held gate keeps each save from writing. */
class SaveGate {
  #held: PromiseWithResolvers<void> | null = null;
  readonly #inFlight = new Set<Promise<void>>();

  /** Keep every save that starts from now on from writing until `release`. */
  hold(): void {
    this.#held ??= Promise.withResolvers<void>();
  }

  /** Let the held saves write; settles when every save has written. */
  async release(): Promise<void> {
    this.#held?.resolve();
    this.#held = null;
    await this.idle();
  }

  /** Settles when no save is writing. */
  async idle(): Promise<void> {
    while (this.#inFlight.size > 0)
      await Promise.allSettled(this.#inFlight);
  }

  /** Where a save waits before it writes. */
  gate(): Promise<void> {
    return this.#held?.promise ?? Promise.resolve();
  }

  track(save: Promise<void>): Promise<void> {
    this.#inFlight.add(save);
    // The caller sees a failed save; the gate only stops waiting for it.
    save.finally(() => this.#inFlight.delete(save)).catch(() => {});
    return save;
  }
}

type MetadataEvent = "changed";
type MetadataCallback = (
  file: TFile,
  data: string,
  cache: CachedMetadata,
) => void;

/**
 * The metadata cache over the disk text. It follows every disk change at once,
 * until a test holds it; a held cache answers from the text it last parsed,
 * and `null` for a file it never parsed, until `settle`.
 */
class HostMetadataCache {
  readonly #parsed = new Map<string, string>();
  readonly #listeners = new Set<MetadataCallback>();
  #held = false;

  constructor(readonly vault: MockVault) {}

  getFileCache(file: TFile): CachedMetadata | null {
    const text = this.#held
      ? this.#parsed.get(file.path)
      : this.vault.contents.get(file.path);
    if (text === undefined) return null;
    if (!getFrontMatterInfo(text).exists) return {};
    try {
      return { frontmatter: parseFrontMatter(text) };
    } catch {
      // Obsidian's cache holds no Properties for a block that does not parse.
      return {};
    }
  }

  on(_name: MetadataEvent, callback: MetadataCallback): EventRef {
    this.#listeners.add(callback);
    return { e: this, callback } as unknown as EventRef;
  }

  offref(ref: EventRef): void {
    this.#listeners.delete(
      (ref as unknown as { callback: MetadataCallback }).callback,
    );
  }

  onCleanCache(callback: () => void): void {
    callback();
  }

  /** Answer from the text parsed so far, until `settle`. */
  hold(): void {
    this.#held = true;
  }

  /** Parse every changed file, announce it as `changed`, and follow the disk again. */
  settle(): void {
    this.#held = false;
    for (const file of this.vault.files.values()) this.follow(file);
  }

  /** Announce every file as `changed`, with the answer `getFileCache` gives now. */
  announceAll(): void {
    for (const file of this.vault.getMarkdownFiles()) {
      const cache = this.getFileCache(file);
      if (cache === null) continue;
      const text = this.vault.contents.get(file.path) ?? "";
      for (const callback of this.#listeners) callback(file, text, cache);
    }
  }

  follow(file: TFile): void {
    if (this.#held) return;
    const text = this.vault.contents.get(file.path);
    if (text === undefined || this.#parsed.get(file.path) === text) return;
    this.#parsed.set(file.path, text);
    const cache = this.getFileCache(file)!;
    for (const callback of this.#listeners) callback(file, text, cache);
  }
}

export type ObsidianHost = ReturnType<typeof createObsidianHost>;

/**
 * An in-memory host holding `files` (path to text). `host.app` carries the
 * vault, the workspace and the metadata cache; a test adds any other member
 * its module reads.
 */
export function createObsidianHost(files: Record<string, string> = {}) {
  const vault = new MockVault();
  for (const [path, text] of Object.entries(files)) vault.addFile(path, text);
  const metadataCache = new HostMetadataCache(vault);
  for (const file of vault.files.values()) metadataCache.follow(file);
  const views: HostTextView[] = [];
  const workspace = {
    updateOptions: vi.fn(),
    onLayoutReady: (callback: () => void) => callback(),
    iterateAllLeaves: (callback: (leaf: WorkspaceLeaf) => void) => {
      for (const view of views) callback({ view } as unknown as WorkspaceLeaf);
    },
  };
  const app = { vault, metadataCache, workspace };

  const onChange = (file: unknown) => {
    if (!(file instanceof TFile)) return;
    metadataCache.follow(file);
    const text = vault.contents.get(file.path);
    if (text === undefined) return;
    for (const view of views) if (view.file === file) view.onDiskChange(text);
  };
  vault.on("create", onChange);
  vault.on("modify", onChange);

  const host = {
    app,
    vault,
    metadataCache,
    workspace,
    saves: new SaveGate(),
    /** The file at `path`; throws when the vault has none. */
    file(path: string): TFile {
      const file = vault.getFileByPath(path);
      if (!file) throw new Error(`Missing file: ${path}`);
      return file;
    },
    /** The disk text at `path`. */
    text(path: string): string | undefined {
      return vault.contents.get(path);
    },
    /**
     * Open `file` in a loaded text view. `lineEndings: "lf"` gives a view that
     * turns CRLF into LF, as CodeMirror does.
     */
    openInEditor(
      file: TFile,
      options: { lineEndings?: "keep" | "lf" } = {},
    ): HostTextView {
      const view = new HostTextView(host, options.lineEndings ?? "keep");
      const text = vault.contents.get(file.path) ?? "";
      view.file = file;
      view.lastSavedData = text;
      view.setViewData(text, true);
      views.push(view);
      return view;
    },
  };
  return host;
}

function makeFolder(
  path: string,
  parent: TFolder | null,
  vault: unknown,
): TFolder {
  const folder = new TFolder();
  folder.vault = vault as never;
  folder.path = path;
  folder.name = basename(path);
  folder.parent = parent;
  folder.children = [];
  return folder;
}

function makeFile(path: string, stat: TFile["stat"], vault: MockVault): TFile {
  const file = new TFile();
  file.vault = vault as never;
  file.path = path;
  file.name = basename(path);
  file.basename = file.name.replace(/\.[^.]+$/, "");
  file.extension = file.name.split(".").at(-1) ?? "";
  file.parent = vault.getFolderByPath(dirname(path)) ?? vault.getRoot();
  file.stat = stat;
  return file;
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? "";
}
