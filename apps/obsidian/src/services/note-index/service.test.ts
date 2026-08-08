import { basename } from "node:path/posix";
import { TFile } from "obsidian";
import type { App, CachedMetadata, EventRef, Plugin } from "obsidian";
import { afterEach, describe, expect, it } from "vitest";

import { FIELD_CITEKEY, FIELD_ZOTERO_KEY } from "@/lib/constants";
import { defaults } from "@/services/settings/schema";
import type { Settings } from "@/services/settings/schema";

import { isLiteratureNote, NoteIndex, resolveIndexedKey } from "./service";

const ITEM_A = "ABCD2345";
const ITEM_B = "ZZZ99999";

type Callback = (...args: unknown[]) => void;
type MetadataEvent = "changed" | "deleted" | "resolved";
type VaultEvent = "rename" | "delete";

class MockMetadataCache {
  readonly fileCache = new Map<string, CachedMetadata>();
  initialized = false;

  readonly #listeners: Record<MetadataEvent, Set<Callback>> = {
    changed: new Set(),
    deleted: new Set(),
    resolved: new Set(),
  };

  getFileCache(file: TFile): CachedMetadata | null {
    return this.getCache(file.path);
  }

  getCache(path: string): CachedMetadata | null {
    return this.fileCache.get(path) ?? null;
  }

  on(name: MetadataEvent, callback: Callback): EventRef {
    this.#listeners[name].add(callback);
    return { e: this, name, callback } as unknown as EventRef;
  }

  offref(ref: EventRef): void {
    const { name, callback } = ref as unknown as {
      name: MetadataEvent;
      callback: Callback;
    };
    this.#listeners[name].delete(callback);
  }

  setCache(path: string, cache: CachedMetadata): void {
    this.fileCache.set(path, cache);
  }

  change(file: TFile, cache: CachedMetadata): void {
    this.fileCache.set(file.path, cache);
    this.#emit("changed", file, "", cache);
  }

  renameCache(oldPath: string, newPath: string): void {
    const cache = this.fileCache.get(oldPath);
    if (!cache) return;
    this.fileCache.delete(oldPath);
    this.fileCache.set(newPath, cache);
  }

  deleteCache(path: string): void {
    this.fileCache.delete(path);
  }

  resolve(): void {
    this.initialized = true;
    this.#emit("resolved");
  }

  #emit(name: MetadataEvent, ...args: unknown[]): void {
    for (const callback of this.#listeners[name]) callback(...args);
  }
}

class MockVault {
  readonly files = new Map<string, TFile>();

  readonly #listeners: Record<VaultEvent, Set<Callback>> = {
    rename: new Set(),
    delete: new Set(),
  };

  constructor(readonly metadataCache: MockMetadataCache) {}

  getMarkdownFiles(): TFile[] {
    return [...this.files.values()].filter((file) => file.extension === "md");
  }

  on(name: VaultEvent, callback: Callback): EventRef {
    this.#listeners[name].add(callback);
    return { e: this, name, callback } as unknown as EventRef;
  }

  offref(ref: EventRef): void {
    const { name, callback } = ref as unknown as {
      name: VaultEvent;
      callback: Callback;
    };
    this.#listeners[name].delete(callback);
  }

  addFile(path: string, mtime = 0): TFile {
    const file = makeFile(path, mtime);
    this.files.set(path, file);
    return file;
  }

  renameFile(oldPath: string, newPath: string): TFile {
    const file = this.files.get(oldPath);
    if (!file) throw new Error(`Missing file: ${oldPath}`);

    this.files.delete(oldPath);
    updateFilePath(file, newPath);
    this.files.set(newPath, file);
    this.metadataCache.renameCache(oldPath, newPath);
    this.#emit("rename", file, oldPath);
    return file;
  }

  deleteFile(path: string): void {
    const file = this.files.get(path);
    if (!file) throw new Error(`Missing file: ${path}`);

    this.files.delete(path);
    this.metadataCache.deleteCache(path);
    this.#emit("delete", file);
  }

  #emit(name: VaultEvent, ...args: unknown[]): void {
    for (const callback of this.#listeners[name]) callback(...args);
  }
}

interface Harness {
  app: App;
  metadataCache: MockMetadataCache;
  service: NoteIndex;
  vault: MockVault;
  settings: SettingsStub;
}

class SettingsStub {
  current: Readonly<Settings>;
  readonly ready = Promise.resolve();
  readonly #listeners = new Set<
    (settings: Readonly<Settings> | null) => void
  >();

  constructor(overrides: Partial<Settings> = {}) {
    this.current = { ...defaults, ...overrides };
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

const services: NoteIndex[] = [];

afterEach(async () => {
  for (const service of services.splice(0).reverse()) {
    await service[Symbol.asyncDispose]();
  }
});

describe("NoteIndex", () => {
  it("runs the initial scan synchronously when metadata is already initialized", async () => {
    const { service } = await makeHarness(
      {
        "paper.md": cache({ itemKey: ITEM_A }),
      },
      { initialized: true },
    );

    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
  });

  it("waits for resolved when metadata is explicitly uninitialized", async () => {
    const { metadataCache, service } = await makeHarness(
      {
        "paper.md": cache({ itemKey: ITEM_A }),
      },
      { initialized: false },
    );

    expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);

    metadataCache.resolve();

    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
  });

  it("whenIndexed resolves immediately once the initial scan has run", async () => {
    const { service } = await makeHarness(
      { "paper.md": cache({ itemKey: ITEM_A }) },
      { initialized: true },
    );

    await expect(service.whenIndexed()).resolves.toBeUndefined();
  });

  it("whenIndexed waits for the first scan when metadata is uninitialized", async () => {
    const { metadataCache, service } = await makeHarness(
      { "paper.md": cache({ itemKey: ITEM_A }) },
      { initialized: false },
    );

    let settled = false;
    const gate = service.whenIndexed().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve));
    expect(settled).toBe(false);

    metadataCache.resolve();
    await gate;
    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
  });

  it("builds indices on resolved and emits rebuilt once", async () => {
    const { metadataCache, service } = await makeHarness({
      "Notes/a.md": cache({
        itemKey: ITEM_A,
        citekey: "doe2024",
      }),
      "Notes/b.md": cache({ itemKey: `${ITEM_B}g7`, citekey: "roe2025" }),
    });
    let rebuilt = 0;
    service.on("rebuilt", () => {
      rebuilt++;
    });

    metadataCache.resolve();

    expect(rebuilt).toBe(1);
    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["Notes/a.md"]);
    expect(paths(service.getNotesByCitationKey("roe2025"))).toEqual([
      "Notes/b.md",
    ]);
  });

  it("updates indices and emits changed for metadata edits", async () => {
    const { service, vault, metadataCache } = await makeHarness({
      "paper.md": cache({ citekey: "doe2024" }),
    });
    metadataCache.resolve();
    const changed: string[] = [];
    service.on("changed", (file) => changed.push(file.path));

    metadataCache.change(
      vault.files.get("paper.md")!,
      cache({ itemKey: ITEM_A, citekey: "doe2024" }),
    );

    expect(changed).toEqual(["paper.md"]);
    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
  });

  it("does not emit changed for no-op metadata updates", async () => {
    const { service, vault, metadataCache } = await makeHarness({
      "paper.md": cache({ itemKey: ITEM_A, citekey: "doe2024" }),
    });
    metadataCache.resolve();
    const changed: string[] = [];
    service.on("changed", (file) => changed.push(file.path));

    metadataCache.change(
      vault.files.get("paper.md")!,
      cache({ itemKey: ITEM_A, citekey: "doe2024" }),
    );

    expect(changed).toEqual([]);
  });

  it("moves a file from the old item key to the new item key", async () => {
    const { service, vault, metadataCache } = await makeHarness({
      "paper.md": cache({ itemKey: ITEM_A }),
    });
    metadataCache.resolve();

    metadataCache.change(
      vault.files.get("paper.md")!,
      cache({ itemKey: ITEM_B }),
    );

    expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);
    expect(paths(service.getNotesByItemKey(ITEM_B))).toEqual(["paper.md"]);
  });

  it("reflects vault renames without a rename handler", async () => {
    const { service, vault, metadataCache } = await makeHarness({
      "paper.md": cache({
        itemKey: ITEM_A,
        citekey: "doe2024",
      }),
    });
    metadataCache.resolve();

    vault.renameFile("paper.md", "Notes/paper.md");

    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual([
      "Notes/paper.md",
    ]);
    expect(paths(service.getNotesByCitationKey("doe2024"))).toEqual([
      "Notes/paper.md",
    ]);
  });

  it("orders shared-key notes by mtime descending, then path", async () => {
    const { service, vault, metadataCache } = await makeHarness({
      "old.md": cache({ itemKey: ITEM_A }),
      "new.md": cache({ itemKey: ITEM_A }),
      "tie-b.md": cache({ itemKey: ITEM_A }),
      "tie-a.md": cache({ itemKey: ITEM_A }),
    });
    vault.files.get("old.md")!.stat.mtime = 100;
    vault.files.get("new.md")!.stat.mtime = 200;
    // tie-a.md and tie-b.md keep the default mtime 0 → path breaks the tie.
    metadataCache.resolve();

    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual([
      "new.md",
      "old.md",
      "tie-a.md",
      "tie-b.md",
    ]);
  });

  it("drops note and citekey indices on delete", async () => {
    const { service, vault, metadataCache } = await makeHarness({
      "paper.md": cache({
        itemKey: ITEM_A,
        citekey: "doe2024",
      }),
    });
    metadataCache.resolve();

    vault.deleteFile("paper.md");

    expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);
    expect(service.getNotesByCitationKey("doe2024")).toEqual([]);
  });

  it("indexes citation keys only from Literature Notes", async () => {
    const { metadataCache, service } = await makeHarness({
      "literature.md": cache({ itemKey: ITEM_A, citekey: "doe2024" }),
      "ordinary.md": cache({ citekey: "doe2024" }),
    });

    metadataCache.resolve();

    expect(paths(service.getNotesByCitationKey("doe2024"))).toEqual([
      "literature.md",
    ]);
  });

  it("rebuilds the citation-key index when its property changes", async () => {
    const { metadataCache, service, settings } = await makeHarness({
      "paper.md": cache({
        itemKey: ITEM_A,
        citekey: "old-key",
        properties: { bibkey: "new-key" },
      }),
    });
    metadataCache.resolve();

    settings.update({ "citation.key-links-frontmatter-key": "bibkey" });

    expect(service.getNotesByCitationKey("old-key")).toEqual([]);
    expect(paths(service.getNotesByCitationKey("new-key"))).toEqual([
      "paper.md",
    ]);
  });

  it("keeps the citation-key index whatever the citekey editor toggle is", async () => {
    const { metadataCache, service, settings } = await makeHarness({
      "paper.md": cache({ itemKey: ITEM_A, citekey: "doe2024" }),
    });
    metadataCache.resolve();

    expect(paths(service.getNotesByCitationKey("doe2024"))).toEqual([
      "paper.md",
    ]);

    settings.update({ "citation.citekey-editor": true });
    expect(paths(service.getNotesByCitationKey("doe2024"))).toEqual([
      "paper.md",
    ]);
  });

  it("clears partial citation-key mappings when the property changes before the first scan", async () => {
    const paper = cache({
      itemKey: ITEM_A,
      citekey: "doe2024",
      properties: { bibkey: "new-key" },
    });
    const { metadataCache, service, settings, vault } = await makeHarness({
      "paper.md": paper,
    });
    metadataCache.change(vault.files.get("paper.md")!, paper);
    expect(paths(service.getNotesByCitationKey("doe2024"))).toEqual([
      "paper.md",
    ]);

    settings.update({ "citation.key-links-frontmatter-key": "bibkey" });

    expect(service.getNotesByCitationKey("doe2024")).toEqual([]);
    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
  });

  it("checks literature notes from frontmatter only", async () => {
    const { app, vault } = await makeHarness({
      "paper.md": cache({ itemKey: ITEM_A }),
      "invalid.md": cache({ itemKey: "INVALID" }),
    });

    expect(isLiteratureNote(vault.files.get("paper.md")!, app)).toBe(true);
    expect(isLiteratureNote("paper.md", app)).toBe(true);
    expect(isLiteratureNote("invalid.md", app)).toBe(false);
  });

  it("resolves a linkpath to the Indexed Key of the Literature Note it points at", () => {
    const notes = new Map([
      ["Doe 2024.md", cache({ itemKey: ITEM_A })],
      ["Ordinary.md", cache({})],
    ]);
    // Exact-path resolution; enough to tell a hit from a dangling link.
    const app = {
      metadataCache: {
        getFirstLinkpathDest: (linkpath: string) =>
          notes.has(`${linkpath}.md`) ? makeFile(`${linkpath}.md`) : null,
        getFileCache: (file: TFile) => notes.get(file.path) ?? null,
      },
    } as unknown as App;

    expect(resolveIndexedKey("Doe 2024", "source.md", app)).toBe(ITEM_A);
    expect(resolveIndexedKey("Ordinary", "source.md", app)).toBeNull();
    expect(resolveIndexedKey("Missing", "source.md", app)).toBeNull();
  });
});

async function makeHarness(
  files: Record<string, CachedMetadata>,
  options: { initialized?: boolean; settings?: Partial<Settings> } = {},
): Promise<Harness> {
  const metadataCache = new MockMetadataCache();
  metadataCache.initialized = options.initialized ?? false;
  const vault = new MockVault(metadataCache);

  for (const [path, fileCache] of Object.entries(files)) {
    vault.addFile(path);
    metadataCache.setCache(path, fileCache);
  }

  const app = { metadataCache, vault } as unknown as App;
  const plugin = { app } as unknown as Plugin;
  const settings = new SettingsStub({
    "citation.key-links-frontmatter-key": FIELD_CITEKEY,
    ...options.settings,
  });
  const service = new NoteIndex({ plugin, app, settings });
  services.push(service);
  await service.ready;
  return { app, metadataCache, service, settings, vault };
}

function cache(options: {
  itemKey?: unknown;
  citekey?: unknown;
  properties?: Record<string, unknown>;
}): CachedMetadata {
  const frontmatter: Record<string, unknown> = { ...options.properties };
  if (options.itemKey !== undefined)
    frontmatter[FIELD_ZOTERO_KEY] = options.itemKey;
  if (options.citekey !== undefined)
    frontmatter[FIELD_CITEKEY] = options.citekey;

  return {
    frontmatter: Object.keys(frontmatter).length > 0 ? frontmatter : undefined,
  } as CachedMetadata;
}

function paths(files: TFile[]): string[] {
  return files.map((file) => file.path);
}

function makeFile(path: string, mtime = 0): TFile {
  const file = new TFile();
  file.stat = { ctime: 0, mtime, size: 0 };
  updateFilePath(file, path);
  return file;
}

function updateFilePath(file: TFile, path: string): void {
  const name = basename(path);
  file.path = path;
  file.name = name;
  file.basename = name.replace(/\.[^.]+$/, "");
  file.extension = name.includes(".") ? name.split(".").at(-1)! : "";
}
