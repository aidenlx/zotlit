import { basename } from "node:path/posix";
import {
  TFile,
  type App,
  type CachedMetadata,
  type EventRef,
  type LinkCache,
} from "obsidian";
import { afterEach, describe, expect, it } from "vitest";

import { FIELD_CITEKEY, FIELD_ZOTERO_KEY } from "@/lib/constants";
import { defaults, type Settings } from "@/services/settings/schema";

import { CitationIndex } from "./service";

const KEY_A = "ABCD2345";
const KEY_B = "ZZZ99999g7";

type Callback = (...args: unknown[]) => void;

class MockMetadataCache {
  readonly fileCache = new Map<string, CachedMetadata>();
  readonly files = new Map<string, TFile>();

  readonly #listeners: Record<string, Set<Callback>> = {
    changed: new Set(),
    deleted: new Set(),
  };

  getFileCache(file: TFile): CachedMetadata | null {
    return this.fileCache.get(file.path) ?? null;
  }

  getCache(path: string): CachedMetadata | null {
    return this.fileCache.get(path) ?? null;
  }

  /** Exact-path resolution; enough to tell a hit from a dangling link. */
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
    const cache = { links } as CachedMetadata;
    this.fileCache.set(file.path, cache);
    this.#emit("changed", file, body, cache);
  }

  delete(file: TFile): void {
    this.fileCache.delete(file.path);
    this.files.delete(file.path);
    this.#emit("deleted", file, null);
  }

  #emit(name: string, ...args: unknown[]): void {
    for (const callback of this.#listeners[name]!) callback(...args);
  }
}

class MockVault {
  readonly bodies = new Map<string, string>();
  readonly #listeners = new Set<Callback>();

  constructor(readonly metadataCache: MockMetadataCache) {}

  getMarkdownFiles(): TFile[] {
    return [...this.metadataCache.files.values()].filter(
      (file) => file.extension === "md",
    );
  }

  cachedRead(file: TFile): Promise<string> {
    return Promise.resolve(this.bodies.get(file.path) ?? "");
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

class MockWorkspace {
  readonly #pending: (() => void)[] = [];

  onLayoutReady(callback: () => void): void {
    this.#pending.push(callback);
  }

  layoutReady(): void {
    for (const callback of this.#pending.splice(0)) callback();
  }
}

class NoteIndexStub {
  readonly notes = new Map<string, TFile>();

  getNotesByCitationKey(citationKey: string): TFile[] {
    const note = this.notes.get(citationKey);
    return note ? [note] : [];
  }
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

const services: CitationIndex[] = [];

afterEach(async () => {
  for (const service of services.splice(0).reverse()) {
    await service[Symbol.asyncDispose]();
  }
});

describe("CitationIndex", () => {
  it("lists the literal citekeys of a document with their Reference Numbers", async () => {
    const { draft, index } = await makeHarness({
      "draft.md": "Cited by @doe2024 and @roe2025, then @doe2024 again.",
    });

    const citations = await index.getCitations(draft);

    expect(citations).toMatchObject([
      { indexedKey: KEY_A, linkpath: "Doe 2024.md", refNumber: 1 },
      { indexedKey: KEY_B, linkpath: "Roe 2025.md", refNumber: 2 },
    ]);
    expect(citations[0]!.occurrences).toHaveLength(2);
  });

  it("keeps a citekey no Literature Note carries", async () => {
    const { draft, index } = await makeHarness({
      "draft.md": "See @typo2024.",
    });

    expect(await index.getCitations(draft)).toMatchObject([
      { indexedKey: null, linkpath: null, refNumber: 1 },
    ]);
  });

  it("positions an occurrence at its place in the source", async () => {
    const { draft, index } = await makeHarness({
      "draft.md": "# Title\n\nAs @doe2024 wrote.\n",
    });

    const [citation] = await index.getCitations(draft);

    expect(citation!.occurrences[0]!.position).toEqual({
      start: { line: 2, col: 3, offset: 12 },
      end: { line: 2, col: 11, offset: 20 },
    });
  });

  it("merges wikilink occurrences from the metadata cache in document order", async () => {
    const { draft, index, metadataCache } = await makeHarness({
      "draft.md": "As @roe2025 wrote, see [[Doe 2024]].",
    });
    metadataCache.fileCache.set("draft.md", {
      links: [link("Doe 2024", 23)],
    } as CachedMetadata);

    const citations = await index.getCitations(draft);

    expect(citations).toMatchObject([
      { indexedKey: KEY_B, refNumber: 1 },
      { indexedKey: KEY_A, linkpath: "Doe 2024", refNumber: 2 },
    ]);
  });

  it("leaves citekeys inside code, math, comments, and frontmatter out", async () => {
    const { draft, index } = await makeHarness({
      "draft.md": [
        "---",
        "cite: @doe2024",
        "---",
        "",
        "```md",
        "@doe2024",
        "```",
        "",
        "    @doe2024",
        "",
        "Inline `@doe2024`, math $x = @doe2024$, and %% @doe2024 %% too.",
        "",
        "$$",
        "@doe2024",
        "$$",
        "",
        "Only @roe2025 counts.",
      ].join("\n"),
    });

    expect(await index.getCitations(draft)).toMatchObject([
      { indexedKey: KEY_B, refNumber: 1 },
    ]);
  });

  // Indented list content is no code block, an unpaired backtick opens no code
  // span, and a price pair is no math — each would swallow a real citation.
  it("keeps citekeys that only look like code or math", async () => {
    const { draft, index } = await makeHarness({
      "draft.md": [
        "- item",
        "",
        "    Indented under the list, citing @doe2024.",
        "",
        "It cost $5 and @roe2025 says $6 isn't a formula.",
        "",
        "A lone ` backtick keeps @doe2024 readable.",
      ].join("\n"),
    });

    const citations = await index.getCitations(draft);

    expect(citations).toMatchObject([
      { indexedKey: KEY_A, refNumber: 1 },
      { indexedKey: KEY_B, refNumber: 2 },
    ]);
    expect(citations[0]!.occurrences).toHaveLength(2);
  });

  it("rescans a document when its metadata changes", async () => {
    const { draft, index, metadataCache } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });
    await index.getCitations(draft);

    metadataCache.change(draft, "As @roe2025 wrote.");

    expect(await index.getCitations(draft)).toMatchObject([
      { indexedKey: KEY_B, refNumber: 1 },
    ]);
  });

  it("stays quiet when a change leaves the citekeys identical", async () => {
    const { draft, index, metadataCache } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });
    await index.getCitations(draft);
    let notified = 0;
    index.on("changed", () => notified++);

    metadataCache.change(draft, "As @doe2024 wrote.");

    expect(notified).toBe(0);
  });

  it("reports a document whose citekeys changed", async () => {
    const { draft, index, metadataCache } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });
    await index.getCitations(draft);
    const changed: string[] = [];
    index.on("changed", (path) => changed.push(path));

    metadataCache.change(draft, "As @doe2024 and @roe2025 wrote.");

    expect(changed).toEqual(["draft.md"]);
  });

  it("keeps a renamed document indexed under its new path", async () => {
    const { draft, index, vault } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });
    await index.getCitations(draft);

    vault.rename(draft, "Notes/paper.md");

    expect(await index.getCitations(draft)).toMatchObject([
      { indexedKey: KEY_A },
    ]);
    expect(vault.bodies.has("draft.md")).toBe(false);
  });

  it("drops a deleted document", async () => {
    const { draft, index, vault, workspace } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });
    workspace.layoutReady();
    await index.whenIndexed();
    const changed: string[] = [];
    index.on("changed", (path) => changed.push(path));

    vault.deleteFile(draft);

    expect(changed).toEqual(["draft.md"]);
    expect(await index.getCitations(draft)).toEqual([]);
  });

  it("answers for a document the backfill has not reached", async () => {
    const { draft, index } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });

    expect(await index.getCitations(draft)).toMatchObject([
      { indexedKey: KEY_A },
    ]);
  });

  it("covers the vault once the backfill finishes", async () => {
    const { index, metadataCache, workspace } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
      "other.md": "As @roe2025 wrote.",
    });
    let backfilled = false;
    void index.whenIndexed().then(() => (backfilled = true));

    expect(backfilled).toBe(false);
    workspace.layoutReady();
    await index.whenIndexed();

    const other = metadataCache.files.get("other.md")!;
    expect(await index.getCitations(other)).toMatchObject([
      { indexedKey: KEY_B },
    ]);
  });

  it("indexes nothing while Citekey Indexing is off", async () => {
    const { draft, index, metadataCache } = await makeHarness(
      { "draft.md": "As @doe2024 wrote, see [[Roe 2025]]." },
      { settings: { "citation.citekey-indexing": false } },
    );
    metadataCache.fileCache.set("draft.md", {
      links: [link("Roe 2025", 23)],
    } as CachedMetadata);

    expect(await index.getCitations(draft)).toMatchObject([
      { indexedKey: KEY_B, refNumber: 1 },
    ]);
  });

  it("rebuilds when Citekey Indexing is turned back on", async () => {
    const { draft, index, settings, workspace } = await makeHarness(
      { "draft.md": "As @doe2024 wrote." },
      { settings: { "citation.citekey-indexing": false } },
    );
    workspace.layoutReady();

    settings.update({ "citation.citekey-indexing": true });
    await index.whenIndexed();

    expect(await index.getCitations(draft)).toMatchObject([
      { indexedKey: KEY_A },
    ]);
  });

  it("stops indexing after disposal", async () => {
    const { draft, index, metadataCache } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });
    await index.getCitations(draft);

    await index[Symbol.asyncDispose]();
    metadataCache.change(draft, "As @roe2025 wrote.");

    expect(await index.getCitations(draft)).toMatchObject([
      { indexedKey: KEY_A },
    ]);
  });
});

interface Harness {
  draft: TFile;
  index: CitationIndex;
  metadataCache: MockMetadataCache;
  settings: SettingsStub;
  vault: MockVault;
  workspace: MockWorkspace;
}

/**
 * A vault of two Literature Notes — `doe2024` and `roe2025` — plus the passed
 * documents, none of which the index covers until an event, a query, or the
 * backfill reaches it.
 */
async function makeHarness(
  documents: Record<string, string>,
  options: { settings?: Partial<Settings> } = {},
): Promise<Harness> {
  const metadataCache = new MockMetadataCache();
  const vault = new MockVault(metadataCache);
  const workspace = new MockWorkspace();
  const noteIndex = new NoteIndexStub();

  const addFile = (path: string, body: string): TFile => {
    const file = makeFile(path);
    metadataCache.files.set(path, file);
    vault.bodies.set(path, body);
    return file;
  };
  for (const [citekey, indexedKey] of [
    ["doe2024", KEY_A],
    ["roe2025", KEY_B],
  ] as const) {
    const path = citekey === "doe2024" ? "Doe 2024.md" : "Roe 2025.md";
    const note = addFile(path, "");
    metadataCache.fileCache.set(path, {
      frontmatter: { [FIELD_ZOTERO_KEY]: indexedKey, [FIELD_CITEKEY]: citekey },
    } as CachedMetadata);
    noteIndex.notes.set(citekey, note);
  }
  for (const [path, body] of Object.entries(documents)) {
    addFile(path, body);
    metadataCache.fileCache.set(path, {
      links: [],
    } as unknown as CachedMetadata);
  }

  const app = { metadataCache, vault, workspace } as unknown as App;
  const settings = new SettingsStub(options.settings);
  const index = new CitationIndex({ app, noteIndex, settings });
  services.push(index);
  await index.ready;

  return {
    draft: metadataCache.files.get("draft.md")!,
    index,
    metadataCache,
    settings,
    vault,
    workspace,
  };
}

function link(target: string, offset: number): LinkCache {
  return {
    link: target,
    original: `[[${target}]]`,
    position: {
      start: { line: 0, col: offset, offset },
      end: {
        line: 0,
        col: offset + target.length + 4,
        offset: offset + target.length + 4,
      },
    },
  };
}

function makeFile(path: string): TFile {
  const file = new TFile();
  file.stat = { ctime: 0, mtime: 0, size: 0 };
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
