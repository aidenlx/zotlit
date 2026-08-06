import { basename } from "node:path/posix";
import { TFile, type App, type CachedMetadata, type EventRef } from "obsidian";
import { describe, expect, it } from "vitest";

import { FIELD_ZOTERO_KEY } from "@/lib/constants";

import { CitationScanner } from "./service";

const KEY_A = "ABCD2345";
const KEY_B = "ZZZ99999g7";
const KEY_C = "QWER6789";

type Callback = (...args: unknown[]) => void;

/** Emitter shaped like Obsidian's `Events`, so `registerEvent` can unhook it. */
class MockEvents {
  readonly #listeners = new Map<string, Set<Callback>>();

  on(name: string, callback: Callback): EventRef {
    let listeners = this.#listeners.get(name);
    if (!listeners) this.#listeners.set(name, (listeners = new Set()));
    listeners.add(callback);
    return { e: this, name, callback } as unknown as EventRef;
  }

  offref(ref: EventRef): void {
    const { name, callback } = ref as unknown as {
      name: string;
      callback: Callback;
    };
    this.#listeners.get(name)?.delete(callback);
  }

  protected emit(name: string, ...args: unknown[]): void {
    for (const callback of this.#listeners.get(name) ?? []) callback(...args);
  }
}

class MockMetadataCache extends MockEvents {
  readonly files = new Map<string, TFile>();
  readonly fileCache = new Map<string, CachedMetadata>();
  initialized = false;

  getFileCache(file: TFile): CachedMetadata | null {
    return this.fileCache.get(file.path) ?? null;
  }

  /** Exact-path resolution; enough to tell a hit from a dangling link. */
  getFirstLinkpathDest(linkpath: string, _sourcePath: string): TFile | null {
    return this.files.get(`${linkpath}.md`) ?? null;
  }

  addFile(path: string, cache: CachedMetadata): TFile {
    const file = makeFile(path);
    this.files.set(path, file);
    this.fileCache.set(path, cache);
    return file;
  }

  change(path: string, cache: CachedMetadata): void {
    this.fileCache.set(path, cache);
    this.emit("changed", this.files.get(path), "", cache);
  }

  resolve(): void {
    this.initialized = true;
    this.emit("resolved");
  }
}

class MockWorkspace extends MockEvents {
  #activeFile: TFile | null = null;

  getActiveFile(): TFile | null {
    return this.#activeFile;
  }

  setActiveFile(file: TFile | null): void {
    this.#activeFile = file;
    this.emit("active-leaf-change", null);
  }
}

describe("CitationScanner", () => {
  it("scans the active document on startup", async () => {
    await using harness = await makeHarness();

    expect(harness.scanner.store.getState().citations).toMatchObject([
      { indexedKey: KEY_A, linkpath: "Doe 2024", refNumber: 1 },
      { indexedKey: KEY_B, linkpath: "Roe 2025", refNumber: 2 },
    ]);
  });

  it("waits for the first vault scan when metadata is uninitialized", async () => {
    await using harness = await makeHarness({ initialized: false });
    const { metadataCache, scanner } = harness;

    expect(scanner.store.getState().citations).toEqual([]);

    metadataCache.resolve();

    expect(scanner.store.getState().citations).toHaveLength(2);
  });

  it("reports no citations without an active document", async () => {
    await using harness = await makeHarness();

    harness.workspace.setActiveFile(null);

    expect(harness.scanner.store.getState().citations).toEqual([]);
  });

  it("rescans when the active leaf changes", async () => {
    await using harness = await makeHarness();
    const { metadataCache, scanner, workspace } = harness;
    const other = metadataCache.addFile(
      "other.md",
      body([wikilink("Roe 2025", 0)]),
    );

    workspace.setActiveFile(other);

    expect(scanner.store.getState().citations).toMatchObject([
      { indexedKey: KEY_B, refNumber: 1 },
    ]);
  });

  it("rescans when metadata changes", async () => {
    await using harness = await makeHarness();
    const { metadataCache, scanner } = harness;

    metadataCache.change("draft.md", body([wikilink("Roe 2025", 4)]));

    expect(scanner.store.getState().citations).toMatchObject([
      {
        indexedKey: KEY_B,
        refNumber: 1,
        occurrences: [{ start: { line: 4, col: 0, offset: 0 } }],
      },
    ]);
  });

  it("picks up a note that becomes a Literature Note", async () => {
    await using harness = await makeHarness();
    const { metadataCache, scanner } = harness;

    metadataCache.change("Daily/2024-01-01.md", literatureNote(KEY_C));

    expect(scanner.store.getState().citations).toMatchObject([
      { indexedKey: KEY_A, refNumber: 1 },
      { indexedKey: KEY_C, linkpath: "Daily/2024-01-01", refNumber: 2 },
      { indexedKey: KEY_B, refNumber: 3 },
    ]);
  });

  it("leaves subscribers untouched when the citation list is unchanged", async () => {
    await using harness = await makeHarness();
    const { metadataCache, scanner } = harness;
    let notified = 0;
    scanner.store.subscribe(() => notified++);

    metadataCache.change("draft.md", body(DRAFT_LINKS));

    expect(notified).toBe(0);
  });

  it("stops rescanning after disposal", async () => {
    const { metadataCache, scanner } = await makeHarness();
    const before = scanner.store.getState().citations;

    await scanner[Symbol.asyncDispose]();
    metadataCache.change("draft.md", body([]));

    expect(scanner.store.getState().citations).toBe(before);
  });
});

const DRAFT_LINKS = [
  wikilink("Doe 2024", 1),
  wikilink("Daily/2024-01-01", 2),
  wikilink("Roe 2025", 3),
  wikilink("Doe 2024#Findings", 5),
];

interface Harness extends AsyncDisposable {
  metadataCache: MockMetadataCache;
  scanner: CitationScanner;
  workspace: MockWorkspace;
}

async function makeHarness(
  options: { initialized?: boolean } = {},
): Promise<Harness> {
  const metadataCache = new MockMetadataCache();
  const workspace = new MockWorkspace();

  metadataCache.addFile("Doe 2024.md", literatureNote(KEY_A));
  metadataCache.addFile("Roe 2025.md", literatureNote(KEY_B));
  metadataCache.addFile("Daily/2024-01-01.md", body([]));
  const draft = metadataCache.addFile("draft.md", body(DRAFT_LINKS));
  workspace.setActiveFile(draft);
  metadataCache.initialized = options.initialized ?? true;

  const app = { metadataCache, workspace } as unknown as App;
  const scanner = new CitationScanner({ app });
  await scanner.ready;
  return {
    metadataCache,
    scanner,
    workspace,
    [Symbol.asyncDispose]: () => scanner[Symbol.asyncDispose](),
  };
}

function wikilink(target: string, line: number) {
  return {
    link: target,
    original: `[[${target}]]`,
    position: {
      start: { line, col: 0, offset: 0 },
      end: { line, col: target.length + 4, offset: 0 },
    },
  };
}

function body(links: ReturnType<typeof wikilink>[]): CachedMetadata {
  return { links } as CachedMetadata;
}

function literatureNote(indexedKey: string): CachedMetadata {
  return { frontmatter: { [FIELD_ZOTERO_KEY]: indexedKey } } as CachedMetadata;
}

function makeFile(path: string): TFile {
  const file = new TFile();
  const name = basename(path);
  file.path = path;
  file.name = name;
  file.basename = name.replace(/\.[^.]+$/, "");
  file.extension = name.includes(".") ? name.split(".").at(-1)! : "";
  return file;
}
