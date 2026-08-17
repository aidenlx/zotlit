import { basename } from "node:path/posix";
import { TFile } from "obsidian";
import type {
  App,
  CachedMetadata,
  EventRef,
  FileStats,
  LinkCache,
} from "obsidian";

import type { LibraryCitekey } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { FIELD_CITEKEY, FIELD_ZOTERO_KEY } from "@/lib/constants";
import type { DatabaseEvents } from "@/services/database/service";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { CitationIndex } from "./service";
import type { CitekeyRecord, CitekeyStore } from "./service";
import type { ReadCitekeys } from "./snapshot";

export const KEY_A = "ABCD2345";
export const KEY_B = "ZZZ99999g7";

type Callback = (...args: unknown[]) => void;

export class MockMetadataCache {
  readonly fileCache = new Map<string, CachedMetadata>();
  readonly files = new Map<string, TFile>();
  vault?: MockVault;

  readonly #listeners: Record<string, Set<Callback>> = {
    changed: new Set(),
    deleted: new Set(),
    resolve: new Set(),
    resolved: new Set(),
  };

  getFileCache(file: TFile): CachedMetadata | null {
    return this.fileCache.get(file.path) ?? null;
  }

  getCache(path: string): CachedMetadata | null {
    return this.fileCache.get(path) ?? null;
  }

  getFirstLinkpathDest(linkpath: string, _sourcePath: string): TFile | null {
    return this.files.get(`${linkpath}.md`) ?? null;
  }

  on(name: string, callback: Callback): EventRef {
    this.#listeners[name]!.add(callback);
    return { e: this, name, callback } as unknown as EventRef;
  }

  offref(ref: EventRef): void {
    const { name, callback } = ref as unknown as {
      name: string;
      callback: Callback;
    };
    this.#listeners[name]!.delete(callback);
  }

  change(file: TFile, body: string, links: LinkCache[] = []): void {
    this.vault?.write(file, body);
    this.files.set(file.path, file);
    const cache = { links } as CachedMetadata;
    this.fileCache.set(file.path, cache);
    this.#emit("changed", file, body, cache);
  }

  /** Rewrite one note's properties, leaving the body and its links as they are. */
  setFrontmatter(
    file: TFile,
    frontmatter: Record<string, unknown> | undefined,
  ): void {
    const cache = {
      ...this.fileCache.get(file.path),
      frontmatter,
    } as CachedMetadata;
    this.fileCache.set(file.path, cache);
    this.#emit("changed", file, this.vault?.bodies.get(file.path) ?? "", cache);
  }

  delete(file: TFile): void {
    this.fileCache.delete(file.path);
    this.files.delete(file.path);
    this.#emit("deleted", file, null);
  }

  resolve(file: TFile): void {
    this.#emit("resolve", file);
  }

  resolved(): void {
    this.#emit("resolved");
  }

  #emit(name: string, ...args: unknown[]): void {
    for (const callback of this.#listeners[name]!) callback(...args);
  }
}

export class MockVault {
  readonly bodies = new Map<string, string>();
  readonly reads: string[] = [];
  readonly #listeners = new Set<Callback>();
  readonly #held = new Map<string, PromiseWithResolvers<void>>();
  readonly #failures = new Map<string, unknown>();

  constructor(readonly metadataCache: MockMetadataCache) {
    metadataCache.vault = this;
  }

  getMarkdownFiles(): TFile[] {
    return [...this.metadataCache.files.values()].filter(
      (file) => file.extension === "md",
    );
  }

  cachedRead(file: TFile): Promise<string> {
    this.reads.push(file.path);
    const failure = this.#failures.get(file.path);
    if (failure) return Promise.reject(failure);
    const body = this.bodies.get(file.path) ?? "";
    const gate = this.#held.get(file.path);
    if (!gate) return Promise.resolve(body);
    this.#held.delete(file.path);
    // Capture the body before the gate settles, so a later write makes this
    // held read stale and exercises superseded-backfill handling.
    return gate.promise.then(() => body);
  }

  hold(path: string): () => void {
    const gate = Promise.withResolvers<void>();
    this.#held.set(path, gate);
    return () => gate.resolve();
  }

  fail(path: string, error: unknown = new Error("read failed")): void {
    this.#failures.set(path, error);
  }

  write(file: TFile, body: string): void {
    this.bodies.set(file.path, body);
    file.stat = statOf(body);
  }

  on(_name: "rename", callback: Callback): EventRef {
    this.#listeners.add(callback);
    return { e: this, callback } as unknown as EventRef;
  }

  offref(ref: EventRef): void {
    const { callback } = ref as unknown as { callback: Callback };
    this.#listeners.delete(callback);
  }

  deleteFile(file: TFile): void {
    this.bodies.delete(file.path);
    this.metadataCache.delete(file);
  }

  rename(file: TFile, path: string): void {
    const oldPath = file.path;
    const cache = this.metadataCache.fileCache.get(oldPath);
    this.metadataCache.files.delete(oldPath);
    this.metadataCache.fileCache.delete(oldPath);
    this.bodies.set(path, this.bodies.get(oldPath) ?? "");
    this.bodies.delete(oldPath);
    updateFilePath(file, path);
    this.metadataCache.files.set(path, file);
    if (cache) this.metadataCache.fileCache.set(path, cache);
    for (const callback of this.#listeners) callback(file, oldPath);
  }
}

export class MockWorkspace {
  readonly #pending: (() => void)[] = [];

  onLayoutReady(callback: () => void): void {
    this.#pending.push(callback);
  }

  layoutReady(): void {
    for (const callback of this.#pending.splice(0)) callback();
  }
}

export class NoteIndexStub {
  readonly notes = new Map<string, TFile>();

  getNotesByItemKey(indexedKey: string): TFile[] {
    const note = this.notes.get(indexedKey);
    return note ? [note] : [];
  }

  whenIndexed(): Promise<void> {
    return Promise.resolve();
  }

  on(): () => void {
    return () => undefined;
  }
}

export class DatabaseStub {
  state: "loading" | "ready" | "degraded" = "ready";
  readonly client = {} as NodeDatabaseClient;
  readonly #listeners = new Set<() => void>();
  readonly #ready = Promise.withResolvers<void>();

  constructor({ readyImmediately = true } = {}) {
    if (readyImmediately) this.#ready.resolve();
  }

  get ready(): Promise<void> {
    return this.#ready.promise;
  }

  settle(): void {
    this.#ready.resolve();
  }

  on<K extends keyof DatabaseEvents>(
    event: K,
    cb: DatabaseEvents[K],
  ): () => void {
    const listener = cb as () => void;
    if (event === "changed") this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  changed(): void {
    for (const listener of this.#listeners) listener();
  }
}

export class CitekeysStub {
  rows: LibraryCitekey[];
  error: unknown = null;
  readonly calls: number[] = [];

  constructor(rows: LibraryCitekey[]) {
    this.rows = rows;
  }

  read: ReadCitekeys = (_db, libraryID) => {
    this.calls.push(libraryID);
    if (this.error) throw this.error;
    return this.rows;
  };
}

function defaultCitekeys(): LibraryCitekey[] {
  return [
    { itemID: 1, key: "DOE2024", indexedKey: KEY_A, citekey: "doe2024" },
    { itemID: 2, key: "ROE2025", indexedKey: KEY_B, citekey: "roe2025" },
  ];
}

export class MemoryStore implements CitekeyStore {
  readonly records = new Map<string, CitekeyRecord>();
  readonly writes: string[] = [];

  load(): Promise<CitekeyRecord[]> {
    return Promise.resolve([...this.records.values()]);
  }

  put(record: CitekeyRecord): Promise<void> {
    this.writes.push(record.path);
    this.records.set(record.path, structuredClone(record));
    return Promise.resolve();
  }

  drop(path: string): Promise<void> {
    this.records.delete(path);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.records.clear();
    return Promise.resolve();
  }

  [Symbol.dispose](): void {}
}

export class SettingsStub {
  current: Readonly<Settings>;
  readonly #ready = Promise.withResolvers<void>();
  readonly #listeners = new Set<
    (settings: Readonly<Settings> | null) => void
  >();

  constructor(
    overrides: Partial<Settings> = {},
    options: { readyImmediately?: boolean } = {},
  ) {
    this.current = { ...defaults, ...overrides };
    if (options.readyImmediately ?? true) this.#ready.resolve();
  }

  get ready(): Promise<void> {
    return this.#ready.promise;
  }

  settle(): void {
    this.#ready.resolve();
  }

  subscribe(
    listener: (settings: Readonly<Settings> | null) => void,
  ): () => void {
    this.#listeners.add(listener);
    listener(this.current);
    return () => this.#listeners.delete(listener);
  }

  update(overrides: Partial<Settings>): void {
    this.current = { ...this.current, ...overrides };
    for (const listener of this.#listeners) listener(this.current);
  }
}

export interface CitationIndexHarness extends AsyncDisposable {
  app: App;
  draft: TFile;
  index: CitationIndex;
  metadataCache: MockMetadataCache;
  noteIndex: NoteIndexStub;
  settings: SettingsStub;
  store: MemoryStore;
  vault: MockVault;
  workspace: MockWorkspace;
  db: DatabaseStub;
  citekeys: CitekeysStub;
}

export interface CitationIndexHarnessOptions {
  settings?: Partial<Settings>;
  store?: MemoryStore;
  citekeys?: LibraryCitekey[];
  db?: DatabaseStub;
  notes?: boolean;
  settingsService?: SettingsStub;
  awaitReady?: boolean;
}

export async function createCitationIndexHarness(
  documents: Record<string, string>,
  options: CitationIndexHarnessOptions = {},
): Promise<CitationIndexHarness> {
  await using stack = new AsyncDisposableStack();
  const metadataCache = new MockMetadataCache();
  const vault = new MockVault(metadataCache);
  const workspace = new MockWorkspace();
  const noteIndex = new NoteIndexStub();
  const store = options.store ?? new MemoryStore();
  const db = options.db ?? new DatabaseStub();
  const citekeys = new CitekeysStub(options.citekeys ?? defaultCitekeys());

  const addFile = (path: string, body: string): TFile => {
    const added = makeFile(path, body);
    metadataCache.files.set(path, added);
    vault.bodies.set(path, body);
    return added;
  };
  if (options.notes ?? true) {
    for (const [citekey, indexedKey] of [
      ["doe2024", KEY_A],
      ["roe2025", KEY_B],
    ] as const) {
      const path = citekey === "doe2024" ? "Doe 2024.md" : "Roe 2025.md";
      const note = addFile(path, "");
      metadataCache.fileCache.set(path, {
        frontmatter: {
          [FIELD_ZOTERO_KEY]: indexedKey,
          [FIELD_CITEKEY]: citekey,
        },
      } as CachedMetadata);
      noteIndex.notes.set(indexedKey, note);
    }
  }
  for (const [path, body] of Object.entries(documents)) {
    addFile(path, body);
    metadataCache.fileCache.set(path, { links: [] } as CachedMetadata);
  }

  const app = { metadataCache, vault, workspace } as unknown as App;
  const settings =
    options.settingsService ?? new SettingsStub(options.settings);
  const index = stack.use(
    new CitationIndex({
      app,
      noteIndex,
      settings,
      db,
      readCitekeys: citekeys.read,
      openStore: () => Promise.resolve(store),
    }),
  );
  const awaitReady = options.awaitReady ?? true;
  if (awaitReady) await index.ready;
  if (awaitReady && !options.db) await index.whenResolved();
  vault.reads.length = 0;
  store.writes.length = 0;
  const resources = stack.move();

  return {
    app,
    draft: metadataCache.files.get("draft.md")!,
    index,
    metadataCache,
    noteIndex,
    settings,
    store,
    vault,
    workspace,
    db,
    citekeys,
    [Symbol.asyncDispose]: () => resources.disposeAsync(),
  };
}

export function link(
  target: string,
  offset: number,
  original?: string,
): LinkCache {
  const raw = original ?? `[[${target}]]`;
  return {
    link: target,
    original: raw,
    position: {
      start: { line: 0, col: offset, offset },
      end: {
        line: 0,
        col: offset + raw.length,
        offset: offset + raw.length,
      },
    },
  };
}

export function makeFile(path: string, body: string): TFile {
  const added = new TFile();
  added.stat = statOf(body);
  updateFilePath(added, path);
  return added;
}

function statOf(body: string): FileStats {
  let mtime = 0;
  for (let at = 0; at < body.length; at += 1) {
    mtime = (mtime * 31 + body.charCodeAt(at)) | 0;
  }
  return { ctime: 0, mtime: mtime >>> 0, size: body.length };
}

function updateFilePath(file: TFile, path: string): void {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  file.path = path;
  file.name = name;
  file.basename = dot === -1 ? name : name.slice(0, dot);
  file.extension = dot === -1 ? "" : name.slice(dot + 1);
}
