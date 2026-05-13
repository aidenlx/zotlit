import { basename } from "node:path/posix";

import {
  TFile,
  type App,
  type CachedMetadata,
  type EventRef,
  type Plugin,
  type Pos,
} from "obsidian";
import { afterEach, describe, expect, it } from "vitest";

import { formatItemKey, isLiteratureNote, NoteIndex } from "./service";

const ITEM_A = "ABCD2345";
const ITEM_A_GROUP = `${ITEM_A}g42`;
const ITEM_B = "ZZZ99999";
const PARENT = "PQRST678";

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

  addFile(path: string): TFile {
    const file = makeFile(path);
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

    expect(service.getNotesByItemKey(ITEM_A)).toEqual(["paper.md"]);
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

    expect(service.getNotesByItemKey(ITEM_A)).toEqual(["paper.md"]);
  });

  it("builds indices on resolved and emits rebuilt once", async () => {
    const { metadataCache, service } = await makeHarness({
      "Notes/a.md": cache({
        itemKey: ITEM_A,
        citekey: "doe2024",
        sections: [section(`${ITEM_A}a${PARENT}g42p7`, 1)],
      }),
      "Notes/b.md": cache({ itemKey: `${ITEM_B}g7`, citekey: "roe2025" }),
    });
    let rebuilt = 0;
    service.on("rebuilt", () => {
      rebuilt++;
    });

    metadataCache.resolve();

    expect(rebuilt).toBe(1);
    expect(service.getNotesByItemKey(ITEM_A)).toEqual(["Notes/a.md"]);
    expect(service.getNotesByCitekey("roe2025")).toEqual(["Notes/b.md"]);
    expect(service.getBlocksFor({ itemKey: ITEM_A_GROUP })).toHaveLength(1);
  });

  it("updates indices and emits changed for metadata edits", async () => {
    const { service, vault, metadataCache } = await makeHarness({
      "paper.md": cache({ citekey: "doe2024" }),
    });
    metadataCache.resolve();
    const changed: string[] = [];
    service.on("changed", (file) => changed.push(file));

    metadataCache.change(
      vault.files.get("paper.md")!,
      cache({ itemKey: ITEM_A, citekey: "doe2024" }),
    );

    expect(changed).toEqual(["paper.md"]);
    expect(service.getNotesByItemKey(ITEM_A)).toEqual(["paper.md"]);
  });

  it("does not emit changed for no-op metadata updates", async () => {
    const { service, vault, metadataCache } = await makeHarness({
      "paper.md": cache({ itemKey: ITEM_A, citekey: "doe2024" }),
    });
    metadataCache.resolve();
    const changed: string[] = [];
    service.on("changed", (file) => changed.push(file));

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
    expect(service.getNotesByItemKey(ITEM_B)).toEqual(["paper.md"]);
  });

  it("handles vault renames by moving file-path contributions", async () => {
    const { service, vault, metadataCache } = await makeHarness({
      "paper.md": cache({
        itemKey: ITEM_A,
        citekey: "doe2024",
        sections: [section(`${ITEM_A}a${PARENT}g42p7`, 1)],
      }),
    });
    metadataCache.resolve();

    vault.renameFile("paper.md", "Notes/paper.md");

    expect(service.getNotesByItemKey(ITEM_A)).toEqual(["Notes/paper.md"]);
    expect(service.getNotesByCitekey("doe2024")).toEqual(["Notes/paper.md"]);
    expect(service.getBlocksFor({ file: "paper.md" })).toEqual([]);
    expect(service.getBlocksFor({ file: "Notes/paper.md" })).toHaveLength(1);
  });

  it("drops note, citekey, and block indices on delete", async () => {
    const { service, vault, metadataCache } = await makeHarness({
      "paper.md": cache({
        itemKey: ITEM_A,
        citekey: "doe2024",
        sections: [section(`${ITEM_A}a${PARENT}g42p7`, 1)],
      }),
    });
    metadataCache.resolve();

    vault.deleteFile("paper.md");

    expect(service.getNotesByItemKey(ITEM_A)).toEqual([]);
    expect(service.getNotesByCitekey("doe2024")).toEqual([]);
    expect(service.getBlocksFor({ itemKey: ITEM_A_GROUP })).toEqual([]);
  });

  it("queries blocks by file, item key, and their intersection", async () => {
    const { service, metadataCache } = await makeHarness({
      "a.md": cache({
        sections: [
          section(`${ITEM_A}a${PARENT}g42p7n${ITEM_B}a${PARENT}p2`, 1),
        ],
      }),
      "b.md": cache({
        sections: [section(`${ITEM_A}a${PARENT}g42p8`, 3)],
      }),
    });
    metadataCache.resolve();

    expect(
      service.getBlocksFor({ file: "a.md" }).map((block) => block.key),
    ).toEqual([ITEM_A_GROUP, ITEM_B]);
    expect(
      service
        .getBlocksFor({ itemKey: ITEM_A_GROUP })
        .map((block) => block.file),
    ).toEqual(["a.md", "b.md"]);
    expect(
      service.getBlocksFor({ file: "a.md", itemKey: ITEM_A_GROUP }),
    ).toEqual([expect.objectContaining({ file: "a.md", key: ITEM_A_GROUP })]);
    expect(() => service.getBlocksFor({})).toThrow(
      new TypeError("getBlocksFor: provide file or itemKey"),
    );
  });

  it("checks literature notes from frontmatter only", async () => {
    const { app, vault } = await makeHarness({
      "paper.md": cache({ itemKey: ITEM_A }),
      "invalid.md": cache({ itemKey: "INVALID" }),
    });

    expect(isLiteratureNote(vault.files.get("paper.md")!, app)).toBe(true);
    expect(isLiteratureNote("paper.md", app)).toBe(true);
    expect(isLiteratureNote("invalid.md", app)).toBe(false);
    expect(formatItemKey(ITEM_A, 42)).toBe(ITEM_A_GROUP);
    expect(formatItemKey(ITEM_A, null)).toBe(ITEM_A);
  });
});

async function makeHarness(
  files: Record<string, CachedMetadata>,
  options: { initialized?: boolean } = {},
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
  const service = new NoteIndex({ plugin, app });
  services.push(service);
  await service.ready;
  return { app, metadataCache, service, vault };
}

function cache(options: {
  itemKey?: unknown;
  citekey?: unknown;
  sections?: SectionCacheLike[];
}): CachedMetadata {
  const frontmatter: Record<string, unknown> = {};
  if (options.itemKey !== undefined)
    frontmatter["zotero-key"] = options.itemKey;
  if (options.citekey !== undefined) frontmatter.citekey = options.citekey;

  return {
    frontmatter: Object.keys(frontmatter).length > 0 ? frontmatter : undefined,
    sections: options.sections,
  } as CachedMetadata;
}

type SectionCacheLike = NonNullable<CachedMetadata["sections"]>[number];

function section(id: string, line: number): SectionCacheLike {
  return { id, position: pos(line), type: "paragraph" };
}

function pos(line: number): Pos {
  return {
    start: { line, col: 0, offset: line * 10 },
    end: { line, col: 5, offset: line * 10 + 5 },
  };
}

function makeFile(path: string): TFile {
  const file = new TFile();
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
