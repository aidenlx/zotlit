import { type FileManager, TFile, TFolder } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  fetchNoteContext,
  getItemsByKey,
  resolveIndexedKeyLibrary,
  type BaseItem,
  type Item,
  type NoteResolvers,
  type NoteTemplateContext,
  type TemplateItemData,
} from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import { Temporal } from "@zotlit/shared/temporal";
import { filenameSuffix } from "@zotlit/templates";
import { type ItemFields } from "@zotlit/zotero-types";

import { defaults as settingsDefaults } from "@/services/settings/schema";

import { type NoteFeatureDeps, type SyncRenderDeps } from "./context";
import { createNoteFeature } from "./operations";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    // The mock DB client can't run real queries; stub the caches so the
    // note-feature flow under test stays DB-free.
    CollectionCache: class {
      byItemIDs() {
        return new Map();
      }
    },
    resolveItemTags: () => [],
    // `fetchNoteContext` normally fetches every row from the DB; each test
    // stubs it to apply the caller's resolvers to a small fixture instead, so
    // resolver wiring (notePath / noteLink resolution) is exercised without a
    // real DB.
    fetchNoteContext: vi.fn(),
    // `overwriteNote`'s indexedKey lookup path; stubbed per-test so it doesn't
    // need a real Zotero item table.
    resolveIndexedKeyLibrary: vi.fn(),
    getItemsByKey: vi.fn(),
  };
});

/**
 * Minimal `NoteTemplateContext` stand-in: applies `resolvers.item` to `item`
 * and `relatedItems` the way the real (db-package-tested) `fetchNoteContext`
 * would, so a test can assert on resolver wiring — byItemKey / byCitekey /
 * synthetic-fallback note-path resolution — without a real DB.
 */
function stubNoteContext(
  item: Item,
  relatedItems: readonly Item[],
  resolvers: NoteResolvers,
): NoteTemplateContext {
  const toTemplateItem = (it: Item) => {
    const fields = it.fields as unknown as Record<string, string | null>;
    return {
      indexedKey: it.indexedKey,
      citationKey: fields.citationKey ?? null,
      title: fields.title ?? null,
    } as TemplateItemData;
  };
  const withLinks = (tpl: TemplateItemData) => ({
    title: tpl.title,
    get notePath() {
      return resolvers.item.notePath(tpl);
    },
    noteLink: (alias?: string, subpath?: string) =>
      resolvers.item.noteLink(tpl, alias, subpath),
  });
  return {
    ...withLinks(toTemplateItem(item)),
    relatedItems: relatedItems.map((r) => withLinks(toTemplateItem(r))),
  } as unknown as NoteTemplateContext;
}

describe("createNote", () => {
  it("resolves note helpers by item key, citekey, then filename fallback", async () => {
    const root = makeItem({
      itemID: 1,
      key: "ROOT1234",
      indexedKey: "ROOT1234",
      title: "Root",
      citationKey: "root2024",
    });
    const byItemKey = makeItem({
      itemID: 2,
      key: "RELKEY01",
      indexedKey: "RELKEY01",
      title: "B Related",
      citationKey: "relkey2024",
    });
    const byCitekey = makeItem({
      itemID: 3,
      key: "RELCITE1",
      indexedKey: "RELCITE1",
      title: "C Related",
      citationKey: "relcite2024",
    });
    const fallback = makeItem({
      itemID: 4,
      key: "RELFALL1",
      indexedKey: "RELFALL1",
      title: "A Related",
      citationKey: "relfallback2024",
    });

    // Related items pre-sorted by title (A, B, C) — this test asserts on
    // notePath/noteLink resolver wiring, not title sorting (already covered
    // by @zotlit/db's zt-template-note.test.ts).
    vi.mocked(fetchNoteContext).mockImplementation((_client, item, options) =>
      stubNoteContext(
        item,
        [fallback, byItemKey, byCitekey],
        options.resolvers,
      ),
    );

    const existingByItemKey = makeFile("Notes/Existing by item.md");
    const existingByCitekey = makeFile("Notes/Existing by citekey.md");
    const app = makeApp();
    const deps: SyncRenderDeps = {
      app,
      template: makeTemplate(),
      db: makeDb(),
      noteIndex: {
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: (key) =>
          key === byItemKey.indexedKey ? [existingByItemKey] : [],
        getNotesByCitekey: (citekey) =>
          citekey === "relcite2024" ? [existingByCitekey] : [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: {
        prepare: async () => ({
          resolveLink: () => () => "",
          flush: async () => ({ copied: 0, skipped: 0, missing: 0 }),
        }),
      },
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            title: null,
            noteLink: () => "",
          }),
          flush: async () => ({ created: 0, skipped: 0, failed: 0 }),
        }),
      },
    };

    const file = await createNoteFeature(deps).createNote(root);

    expect(file.path).toBe("Literature/Root.md");
    expect(app.vault.contentByPath.get("Literature/Root.md")).toContain(
      [
        "root:Literature/Root.md|[[Literature/Root.md|Root alias]]",
        "A Related:Literature/A Related.md|[[Literature/A Related.md|A Related]]",
        "B Related:Notes/Existing by item.md|[[Notes/Existing by item.md|B Related]]",
        "C Related:Notes/Existing by citekey.md|[[Notes/Existing by citekey.md|C Related]]",
      ].join("\n"),
    );
    expect(app.fileManager.links).toEqual([
      {
        path: "Literature/Root.md",
        sourcePath: "Literature/Root.md",
        alias: "Root alias",
      },
      {
        path: "Literature/A Related.md",
        sourcePath: "Literature/Root.md",
        alias: "A Related",
      },
      {
        path: "Notes/Existing by item.md",
        sourcePath: "Literature/Root.md",
        alias: "B Related",
      },
      {
        path: "Notes/Existing by citekey.md",
        sourcePath: "Literature/Root.md",
        alias: "C Related",
      },
    ]);
  });

  it("forces a suffix and retries when create races a colliding sibling", async () => {
    const item = makeItem({
      itemID: 1,
      key: "ROOT1234",
      indexedKey: "ROOT1234",
      title: "Root",
      citationKey: null,
    });

    // `render` below ignores its context entirely, so the stub just needs to
    // avoid throwing.
    vi.mocked(fetchNoteContext).mockReturnValue({
      relatedItems: [],
    } as unknown as NoteTemplateContext);

    const literature = new TFolder();
    literature.path = "Literature";
    const root = new TFolder();
    root.path = "/";

    // A sibling already holds the base path on disk, but the path cache never
    // reflects it — the cache-lag race the suffix retry recovers from. Detection
    // rides on `create`'s rejection alone, not on a cache re-check.
    const disk = new Set(["Literature/Root.md"]);
    const create = vi.fn(async (path: string) => {
      if (disk.has(path)) throw new Error("File already exists.");
      disk.add(path);
      return makeFile(path);
    });

    const deps: SyncRenderDeps = {
      app: {
        vault: {
          getAbstractFileByPath: (path) =>
            path === "Literature" ? literature : null,
          getRoot: () => root,
          createFolder: vi.fn(),
          create,
          process: vi.fn(async () => ""),
        },
        fileManager: {
          generateMarkdownLink: () => "",
          processFrontMatter: vi.fn(async () => {}),
        },
      },
      template: {
        ready: Promise.resolve(),
        loaded: true,
        frontmatterFields: [],
        renderFilename<T extends object>(data: T): string {
          const { title, key } = data as { title: string | null; key: string };
          return `${title ?? key}${filenameSuffix()}`;
        },
        render: () => "body",
      },
      db: makeDb(),
      noteIndex: {
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
        getNotesByCitekey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: {
        prepare: async () => ({
          resolveLink: () => () => "",
          flush: async () => ({ copied: 0, skipped: 0, missing: 0 }),
        }),
      },
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            title: null,
            noteLink: () => "",
          }),
          flush: async () => ({ created: 0, skipped: 0, failed: 0 }),
        }),
      },
    };

    const file = await createNoteFeature(deps).createNote(item);

    expect(file.path).toMatch(/^Literature\/Root_[\w-]{6}\.md$/);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("awaits noteIndex.whenIndexed (not just ready) before writing the note", async () => {
    // Regression: `ready` settles once listeners are registered, before the
    // first metadataCache scan populates the index. Gating on `ready` alone
    // let a cold-start create proceed against an empty index and mint a
    // duplicate note for an item that already has one; `whenIndexed` is the
    // stronger gate that actually waits for the scan.
    const item = makeItem({
      itemID: 1,
      key: "ROOT1234",
      indexedKey: "ROOT1234",
      title: "Root",
      citationKey: null,
    });
    vi.mocked(fetchNoteContext).mockReturnValue({
      relatedItems: [],
    } as unknown as NoteTemplateContext);

    let resolveIndexed!: () => void;
    const whenIndexed = new Promise<void>((resolve) => {
      resolveIndexed = resolve;
    });
    let createCalledBeforeSignal = false;

    const app = makeApp();
    const create = app.vault.create.bind(app.vault);
    app.vault.create = vi.fn(async (path: string, content: string) => {
      createCalledBeforeSignal = true;
      return create(path, content);
    });
    const deps: SyncRenderDeps = {
      app,
      template: {
        ready: Promise.resolve(),
        loaded: true,
        frontmatterFields: [],
        renderFilename: () => "Root",
        render: () => "body",
      },
      db: makeDb(),
      noteIndex: {
        ready: Promise.resolve(),
        whenIndexed: () => whenIndexed,
        getNotesByItemKey: () => [],
        getNotesByCitekey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: {
        prepare: async () => ({
          resolveLink: () => () => "",
          flush: async () => ({ copied: 0, skipped: 0, missing: 0 }),
        }),
      },
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            title: null,
            noteLink: () => "",
          }),
          flush: async () => ({ created: 0, skipped: 0, failed: 0 }),
        }),
      },
    };

    const createPromise = createNoteFeature(deps).createNote(item);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(createCalledBeforeSignal).toBe(false);

    resolveIndexed();
    await createPromise;
    expect(createCalledBeforeSignal).toBe(true);
  });

  it("awaits template.ready before writing the note", async () => {
    // Regression #10: createNote's readiness gate omitted `ctx.template.ready`
    // (only `settings.loaded` + `noteIndex.whenIndexed`), so a protocol-driven
    // create during cold launch could reach `resolveNotePath -> renderFilename`
    // before TemplateService finished loading and throw "service is not
    // ready" instead of creating the note.
    const item = makeItem({
      itemID: 1,
      key: "ROOT1234",
      indexedKey: "ROOT1234",
      title: "Root",
      citationKey: null,
    });
    vi.mocked(fetchNoteContext).mockReturnValue({
      relatedItems: [],
    } as unknown as NoteTemplateContext);

    let resolveReady!: () => void;
    const templateReady = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    let renderFilenameCalledBeforeSignal = false;

    const app = makeApp();
    const deps: SyncRenderDeps = {
      app,
      template: {
        ready: templateReady,
        loaded: true,
        frontmatterFields: [],
        renderFilename: () => {
          renderFilenameCalledBeforeSignal = true;
          return "Root";
        },
        render: () => "body",
      },
      db: makeDb(),
      noteIndex: {
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
        getNotesByCitekey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: {
        prepare: async () => ({
          resolveLink: () => () => "",
          flush: async () => ({ copied: 0, skipped: 0, missing: 0 }),
        }),
      },
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            title: null,
            noteLink: () => "",
          }),
          flush: async () => ({ created: 0, skipped: 0, failed: 0 }),
        }),
      },
    };

    const createPromise = createNoteFeature(deps).createNote(item);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(renderFilenameCalledBeforeSignal).toBe(false);

    resolveReady();
    const file = await createPromise;
    expect(renderFilenameCalledBeforeSignal).toBe(true);
    expect(file.path).toBe("Literature/Root.md");
  });
});

describe("overwriteNote", () => {
  it("preserves a CRLF frontmatter block instead of dropping it", async () => {
    // Obsidian's `processFrontMatter` preserves a note's original `---`
    // delimiter bytes, so a CRLF-authored note still has `\r\n` delimiters
    // after `refreshFrontmatter` runs. Regression for FRONTMATTER_BLOCK
    // requiring a bare `\n`, which made this prefix match fail and silently
    // dropped the frontmatter on overwrite.
    const item = makeItem({
      itemID: 1,
      key: "ROOT1234",
      indexedKey: "ROOT1234",
      title: "Root",
      citationKey: null,
    });
    vi.mocked(resolveIndexedKeyLibrary).mockReturnValue({
      key: item.key,
      libraryID: item.libraryID,
    });
    vi.mocked(getItemsByKey).mockReturnValue([item]);
    vi.mocked(fetchNoteContext).mockReturnValue({
      relatedItems: [],
    } as unknown as NoteTemplateContext);

    const file = makeFile("Literature/Root.md");
    const originalContent =
      "---\r\nzotero-key: ROOT1234\r\n---\r\nOld body content";
    let processedContent: string | undefined;

    const deps: SyncRenderDeps = {
      app: {
        vault: {
          getAbstractFileByPath: () => null,
          getRoot: () => new TFolder(),
          createFolder: vi.fn(),
          create: vi.fn(),
          process: vi.fn(async (_file: TFile, cb: (data: string) => string) => {
            processedContent = cb(originalContent);
            return processedContent;
          }),
        },
        fileManager: {
          generateMarkdownLink: () => "",
          processFrontMatter: vi.fn(async (_file, cb) => {
            cb({});
          }),
        },
      },
      template: {
        ready: Promise.resolve(),
        loaded: true,
        frontmatterFields: [],
        renderFilename: () => "",
        render: () => "New body content",
      },
      db: makeDb(),
      noteIndex: {
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
        getNotesByCitekey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: {
        prepare: async () => ({
          resolveLink: () => () => "",
          flush: async () => ({ copied: 0, skipped: 0, missing: 0 }),
        }),
      },
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            title: null,
            noteLink: () => "",
          }),
          flush: async () => ({ created: 0, skipped: 0, failed: 0 }),
        }),
      },
    };

    await createNoteFeature(deps).overwriteNote(file, item.indexedKey);

    expect(processedContent).toBe(
      "---\r\nzotero-key: ROOT1234\r\n---\r\nNew body content",
    );
  });
});

describe("renderCitation", () => {
  it("returns null instead of throwing when the template isn't loaded yet", () => {
    // renderCitation runs inside selectSuggestion/onChooseSuggestion, which
    // can't await `template.ready`; guard on the sync `loaded` flag so a
    // cold-start citation insert returns null instead of throwing
    // TemplateService's "service is not ready" through the handler.
    const render = vi.fn();
    const deps: SyncRenderDeps = {
      app: makeApp(),
      template: {
        ready: Promise.resolve(),
        loaded: false,
        frontmatterFields: [],
        renderFilename: () => "",
        render,
      },
      db: makeDb(),
      noteIndex: {
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
        getNotesByCitekey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: {
        prepare: async () => ({
          resolveLink: () => () => "",
          flush: async () => ({ copied: 0, skipped: 0, missing: 0 }),
        }),
      },
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            title: null,
            noteLink: () => "",
          }),
          flush: async () => ({ created: 0, skipped: 0, failed: 0 }),
        }),
      },
    };

    const result = createNoteFeature(deps).renderCitation([
      { citationKey: "root2024" },
    ]);

    expect(result).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });
});

describe("renderAnnotation", () => {
  it("returns null instead of throwing when the template isn't loaded yet", () => {
    // renderAnnotation runs inside the annot-view's dragstart handler, which
    // can't await `template.ready`; drag-insert.ts already falls back to
    // plain text when this returns null.
    const deps: SyncRenderDeps = {
      app: makeApp(),
      template: {
        ready: Promise.resolve(),
        loaded: false,
        frontmatterFields: [],
        renderFilename: () => "",
        render: vi.fn(),
      },
      db: makeDb(),
      noteIndex: {
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
        getNotesByCitekey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: {
        prepare: async () => ({
          resolveLink: () => () => "",
          flush: async () => ({ copied: 0, skipped: 0, missing: 0 }),
        }),
      },
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            title: null,
            noteLink: () => "",
          }),
          flush: async () => ({ created: 0, skipped: 0, failed: 0 }),
        }),
      },
    };

    const result = createNoteFeature(deps).renderAnnotation(1, {
      attachmentImport: { resolveLink: () => () => "" },
    });

    expect(result).toBeNull();
  });
});

// `render` / `renderFilename` are generic (`<T extends object>`) on the real
// service, so the mocks mirror that signature and narrow the erased payload to
// the fixture shape they assert on — the only casts the stub needs.
type RenderNoteData = {
  title: string | null;
  relatedItems: readonly {
    title: string | null;
    notePath: string;
    noteLink(alias?: string): string;
  }[];
  notePath: string;
  noteLink(alias?: string): string;
};

function makeTemplate() {
  return {
    ready: Promise.resolve(),
    loaded: true,
    frontmatterFields: [],
    renderFilename<T extends object>(data: T): string {
      const { title, key } = data as { title: string | null; key: string };
      return title ?? key;
    },
    render<T extends object>(_name: string, data: T): string {
      const ctx = data as RenderNoteData;
      return [
        `root:${ctx.notePath}|${ctx.noteLink("Root alias")}`,
        ...ctx.relatedItems.map(
          (item) =>
            `${item.title}:${item.notePath}|${item.noteLink(item.title ?? undefined)}`,
        ),
      ].join("\n");
    },
  };
}

function makeDb(): SyncRenderDeps["db"] {
  const client = createClient(":memory:");
  return {
    state: "ready",
    client,
    acquireRead: async () => ({
      client,
      [Symbol.dispose]() {},
    }),
  };
}

function makeSettings(): NoteFeatureDeps["settings"] {
  return {
    loaded: Promise.resolve({
      ...settingsDefaults,
      "note.literature-folder": "Literature",
    }),
  };
}

interface MockNoteApp {
  vault: {
    contentByPath: Map<string, string>;
    getAbstractFileByPath(path: string): TFolder | null;
    getRoot(): TFolder;
    createFolder(path: string): Promise<TFolder>;
    create(path: string, content: string): Promise<TFile>;
    process(): Promise<string>;
  };
  fileManager: {
    links: { path: string; sourcePath: string; alias: string | undefined }[];
    generateMarkdownLink: FileManager["generateMarkdownLink"];
    processFrontMatter(): Promise<void>;
  };
}

function makeApp(): MockNoteApp {
  const root = new TFolder();
  root.path = "/";
  const literature = new TFolder();
  literature.path = "Literature";
  const contentByPath = new Map<string, string>();
  const links: {
    path: string;
    sourcePath: string;
    alias: string | undefined;
  }[] = [];

  return {
    vault: {
      contentByPath,
      getAbstractFileByPath: (path: string) =>
        path === "Literature" ? literature : null,
      getRoot: () => root,
      createFolder: vi.fn(),
      create: vi.fn(async (path: string, content: string) => {
        contentByPath.set(path, content);
        return makeFile(path);
      }),
      process: vi.fn(async () => ""),
    },
    fileManager: {
      links,
      // oxlint-disable-next-line max-params
      generateMarkdownLink(
        file: TFile,
        sourcePath: string,
        subpath?: string,
        alias?: string,
      ): string {
        links.push({ path: file.path, sourcePath, alias });
        return alias ? `[[${file.path}|${alias}]]` : `[[${file.path}]]`;
      },
      processFrontMatter: vi.fn(async () => {}),
    },
  };
}

function makeFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path.split("/").at(-1) ?? path;
  file.basename = file.name.replace(/\.md$/, "");
  file.extension = "md";
  return file;
}

function makeItem(
  input: Partial<BaseItem> & {
    key: string;
    indexedKey: string;
    title: string;
    citationKey: string | null;
  },
): Item {
  return {
    itemID: input.itemID ?? 1,
    libraryID: input.libraryID ?? 1,
    key: input.key,
    indexedKey: input.indexedKey,
    dateAdded: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    creators: [],
    primaryCreatorType: "author",
    customFields: new Map(),
    groupID: null,
    fields: {
      itemType: "journalArticle",
      title: input.title,
      citationKey: input.citationKey,
    } as ItemFields,
  };
}
