import { basename } from "node:path/posix";
import { TFile } from "obsidian";
import type { App, CachedMetadata, EventRef, Plugin } from "obsidian";
import { afterEach, describe, expect, it } from "vitest";

import { FIELD_ZOTERO_KEY } from "@/lib/constants";

import { isLiteratureNote, NoteIndex, resolveIndexedKey } from "./service";

const ITEM_A = "ABCD2345";
const ITEM_B = "ZZZ99999";

type Callback = (...args: unknown[]) => void;
type MetadataEvent = "changed" | "deleted" | "resolved";
type VaultEvent = "rename" | "delete";

class MockMetadataCache {
  readonly fileCache = new Map<string, CachedMetadata>();
  /** Mirrors Obsidian's `isCacheClean()`: no parse pending, resolver idle. */
  clean = false;
  readonly #cleanCallbacks: Callback[] = [];

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

  /**
   * Obsidian's undocumented one-shot: at once when the cache is clean, else
   * after the next `resolved` drains the queue.
   */
  onCleanCache(callback: () => void): void {
    if (this.clean) callback();
    else this.#cleanCallbacks.push(callback);
  }

  /** The resolver queue drains: `resolved` fires and queued clean-cache callbacks run. */
  resolve(): void {
    this.clean = true;
    this.#emit("resolved");
    for (const callback of this.#cleanCallbacks.splice(0)) callback();
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

class MockWorkspace {
  layoutReady = false;
  readonly #callbacks: Callback[] = [];

  onLayoutReady(callback: () => void): void {
    if (this.layoutReady) callback();
    else this.#callbacks.push(callback);
  }

  /** Layout settles after the cache initializes, so it runs queued callbacks then. */
  ready(): void {
    this.layoutReady = true;
    for (const callback of this.#callbacks.splice(0)) callback();
  }
}

interface Harness {
  app: App;
  metadataCache: MockMetadataCache;
  workspace: MockWorkspace;
  service: NoteIndex;
  vault: MockVault;
}

const services: NoteIndex[] = [];

afterEach(async () => {
  for (const service of services.splice(0).reverse()) {
    await service[Symbol.asyncDispose]();
  }
});

describe("NoteIndex", () => {
  it("runs the Full Scan at once when enabled at runtime", async () => {
    const { service } = await makeHarness(
      {
        "paper.md": cache({ itemKey: ITEM_A }),
      },
      { enabledAtRuntime: true },
    );

    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
  });

  it("waits for cache completion when loaded during startup", async () => {
    const { metadataCache, workspace, service } = await makeHarness(
      {
        "paper.md": cache({ itemKey: ITEM_A }),
      },
      { enabledAtRuntime: false },
    );

    expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);

    startup({ metadataCache, workspace });

    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
  });

  it("whenIndexed resolves immediately once the Full Scan has run", async () => {
    const { service } = await makeHarness(
      { "paper.md": cache({ itemKey: ITEM_A }) },
      { enabledAtRuntime: true },
    );

    await expect(service.whenIndexed()).resolves.toBeUndefined();
  });

  it("whenIndexed waits for the Full Scan when loaded during startup", async () => {
    const { metadataCache, workspace, service } = await makeHarness(
      { "paper.md": cache({ itemKey: ITEM_A }) },
      { enabledAtRuntime: false },
    );

    let settled = false;
    const gate = service.whenIndexed().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve));
    expect(settled).toBe(false);

    startup({ metadataCache, workspace });
    await gate;
    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
  });

  it("keeps per-file mappings when the cache resolves again after the Full Scan", async () => {
    const { metadataCache, workspace, service } = await makeHarness({
      "paper.md": cache({ itemKey: ITEM_A }),
    });
    startup({ metadataCache, workspace });

    // A rescan would read this silent cache swap; the per-file path never sees it.
    metadataCache.setCache("paper.md", cache({ itemKey: ITEM_B }));
    metadataCache.resolve();

    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
    expect(service.getNotesByItemKey(ITEM_B)).toEqual([]);
  });

  it("updates indices and emits changed for metadata edits", async () => {
    const { service, vault, metadataCache, workspace } = await makeHarness({
      "paper.md": cache({}),
    });
    startup({ metadataCache, workspace });
    const changed: string[] = [];
    service.on("changed", (file) => changed.push(file.path));

    metadataCache.change(
      vault.files.get("paper.md")!,
      cache({ itemKey: ITEM_A }),
    );

    expect(changed).toEqual(["paper.md"]);
    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
  });

  it("does not emit changed for no-op metadata updates", async () => {
    const { service, vault, metadataCache, workspace } = await makeHarness({
      "paper.md": cache({ itemKey: ITEM_A }),
    });
    startup({ metadataCache, workspace });
    const changed: string[] = [];
    service.on("changed", (file) => changed.push(file.path));

    metadataCache.change(
      vault.files.get("paper.md")!,
      cache({ itemKey: ITEM_A }),
    );

    expect(changed).toEqual([]);
  });

  it("moves a file from the old item key to the new item key", async () => {
    const { service, vault, metadataCache, workspace } = await makeHarness({
      "paper.md": cache({ itemKey: ITEM_A }),
    });
    startup({ metadataCache, workspace });

    metadataCache.change(
      vault.files.get("paper.md")!,
      cache({ itemKey: ITEM_B }),
    );

    expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);
    expect(paths(service.getNotesByItemKey(ITEM_B))).toEqual(["paper.md"]);
  });

  it("scans once on resolved when the build has no clean-cache hook", async () => {
    const { service, metadataCache, workspace } = await makeHarness(
      { "paper.md": cache({ itemKey: ITEM_A }) },
      { cleanCacheHook: false },
    );
    const gate = service.whenIndexed();

    startup({ metadataCache, workspace });

    await expect(gate).resolves.toBeUndefined();
    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);

    // A later `resolved` finds no listener: the silent swap stays unseen.
    metadataCache.setCache("paper.md", cache({ itemKey: ITEM_B }));
    metadataCache.resolve();
    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
  });

  it("whenIndexed settles when the service is disposed before the Full Scan", async () => {
    const { service } = await makeHarness({
      "paper.md": cache({ itemKey: ITEM_A }),
    });
    const gate = service.whenIndexed();

    await service[Symbol.asyncDispose]();

    await expect(gate).resolves.toBeUndefined();
  });

  it("whenIndexed settles on an empty vault", async () => {
    const { service, metadataCache, workspace } = await makeHarness({});

    startup({ metadataCache, workspace });

    await expect(service.whenIndexed()).resolves.toBeUndefined();
    expect(service.getIndexedItemKeys()).toEqual([]);
  });

  it("emits changed for a renamed Literature Note and follows the new path", async () => {
    const { service, vault, metadataCache, workspace } = await makeHarness({
      "paper.md": cache({ itemKey: ITEM_A }),
    });
    startup({ metadataCache, workspace });
    const changed: string[] = [];
    service.on("changed", (file) => changed.push(file.path));

    vault.renameFile("paper.md", "Notes/paper.md");

    expect(changed).toEqual(["Notes/paper.md"]);
    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual([
      "Notes/paper.md",
    ]);
  });

  it("stays quiet for a renamed ordinary note", async () => {
    const { service, vault, metadataCache, workspace } = await makeHarness({
      "plain.md": cache({}),
    });
    startup({ metadataCache, workspace });
    const changed: string[] = [];
    service.on("changed", (file) => changed.push(file.path));

    vault.renameFile("plain.md", "Notes/plain.md");

    expect(changed).toEqual([]);
  });

  it("drops a Literature Note renamed out of Markdown", async () => {
    const { service, vault, metadataCache, workspace } = await makeHarness({
      "paper.md": cache({ itemKey: ITEM_A }),
    });
    startup({ metadataCache, workspace });

    vault.renameFile("paper.md", "paper.txt");

    expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);
  });

  it("indexes a note renamed into Markdown once its cache arrives", async () => {
    const { service, vault, metadataCache, workspace } = await makeHarness({});
    vault.addFile("paper.txt");
    startup({ metadataCache, workspace });

    // Obsidian has parsed nothing for the new path at rename time.
    const file = vault.renameFile("paper.txt", "paper.md");
    expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);

    metadataCache.change(file, cache({ itemKey: ITEM_A }));

    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
  });

  it("orders shared-key notes by mtime descending, then path", async () => {
    const { service, vault, metadataCache, workspace } = await makeHarness({
      "old.md": cache({ itemKey: ITEM_A }),
      "new.md": cache({ itemKey: ITEM_A }),
      "tie-b.md": cache({ itemKey: ITEM_A }),
      "tie-a.md": cache({ itemKey: ITEM_A }),
    });
    vault.files.get("old.md")!.stat.mtime = 100;
    vault.files.get("new.md")!.stat.mtime = 200;
    // tie-a.md and tie-b.md keep the default mtime 0 → path breaks the tie.
    startup({ metadataCache, workspace });

    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual([
      "new.md",
      "old.md",
      "tie-a.md",
      "tie-b.md",
    ]);
  });

  it("drops the item index on delete", async () => {
    const { service, vault, metadataCache, workspace } = await makeHarness({
      "paper.md": cache({ itemKey: ITEM_A }),
    });
    startup({ metadataCache, workspace });

    vault.deleteFile("paper.md");

    expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);
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

/**
 * `enabledAtRuntime: true` is the runtime-enable shape: layout ready, cache
 * clean. The default is plugin load during startup: neither yet, both settle
 * on `startup()`.
 */
async function makeHarness(
  files: Record<string, CachedMetadata>,
  options: { enabledAtRuntime?: boolean; cleanCacheHook?: boolean } = {},
): Promise<Harness> {
  const metadataCache = new MockMetadataCache();
  const workspace = new MockWorkspace();
  metadataCache.clean = options.enabledAtRuntime ?? false;
  workspace.layoutReady = options.enabledAtRuntime ?? false;
  if (options.cleanCacheHook === false) {
    // A build that dropped the internal hook.
    delete (metadataCache as { onCleanCache?: unknown }).onCleanCache;
  }
  const vault = new MockVault(metadataCache);

  for (const [path, fileCache] of Object.entries(files)) {
    vault.addFile(path);
    metadataCache.setCache(path, fileCache);
  }

  const app = { metadataCache, vault, workspace } as unknown as App;
  const plugin = { app } as unknown as Plugin;
  const service = new NoteIndex({ plugin, app });
  services.push(service);
  await service.ready;
  return { app, metadataCache, workspace, service, vault };
}

/** Obsidian's startup order: the cache initializes and drains, then layout is ready. */
function startup(harness: Pick<Harness, "metadataCache" | "workspace">): void {
  harness.metadataCache.resolve();
  harness.workspace.ready();
}

function cache(options: {
  itemKey?: unknown;
  properties?: Record<string, unknown>;
}): CachedMetadata {
  const frontmatter: Record<string, unknown> = { ...options.properties };
  if (options.itemKey !== undefined)
    frontmatter[FIELD_ZOTERO_KEY] = options.itemKey;

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
