import { basename } from "node:path/posix";
import { TFile } from "obsidian";
import type {
  App,
  CachedMetadata,
  EventRef,
  FileStats,
  LinkCache,
} from "obsidian";

import type { Library, LibraryCitekey } from "@zotlit/db";

import { testEvent } from "@/lib/__fixtures__/event-stream";
import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { FIELD_CITEKEY, FIELD_ZOTERO_KEY } from "@/lib/constants";
import type { Context } from "@/lib/effect";
import { Effect, Stream } from "@/lib/effect";
import type { ParseClient } from "@/services/citation-parse/client";
import { inProcessParseClient } from "@/services/citation-parse/in-process";
import { resolveLibraryScope } from "@/services/library-scope/scope";
import type {
  LibraryScope,
  AvailableLibrary,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";
import type { LibraryScopeEvents } from "@/services/library-scope/service";
import { buildNoteIndex } from "@/services/note-index/__fixtures__";
import type { PlainNoteIndex } from "@/services/note-index/plain";
import { queryClientsFixture } from "@/services/query-client/__fixtures__";
import type { PlainQueryClients } from "@/services/query-client/plain";
import { testClock } from "@/services/query-client/test-clock";
import { buildSeededSettings } from "@/services/settings/__fixtures__";
import type { SettingsFixture } from "@/services/settings/__fixtures__";
import type { Settings } from "@/services/settings/schema";
import type { TestReads } from "@/services/zotero-reads/__fixtures__";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import type { ZoteroReadLease } from "@/services/zotero-reads/service";
import {
  inProcessReadsService,
  memoryOpener,
} from "@/services/zotero-reads/test-utils";

import { citationIndexFixture, citationLookupFixture } from "./__fixtures__";
import { CitationLookup } from "./lookup-service";
import type { PlainCitationIndex } from "./plain";
import type { CitekeyRecord, CitekeyStore } from "./service";

export const KEY_A = "ABCD2345";
export const KEY_B = "ZZZ99999g7";

/** Local ids of the two Libraries the multi-Library fixtures use. */
export const MY_LIBRARY_ID = 1;
export const GROUP_LIBRARY_ID = 4;

export function personalLibrary(
  libraryID: number = MY_LIBRARY_ID,
): AvailableLibrary {
  return { selector: { type: "personal" }, libraryID, name: null };
}

/** @param overrides the facts one fixture varies; the rest keep the defaults
 *   the multi-Library fixtures share. */
export function groupLibrary({
  groupID = 7,
  libraryID = GROUP_LIBRARY_ID,
  name = "Shared group",
}: {
  groupID?: number;
  libraryID?: number;
  name?: string;
} = {}): AvailableLibrary {
  return { selector: { type: "group", groupID }, libraryID, name };
}

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

  /** The cache holds every file the harness added, so it is already clean. */
  onCleanCache(callback: () => void): void {
    callback();
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
  readonly #listeners: Record<"rename" | "delete", Set<Callback>> = {
    rename: new Set(),
    delete: new Set(),
  };
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

  getFileByPath(path: string): TFile | null {
    return this.metadataCache.files.get(path) ?? null;
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

  on(name: "rename" | "delete", callback: Callback): EventRef {
    this.#listeners[name].add(callback);
    return { e: this, name, callback } as unknown as EventRef;
  }

  offref(ref: EventRef): void {
    const { name, callback } = ref as unknown as {
      name: "rename" | "delete";
      callback: Callback;
    };
    this.#listeners[name].delete(callback);
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
    for (const callback of this.#listeners.rename) callback(file, oldPath);
  }
}

/**
 * The ZoteroReads stand-in. The test drives its lifecycle (`state`, `ready`,
 * the `changed` event); its reads run through the in-process adapter over a
 * `:memory:` fixture database. With no `seed`, that database is empty and the
 * citation-key read answers from {@link citekeys}; with `seed`, it holds the
 * seeded rows and every read, the citation-key read included, answers from
 * them.
 */
export class DatabaseStub implements AsyncDisposable {
  state: "loading" | "ready" | "degraded" = "ready";
  readonly citekeys = new CitekeysStub(defaultCitekeys());
  itemReads = 0;
  libraries = () => [personalLibrary(), groupLibrary()];
  readonly #service: TestReads;
  readonly #changed = testEvent<void>();
  readonly #degraded = testEvent<DbUnavailable>();
  readonly changed = this.#changed.stream;
  readonly degraded = this.#degraded.stream;
  readonly "refresh-failed" = Stream.empty;
  readonly refreshing = Stream.empty;
  readonly "db-file-missing" = Stream.empty;
  readonly "refresh-requested" = Stream.empty;
  readonly #ready = Promise.withResolvers<void>();

  constructor({
    readyImmediately = true,
    seed,
  }: { readyImmediately?: boolean; seed?: string } = {}) {
    if (readyImmediately) this.#ready.resolve();
    this.#seed = seed;
    this.#service = inProcessReadsService(
      memoryOpener(() => this.#sql()).open,
      {
        wrap: (client) => ({
          ...client,
          ItemsByIndexedKeys: (...args) => {
            this.itemReads += 1;
            return client.ItemsByIndexedKeys(...args);
          },
        }),
      },
    );
  }

  #seed?: string;
  #lastSql: string | null = null;
  #refresh: Promise<void> | null = null;

  #sql(): string {
    if (this.#seed !== undefined) return this.#seed;
    const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
    const statements = [
      "insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle');",
      "insert into fieldsCombined (fieldID, fieldName, custom) values (11, 'citationKey', 0);",
    ];
    const libraries = this.libraries();
    for (const library of libraries) {
      statements.push(
        `insert into libraries (libraryID, type) values (${library.libraryID}, '${library.selector.type === "personal" ? "user" : "group"}');`,
      );
      if (library.selector.type === "group")
        statements.push(
          `insert into groups (groupID, libraryID, name) values (${library.selector.groupID}, ${library.libraryID}, ${quote(library.name ?? "")});`,
        );
    }
    const used = new Set<number>();
    let next = Math.max(0, ...this.citekeys.rows.map((row) => row.itemID));
    for (const row of this.citekeys.rows) {
      const library = libraries.find(
        (entry) => entry.libraryID === row.libraryID,
      );
      if (!library) continue;
      const itemID = used.has(row.itemID) ? ++next : row.itemID;
      used.add(itemID);
      const suffix =
        library.selector.type === "group" ? `g${library.selector.groupID}` : "";
      const key =
        suffix && row.indexedKey.endsWith(suffix)
          ? row.indexedKey.slice(0, -suffix.length)
          : row.indexedKey;
      statements.push(
        `insert into items (itemID, itemTypeID, libraryID, key, dateAdded, dateModified) values (${itemID}, 1, ${row.libraryID}, ${quote(key)}, '2024-01-01 00:00:00', '2024-01-01 00:00:00');`,
      );
      statements.push(
        `insert into itemDataValues (valueID, value) values (${itemID}, ${quote(row.citekey)});`,
      );
      statements.push(
        `insert into itemData (itemID, fieldID, valueID) values (${itemID}, 11, ${itemID});`,
      );
    }
    return statements.join("\n");
  }

  #lookupBarrier: {
    entered: PromiseWithResolvers<void>;
    release: PromiseWithResolvers<void>;
  } | null = null;

  holdLookup() {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    this.#lookupBarrier = { entered, release };
    return { entered: entered.promise, release: () => release.resolve() };
  }

  readonly #client = () =>
    Effect.map(
      Effect.promise(() => this.#service.ready),
      ({ client }) =>
        ({
          ...client,
          CitationLookup: (payload, options) =>
            Effect.gen({ self: this }, function* () {
              yield* Effect.promise(() => this.#ready.promise);
              const barrier = this.#lookupBarrier;
              this.#lookupBarrier = null;
              if (barrier) {
                barrier.entered.resolve();
                yield* Effect.promise(() => barrier.release.promise);
              }
              if (this.state === "degraded" || this.citekeys.error)
                return yield* new DbUnavailable({
                  message:
                    this.citekeys.error instanceof Error
                      ? this.citekeys.error.message
                      : "Database unavailable",
                });
              const sql = this.#sql();
              if (sql !== this.#lastSql) {
                this.#lastSql = sql;
                this.citekeys.calls.push(
                  ...this.libraries().map((library) => library.libraryID),
                );
                this.#refresh = this.#service.refresh();
              }
              yield* Effect.promise(() => this.#refresh ?? Promise.resolve());
              return yield* client.CitationLookup(payload, options);
            }),
        }) as ZoteroReadsClient,
    );

  get ready(): TestReads["ready"] {
    return this.#ready.promise.then(async () => ({
      ...(await this.#service.ready),
      client: await Effect.runPromise(this.#client()),
    }));
  }

  get reads() {
    return {
      ...this.#service.reads,
      CitationLookup: (
        ...args: Parameters<ZoteroReadsClient["CitationLookup"]>
      ) =>
        Effect.flatMap(this.#client(), (client) =>
          client.CitationLookup(...args),
        ),
    } as PlainZoteroReads["reads"];
  }

  async acquireRead(): Promise<ZoteroReadLease> {
    await this.#ready.promise;
    return this.#service.acquireRead();
  }

  get snapshot(): PlainZoteroReads["snapshot"] {
    return Effect.andThen(
      Effect.promise(() => this.#ready.promise),
      this.#service.snapshot,
    );
  }

  settle(): void {
    this.#ready.resolve();
  }

  notifyChanged(): void {
    this.#changed.emit();
  }

  async replaceRows(seed: string): Promise<void> {
    this.#seed = seed;
    this.#lastSql = seed;
    await this.#service.refresh();
    this.notifyChanged();
  }

  degrade(): void {
    this.state = "degraded";
    const error = new DbUnavailable({ message: "Database unavailable" });
    this.#degraded.emit(error);
  }

  [Symbol.asyncDispose](): Promise<void> {
    return Promise.resolve(this.#service[Symbol.asyncDispose]());
  }
}

/** The citation-key rows the {@link DatabaseStub} answers, with each read it served. */
export class CitekeysStub {
  rows: LibraryCitekey[];
  error: unknown = null;
  readonly calls: number[] = [];

  constructor(rows: LibraryCitekey[]) {
    this.rows = rows;
  }
}

/**
 * The Libraries the active database holds and the scope resolved over them —
 * the stand-in for `PlainLibraryScope` the Citation Index resolves against.
 */
export class LibraryScopeStub {
  libraries: AvailableLibrary[];
  ready = Promise.resolve();
  readonly #changed = testEvent<ResolvedLibraryScope | null>();
  readonly #libraries = testEvent<void>();
  readonly changed = this.#changed.stream;
  readonly "libraries-changed" = this.#libraries.stream;
  #current: ResolvedLibraryScope | null;

  constructor(libraries: AvailableLibrary[] = [personalLibrary()]) {
    this.libraries = libraries;
    this.#current = allOf(libraries);
  }

  resolveLibraries(libraries: readonly Library[]): ResolvedLibraryScope {
    const scope = this.#current;
    return resolveLibraryScope(
      libraries,
      scope?.mode === "selected"
        ? {
            mode: "selected",
            libraries: [
              ...scope.available.map((library) => library.selector),
              ...scope.unavailable,
            ],
          }
        : { mode: "all" },
    );
  }

  get effective(): LibraryScope {
    const scope = this.#current;
    return scope?.mode === "selected"
      ? {
          mode: "selected",
          libraries: [
            ...scope.available.map((library) => library.selector),
            ...scope.unavailable,
          ],
        }
      : { mode: "all" };
  }

  get current(): ResolvedLibraryScope | null {
    return this.#current;
  }

  /**
   * The database now holds `libraries`, and the saved scope resolves as it
   * did: only `libraries-changed` reports it.
   */
  holdLibraries(libraries: AvailableLibrary[]): void {
    this.libraries = libraries;
    this.#emit("libraries-changed");
  }

  /** Narrow or widen the scope over the Libraries the database already holds. */
  select(available: AvailableLibrary[]): void {
    this.#current = {
      mode: "selected",
      invalid: false,
      available,
      unavailable: [],
    };
    this.#emit();
  }

  /** Every local Library joins the scope, as All Libraries does. */
  selectAll(libraries: AvailableLibrary[] = this.libraries): void {
    this.libraries = libraries;
    this.#current = allOf(libraries);
    this.#emit();
  }

  #emit(event: keyof LibraryScopeEvents = "changed"): void {
    if (event === "changed") this.#changed.emit(this.#current);
    else this.#libraries.emit();
  }
}

function allOf(libraries: AvailableLibrary[]): ResolvedLibraryScope {
  return { mode: "all", invalid: false, available: libraries, unavailable: [] };
}

function defaultCitekeys(): LibraryCitekey[] {
  return [
    {
      itemID: 1,
      libraryID: MY_LIBRARY_ID,
      key: "DOE2024",
      indexedKey: KEY_A,
      citekey: "doe2024",
    },
    {
      itemID: 2,
      libraryID: GROUP_LIBRARY_ID,
      key: "ZZZ99999",
      indexedKey: KEY_B,
      citekey: "roe2025",
    },
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

export interface CitationIndexHarness extends AsyncDisposable {
  app: App;
  draft: TFile;
  index: PlainCitationIndex & {
    runtime: import("@/lib/effect-stream").SubscriptionRuntime;
  };
  ready: Promise<void>;
  runtime: ReturnType<typeof citationIndexFixture>["runtime"];
  closeIndex: () => Promise<void>;
  lookup: Awaited<ReturnType<typeof citationLookupFixture>>;
  metadataCache: MockMetadataCache;
  noteIndex: PlainNoteIndex;
  settings: SettingsFixture;
  settingsBridge: SettingsFixture["bridge"];
  store: MemoryStore;
  vault: MockVault;
  workspace: MemoryWorkspace;
  db: DatabaseStub;
  citekeys: CitekeysStub;
  libraryScope: LibraryScopeStub;
  /** The one client the owners built on this harness share. */
  queryClient: PlainQueryClients;
  /** Moves the client's clock one step past the failure cooldown deadline. */
  passCooldown: () => void;
}

export interface CitationIndexHarnessOptions {
  context?: Context.Context<never>;
  parseClient?: ParseClient;
  openStore?: () => Promise<CitekeyStore>;
  settings?: Partial<Settings>;
  store?: MemoryStore;
  citekeys?: LibraryCitekey[];
  db?: DatabaseStub;
  /**
   * SQL for the rows the default {@link DatabaseStub}'s database holds; its
   * citation-key read then answers from them too.
   */
  zoteroRows?: string;
  notes?: boolean;
  settingsService?: SettingsFixture;
  awaitReady?: boolean;
  libraryScope?: LibraryScopeStub;
}

export async function createCitationIndexHarness(
  documents: Record<string, string>,
  options: CitationIndexHarnessOptions = {},
): Promise<CitationIndexHarness> {
  await using stack = new AsyncDisposableStack();
  const metadataCache = new MockMetadataCache();
  const vault = new MockVault(metadataCache);
  const workspace = new MemoryWorkspace();
  const store = options.store ?? new MemoryStore();
  const db = stack.use(
    options.db ?? new DatabaseStub({ seed: options.zoteroRows }),
  );
  const { citekeys } = db;
  if (options.citekeys) citekeys.rows = options.citekeys;
  // The default rows hold an Item of My Library and one of group 7's Library.
  const libraryScope =
    options.libraryScope ??
    new LibraryScopeStub([personalLibrary(), groupLibrary()]);

  db.libraries = () => [...libraryScope.libraries];

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
      addFile(path, "");
      metadataCache.fileCache.set(path, {
        frontmatter: {
          [FIELD_ZOTERO_KEY]: indexedKey,
          [FIELD_CITEKEY]: citekey,
        },
      } as CachedMetadata);
    }
  }
  for (const [path, body] of Object.entries(documents)) {
    addFile(path, body);
    metadataCache.fileCache.set(path, { links: [] } as CachedMetadata);
  }

  const app = { metadataCache, vault, workspace } as unknown as App;
  // The Note Index runs as it does once enabled at runtime: layout is ready
  // and the cache clean, so its Full Scan finishes before the harness returns.
  // The Citation Index keeps the deferred layout the test releases.
  const noteIndex = buildNoteIndex(
    {
      metadataCache,
      vault,
      workspace: new MemoryWorkspace({ layoutReady: true }),
    } as unknown as App,
    stack,
  );
  const settings =
    options.settingsService ??
    stack.use(await buildSeededSettings(options.settings));
  const clock = testClock();
  const queryClient = stack.use(queryClientsFixture(clock.now));
  const lookup = stack.use(
    await citationLookupFixture({
      reads: db,
      libraryScope,
      queryClient,
    }),
  );
  const fixture = citationIndexFixture(
    {
      app,
      db,
      libraryScope,
      noteIndex,
      settings,
      lookup: lookup.runtime.runSync(CitationLookup),
      parseClient: options.parseClient ?? inProcessParseClient,
      openStore: options.openStore ?? (() => Promise.resolve(store)),
      context: options.context,
    },
    stack,
  );
  let index: PlainCitationIndex & {
    runtime: import("@/lib/effect-stream").SubscriptionRuntime;
  };
  const ready = fixture.ready.then((value) => {
    index = value;
  });
  const awaitReady = options.awaitReady ?? true;
  if (awaitReady) await ready;
  if (awaitReady && !options.db) await lookup.whenResolved();
  vault.reads.length = 0;
  store.writes.length = 0;
  const resources = stack.move();

  return {
    app,
    draft: metadataCache.files.get("draft.md")!,
    get index() {
      return index;
    },
    ready,
    runtime: fixture.runtime,
    closeIndex: () => fixture.runtime.dispose(),
    lookup,
    metadataCache,
    noteIndex,
    settings,
    settingsBridge: settings.bridge,
    store,
    vault,
    workspace,
    db,
    citekeys,
    libraryScope,
    queryClient,
    passCooldown: clock.passCooldown,
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
