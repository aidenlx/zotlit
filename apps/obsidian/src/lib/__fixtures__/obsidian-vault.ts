// An in-memory vault for tests. The test drives it; the tag's own layer runs
// over it (`layerVaultFrom`). It copies the shape of MemoryMetadataCache.
import { TFile, TFolder } from "obsidian";
import type { DataWriteOptions, EventRef, TAbstractFile } from "obsidian";

import { Effect } from "effect";
import { makeVault } from "@/lib/obsidian-vault";
import type { Vault, VaultSource } from "@/lib/obsidian-vault";

type Callback = (...args: unknown[]) => unknown;

/** The files of a test vault, by path, with their text, and Obsidian's vault events. */
export class MemoryVault implements VaultSource {
  readonly files = new Map<string, TFile>();
  readonly contents = new Map<string, string>();
  readonly folders = new Map<string, TFolder>();
  /** The files moved to the trash, in order. */
  readonly trashed: TAbstractFile[] = [];
  readonly #listeners = new Map<string, Set<Callback>>();

  /**
   * An in-memory vault whose members `stub` replaces: for a host that stubs a
   * few vault reads, so the tag still has Obsidian's events to listen to.
   */
  static with<Stub extends object>(stub: Stub): MemoryVault & Stub {
    return Object.assign(new MemoryVault(), stub);
  }

  getFileByPath(path: string): TFile | null {
    return this.files.get(path) ?? null;
  }

  getFolderByPath(path: string): TFolder | null {
    return this.folders.get(path) ?? null;
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.files.get(path) ?? this.folders.get(path) ?? null;
  }

  /** As Obsidian: the files whose extension is `md`. */
  getMarkdownFiles(): TFile[] {
    return [...this.files.values()].filter((file) => file.extension === "md");
  }

  async read(file: TFile): Promise<string> {
    const text = this.contents.get(file.path);
    if (text === undefined) throw new Error(`ENOENT: ${file.path}`);
    return text;
  }

  cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  /** As Obsidian's adapter: the text at a path, rejecting with `ENOENT` when none. */
  readonly adapter = {
    read: async (path: string): Promise<string> => {
      const text = this.contents.get(path);
      if (text === undefined)
        throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      return text;
    },
  };

  async process(
    file: TFile,
    fn: (data: string) => string,
    _options?: DataWriteOptions,
  ): Promise<string> {
    const next = fn(await this.read(file));
    this.contents.set(file.path, next);
    this.trigger("modify", file);
    return next;
  }

  async create(
    path: string,
    data: string,
    _options?: DataWriteOptions,
  ): Promise<TFile> {
    if (this.files.has(path)) throw new Error("File already exists.");
    return this.add(path, data);
  }

  async trash(file: TAbstractFile, _system: boolean): Promise<void> {
    this.trashed.push(file);
    this.remove(file.path);
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

  /** Hold a file at `path` with `data`, then `create`. */
  add(path: string, data = ""): TFile {
    const file = new TFile();
    file.path = path;
    this.files.set(path, file);
    this.contents.set(path, data);
    this.trigger("create", file);
    return file;
  }

  /** Hold a folder at `path`, then `create`. */
  addFolder(path: string): TFolder {
    const folder = new TFolder();
    folder.path = path;
    this.folders.set(path, folder);
    this.trigger("create", folder);
    return folder;
  }

  /** Change the file's text, then `modify`. */
  modify(file: TFile, data: string): void {
    this.contents.set(file.path, data);
    this.trigger("modify", file);
  }

  /** Move the file to `path`, then `rename`. */
  rename(file: TFile, path: string): void {
    const oldPath = file.path;
    const data = this.contents.get(oldPath);
    this.files.delete(oldPath);
    this.contents.delete(oldPath);
    file.path = path;
    this.files.set(path, file);
    if (data !== undefined) this.contents.set(path, data);
    this.trigger("rename", file, oldPath);
  }

  /** Drop the file at `path`, then `delete`. */
  remove(path: string): void {
    const file = this.files.get(path);
    if (!file) return;
    this.files.delete(path);
    this.contents.delete(path);
    this.trigger("delete", file);
  }

  /** Call each listener of `name`, in registration order. */
  trigger(name: string, ...args: unknown[]): void {
    for (const callback of this.#listeners.get(name) ?? [])
      callback(...args);
  }
}

/**
 * The tag's service over `source`, for Promise code under test that takes the
 * service as a dep. Its event listeners are already removed: use the layer
 * (`layerVaultFrom`) where the test reads `changes`.
 */
export function vaultOver(source: VaultSource): Vault["Service"] {
  return Effect.runSync(Effect.scoped(makeVault(source)));
}
