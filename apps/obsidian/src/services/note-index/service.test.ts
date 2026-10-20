import { basename } from "node:path/posix";
import { TFile } from "obsidian";
import type { App, CachedMetadata, EventRef, Plugin } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIELD_ZOTERO_KEY } from "@/lib/constants";
import type { ProfileId } from "@/lib/profile-stamp";

import { isLiteratureNote, NoteIndex, resolveIndexedKey } from "./service";

const warn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/log", () => ({
  getLogger: () => ({ debug: vi.fn(), warn }),
}));

const ITEM_A = "ABCD2345";
const ITEM_B = "ZZZ99999";

it("returns Literature and Imported Notes separately by Profile ID, following stamp edits", async () => {
  const profile = "Bk3Qn7XvT2Lp" as ProfileId;
  const { service, metadataCache, vault } = await makeHarness(
    {
      "Book.md": {
        frontmatter: {
          "zotero-key": ITEM_A,
          "zotlit-profile": `Old label (${profile})`,
        },
      },
      "Import.md": {
        frontmatter: { "zotero-note-key": ITEM_B, "zotlit-profile": profile },
      },
      "Default.md": { frontmatter: { "zotero-key": "DFLT2345" } },
      "Scratch.md": { frontmatter: { "zotlit-profile": profile } },
      "Unknown.md": {
        frontmatter: {
          "zotero-key": "UNKN2345",
          "zotlit-profile": "unrecognized",
        },
      },
    },
    { enabledAtRuntime: true },
  );
  const notes = service.getNotesByProfile(profile);
  expect(paths(notes.literatureNotes)).toEqual(["Book.md"]);
  expect(paths(notes.importedNotes)).toEqual(["Import.md"]);
  expect(paths(service.getNotesByProfile("default").literatureNotes)).toEqual([
    "Default.md",
  ]);
  metadataCache.change(vault.files.get("Book.md")!, {
    frontmatter: { "zotero-key": ITEM_A },
  });
  expect(service.getNotesByProfile(profile).literatureNotes).toEqual([]);
  expect(
    paths(service.getNotesByProfile("default").literatureNotes).sort(),
  ).toEqual(["Book.md", "Default.md"]);
});

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

  /** As Obsidian: `null` for a path it holds nothing for, `{}` for a non-Markdown file. */
  getCache(path: string): CachedMetadata | null {
    const cache = this.fileCache.get(path);
    if (!cache) return null;
    return path.endsWith(".md") ? cache : {};
  }

  /**
   * Obsidian's `watchVaultChanges()`: the cache follows a rename or delete as
   * one more vault listener, in registration order. It subscribes once its
   * initial load is done, so a plugin loaded during startup hears a rename
   * before the cache rekeys; one enabled at runtime hears it after.
   */
  watchVault(vault: MockVault): void {
    vault.on("rename", (...args) => {
      const [file, oldPath] = args as [TFile, string];
      const cache = this.fileCache.get(oldPath);
      if (!cache) return;
      this.fileCache.delete(oldPath);
      this.fileCache.set(file.path, cache);
    });
    vault.on("delete", (file) => {
      this.fileCache.delete((file as TFile).path);
    });
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
    this.#emit("rename", file, oldPath);
    return file;
  }

  deleteFile(path: string): void {
    const file = this.files.get(path);
    if (!file) throw new Error(`Missing file: ${path}`);

    this.files.delete(path);
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

beforeEach(() => {
  warn.mockClear();
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
    const { metadataCache, workspace, service, vault } = await makeHarness(
      {
        "paper.md": cache({ itemKey: ITEM_A }),
      },
      { enabledAtRuntime: false },
    );

    expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);

    startup({ metadataCache, workspace, vault });

    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
  });

  it("says indexed, not changed for each note, once the Full Scan has read the notes the cache held at startup", async () => {
    const { metadataCache, workspace, service, vault } = await makeHarness(
      { "paper.md": cache({ itemKey: ITEM_A }) },
      { enabledAtRuntime: false },
    );
    await service.ready;
    const heard: string[] = [];
    service.on("changed", (file) => heard.push(`changed ${file.path}`));
    service.on("indexed", () => heard.push("indexed"));
    startup({ metadataCache, workspace, vault });
    // The whole index changed, not one file.
    expect(heard).toEqual(["indexed"]);
  });

  it("whenIndexed resolves immediately once the Full Scan has run", async () => {
    const { service } = await makeHarness(
      { "paper.md": cache({ itemKey: ITEM_A }) },
      { enabledAtRuntime: true },
    );

    await expect(service.whenIndexed()).resolves.toBeUndefined();
  });

  it("whenIndexed waits for the Full Scan when loaded during startup", async () => {
    const { metadataCache, workspace, service, vault } = await makeHarness(
      { "paper.md": cache({ itemKey: ITEM_A }) },
      { enabledAtRuntime: false },
    );

    let settled = false;
    await service.ready;
    const gate = service.whenIndexed().then(() => {
      settled = true;
    });
    expect(settled).toBe(false);

    startup({ metadataCache, workspace, vault });
    await gate;
    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
  });

  it("tells its consumers when the Full Scan has indexed the notes", async () => {
    const { metadataCache, workspace, service, vault } = await makeHarness(
      { "paper.md": cache({ itemKey: ITEM_A }) },
      { enabledAtRuntime: false },
    );
    await service.ready;
    const seen: string[][] = [];
    service.on("indexed", () =>
      seen.push(paths(service.getNotesByItemKey(ITEM_A))),
    );

    startup({ metadataCache, workspace, vault });

    expect(seen).toEqual([["paper.md"]]);
  });

  it("keeps per-file mappings when the cache resolves again after the Full Scan", async () => {
    const { metadataCache, workspace, service, vault } = await makeHarness({
      "paper.md": cache({ itemKey: ITEM_A }),
    });
    startup({ metadataCache, workspace, vault });

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
    startup({ metadataCache, workspace, vault });
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
    startup({ metadataCache, workspace, vault });
    const changed: string[] = [];
    service.on("changed", (file) => changed.push(file.path));

    metadataCache.change(
      vault.files.get("paper.md")!,
      cache({ itemKey: ITEM_A }),
    );

    expect(changed).toEqual([]);
  });

  it("emits frontmatter-changed for any frontmatter edit of a tracked note, beside changed for its Indexed Key", async () => {
    const { service, vault, metadataCache } = await makeHarness(
      {
        "paper.md": cache({ itemKey: ITEM_A, properties: { status: "new" } }),
        "Import.md": { frontmatter: { "zotero-note-key": ITEM_B } },
      },
      { enabledAtRuntime: true },
    );
    const changed: string[] = [];
    const frontmatter: string[] = [];
    service.on("changed", (file) => changed.push(file.path));
    service.on("frontmatter-changed", (file) => frontmatter.push(file.path));

    metadataCache.change(
      vault.files.get("paper.md")!,
      cache({ itemKey: ITEM_A, properties: { status: "read" } }),
    );
    metadataCache.change(vault.files.get("Import.md")!, {
      frontmatter: { "zotero-note-key": ITEM_B, rating: 3 },
    } as CachedMetadata);
    expect(frontmatter).toEqual(["paper.md", "Import.md"]);
    expect(changed).toEqual([]);

    metadataCache.change(
      vault.files.get("paper.md")!,
      cache({ itemKey: ITEM_B, properties: { status: "read" } }),
    );
    expect(frontmatter).toEqual(["paper.md", "Import.md", "paper.md"]);
    expect(changed).toEqual(["paper.md"]);
  });

  it("emits no frontmatter-changed for an edit that leaves the frontmatter as it was, or for an untracked note", async () => {
    const { service, vault, metadataCache } = await makeHarness(
      {
        "paper.md": cache({ itemKey: ITEM_A, properties: { status: "new" } }),
        "scratch.md": cache({ properties: { status: "new" } }),
      },
      { enabledAtRuntime: true },
    );
    const frontmatter: string[] = [];
    service.on("frontmatter-changed", (file) => frontmatter.push(file.path));

    // A body edit: the cache is new, its frontmatter the same.
    metadataCache.change(
      vault.files.get("paper.md")!,
      cache({ itemKey: ITEM_A, properties: { status: "new" } }),
    );
    metadataCache.change(
      vault.files.get("scratch.md")!,
      cache({ properties: { status: "read" } }),
    );

    expect(frontmatter).toEqual([]);
  });

  it("lists the property names of the Literature Notes but the reserved and system keys, following edits", async () => {
    const { service, vault, metadataCache } = await makeHarness(
      {
        "a.md": cache({
          itemKey: ITEM_A,
          properties: {
            status: "read",
            tags: ["x"],
            aliases: ["y"],
            cssclasses: ["z"],
            "zotlit-profile": "default",
            "zotero-lastmod": "2026-01-01",
            "zotlit-csl": "apa",
            rating: 3,
          },
        }),
        "b.md": cache({ itemKey: ITEM_B, properties: { "Reading status": 1 } }),
        "Import.md": {
          frontmatter: { "zotero-note-key": "NOTE2345", imported: true },
        } as CachedMetadata,
        "scratch.md": cache({ properties: { draft: true } }),
      },
      { enabledAtRuntime: true },
    );

    expect(service.getPropertyNames()).toEqual([
      "rating",
      "Reading status",
      "status",
    ]);

    metadataCache.change(
      vault.files.get("b.md")!,
      cache({ itemKey: ITEM_B, properties: { priority: "high" } }),
    );
    expect(service.getPropertyNames()).toEqual([
      "priority",
      "rating",
      "status",
    ]);
  });

  it("moves a file from the old item key to the new item key", async () => {
    const { service, vault, metadataCache, workspace } = await makeHarness({
      "paper.md": cache({ itemKey: ITEM_A }),
    });
    startup({ metadataCache, workspace, vault });

    metadataCache.change(
      vault.files.get("paper.md")!,
      cache({ itemKey: ITEM_B }),
    );

    expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);
    expect(paths(service.getNotesByItemKey(ITEM_B))).toEqual(["paper.md"]);
  });

  it("scans once on resolved when the build has no clean-cache hook", async () => {
    const { service, metadataCache, workspace, vault } = await makeHarness(
      { "paper.md": cache({ itemKey: ITEM_A }) },
      { cleanCacheHook: false },
    );
    const gate = service.whenIndexed();

    startup({ metadataCache, workspace, vault });

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
    const { service, metadataCache, workspace, vault } = await makeHarness({});

    startup({ metadataCache, workspace, vault });

    await expect(service.whenIndexed()).resolves.toBeUndefined();
    expect(service.getIndexedItemKeys()).toEqual([]);
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
    startup({ metadataCache, workspace, vault });

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
    startup({ metadataCache, workspace, vault });

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
 * Obsidian hears a rename in vault listener order. A plugin loaded during
 * startup subscribes before the metadata cache and hears it before the cache
 * rekeys the path; a plugin enabled at runtime subscribes after.
 */
describe.each([
  { load: "during startup", enabledAtRuntime: false },
  { load: "at runtime", enabledAtRuntime: true },
])("NoteIndex after a rename, loaded $load", ({ enabledAtRuntime }) => {
  async function loaded(files: Record<string, CachedMetadata>) {
    const harness = await makeHarness(files, { enabledAtRuntime });
    if (!enabledAtRuntime) startup(harness);
    const changed: string[] = [];
    harness.service.on("changed", (file) => changed.push(file.path));
    return { ...harness, changed };
  }

  it("keeps a moved Literature Note under its key and says it moved", async () => {
    const { service, vault, changed } = await loaded({
      "literatures/paper.md": cache({ itemKey: ITEM_A }),
    });

    vault.renameFile("literatures/paper.md", "Drafts/moved.md");
    await settled();
    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual([
      "Drafts/moved.md",
    ]);
    expect(changed).toEqual(["Drafts/moved.md"]);

    vault.renameFile("Drafts/moved.md", "literatures/paper.md");
    await settled();
    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual([
      "literatures/paper.md",
    ]);
  });

  it("drops a Literature Note renamed out of Markdown and takes it back on the way in", async () => {
    const { service, vault, changed } = await loaded({
      "paper.md": cache({ itemKey: ITEM_A }),
    });

    vault.renameFile("paper.md", "paper.md.away");
    await settled();
    expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);

    // The cache still holds the parse under the restored path and reports no change.
    vault.renameFile("paper.md.away", "paper.md");
    await settled();
    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
    expect(changed).toEqual(["paper.md.away", "paper.md"]);
  });

  it("stays quiet for a renamed ordinary note", async () => {
    const { vault, changed } = await loaded({ "plain.md": cache({}) });

    vault.renameFile("plain.md", "Notes/plain.md");
    await settled();

    expect(changed).toEqual([]);
  });

  it("indexes a file renamed into Markdown once the cache reports its parse", async () => {
    const { service, vault, metadataCache } = await loaded({});
    vault.addFile("paper.txt");

    // The cache holds nothing for the file yet.
    const file = vault.renameFile("paper.txt", "paper.md");
    await settled();
    expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);

    metadataCache.change(file, cache({ itemKey: ITEM_A }));
    expect(paths(service.getNotesByItemKey(ITEM_A))).toEqual(["paper.md"]);
  });
});

/** Lets the vault finish its synchronous rename dispatch and what follows it. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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
  const vault = new MockVault();
  const app = { metadataCache, vault, workspace } as unknown as App;
  if (options.enabledAtRuntime) metadataCache.watchVault(vault);

  for (const [path, fileCache] of Object.entries(files)) {
    vault.addFile(path);
    metadataCache.setCache(path, fileCache);
  }

  const plugin = { app } as unknown as Plugin;
  const service = new NoteIndex({ plugin, app });
  services.push(service);
  await service.ready;
  return { app, metadataCache, workspace, service, vault };
}

/**
 * Obsidian's startup order: the cache finishes its initial load and starts
 * following the vault, drains, then layout is ready.
 */
function startup(
  harness: Pick<Harness, "metadataCache" | "workspace" | "vault">,
): void {
  harness.metadataCache.watchVault(harness.vault);
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
