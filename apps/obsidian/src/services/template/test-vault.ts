// Shared fake vault for TemplateService and ProfileService boundary tests.
import { dirname } from "node:path/posix";
import { TFile, TFolder } from "obsidian";
import type { App, EventRef, TAbstractFile } from "obsidian";
import { vi } from "vitest";

type VaultEvent = "create" | "modify" | "rename" | "delete";
type VaultCallback = (...args: unknown[]) => void;

export class MockVault {
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

  getConfig(name: "autoPairBrackets" | "autoPairMarkdown"): boolean {
    return name === "autoPairBrackets" || name === "autoPairMarkdown";
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
  readonly editorExtensions: unknown[] = [];
  readonly editorSuggests: unknown[] = [];

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

  registerEditorExtension(extension: unknown): void {
    this.editorExtensions.push(extension);
  }

  registerEditorSuggest(suggest: unknown): void {
    this.editorSuggests.push(suggest);
  }
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
