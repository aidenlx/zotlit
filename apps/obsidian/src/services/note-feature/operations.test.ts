import { TFile, TFolder } from "obsidian";
import type { FileManager } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  CollectionCache,
  fetchAnnotationsTemplateData,
  fetchNoteContext,
  getAnnotationsByItemId,
  getItemsByKey,
  itemBaseFields,
  resolveIndexedKeyLibrary,
  resolveVenue,
} from "@zotlit/db";
import type {
  BaseItem,
  Item,
  NoteResolvers,
  NoteTemplateContext,
  TemplateFilenameItemData,
  TemplateItemData,
} from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import { filenameSuffix } from "@zotlit/templates";
import defaultCite from "@zotlit/templates/defaults/cite.liquid?raw";
import { TemplateFacade } from "@zotlit/templates/facade";
import type { TemplateLanguage } from "@zotlit/templates/facade";
import { compileFrontmatterFields } from "@zotlit/templates/frontmatter";
import type { CompiledFrontmatterField } from "@zotlit/templates/frontmatter";
import { createLiquidEngine } from "@zotlit/templates/liquid";
import {
  formatManagedRegion,
  MARKER_END,
  MARKER_START,
} from "@zotlit/templates/obsidian";
import type { ItemFields } from "@zotlit/zotero-types";

import { FIELD_CITEKEY, FIELD_ZOTERO_KEY } from "@/lib/constants";
import type {
  AttachmentSource,
  SourceOrigin,
} from "@/services/attachment-import/service";
import { defaults as settingsDefaults } from "@/services/settings/schema";

import type { NoteFeatureDeps, SyncRenderDeps } from "./context";
import { createNoteFeature } from "./operations";
import type { NoteFeature, UpdateScope } from "./operations";

/** Stand-in decision port: every source blocks, so no test copies a file. */
const blockedDecide = (
  path: string,
  origin: SourceOrigin,
): AttachmentSource => ({
  approved: false,
  path,
  origin,
  reason: "no-trusted-root",
});

/** The `attachmentImport` port every note-feature test runs against. */
const blockedAttachmentImport = {
  prepare: async () => ({
    decide: blockedDecide,
    resolveLink: () => () => "",
    flush: async () => ({
      copied: 0,
      skipped: 0,
      missing: 0,
      blocked: 0,
      refused: 0,
    }),
  }),
};

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
    // The single-item create / update paths resolve the account identity from
    // the pinned client; stub it so the note-feature flow under test stays
    // DB-free.
    getZoteroIdentity: () => ({
      userID: null,
      localUserKey: null,
      username: null,
    }),
    // `fetchNoteContext` normally fetches every row from the DB; each test
    // stubs it to apply the caller's resolvers to a small fixture instead, so
    // resolver wiring (notePath / noteLink resolution) is exercised without a
    // real DB.
    fetchNoteContext: vi.fn(),
    // `overwriteNote`'s indexedKey lookup path; stubbed per-test so it doesn't
    // need a real Zotero item table.
    resolveIndexedKeyLibrary: vi.fn(),
    getItemsByKey: vi.fn(),
    // renderAnnotation's drag-insert path; stubbed per-test so the annotation
    // template data (parent item + page label) is supplied without a real DB.
    getAnnotationsByItemId: vi.fn(),
    fetchAnnotationsTemplateData: vi.fn(),
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
  // Mirrors @zotlit/db's real wiring (see TemplateItemResolvers in
  // zt-template-item.ts): resolvers get an inert twin with empty
  // notePath/noteLink stubs while the outer item exposes the live members.
  const toTemplateItem = (it: Item): TemplateItemData => {
    const fields = it.fields as unknown as Record<string, string | null>;
    const twin = {
      indexedKey: it.indexedKey,
      citationKey: fields.citationKey ?? null,
      title: fields.title ?? null,
      notePath: "",
      noteLink: () => "",
    } as TemplateFilenameItemData;
    return {
      indexedKey: it.indexedKey,
      citationKey: fields.citationKey ?? null,
      title: fields.title ?? null,
      get notePath() {
        return resolvers.item.notePath(twin);
      },
      noteLink: (alias?: string, subpath?: string) =>
        resolvers.item.noteLink(twin, alias, subpath),
    } as TemplateItemData;
  };
  return {
    ...toTemplateItem(item),
    relatedItems: relatedItems.map(toTemplateItem),
  } as unknown as NoteTemplateContext;
}

describe("createNote", () => {
  it("resolves note helpers by item key, then filename fallback", async () => {
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
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: blockedAttachmentImport,
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            indexedKey: "",
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
        "C Related:Literature/C Related.md|[[Literature/C Related.md|C Related]]",
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
        path: "Literature/C Related.md",
        sourcePath: "Literature/Root.md",
        alias: "C Related",
      },
    ]);
  });

  // Pins the parity contract: both `resolveNotePath` (creation) and
  // `resolveNoteTarget` (synthetic fallback) feed the filename template the
  // item-own shape with inert `notePath`/`noteLink` stubs; before the fix the
  // fallback fed the live item and `notePath`/`noteLink` rendered as `null`.
  it("feeds the filename template the same item-own shape in creation and synthetic fallback", async () => {
    const root = makeItem({
      itemID: 1,
      key: "ROOT1234",
      indexedKey: "ROOT1234",
      title: "Root",
      citationKey: null,
    });
    // No note in the index for this item, so both `byItemKey` and `byCitekey`
    // miss and resolution falls through to the synthetic fallback.
    const related = makeItem({
      itemID: 2,
      key: "RELFALL1",
      indexedKey: "RELFALL1",
      title: "Related",
      citationKey: null,
    });

    vi.mocked(fetchNoteContext).mockImplementation((_client, item, options) =>
      stubNoteContext(item, [related], options.resolvers),
    );

    const app = makeApp();
    const deps: SyncRenderDeps = {
      app,
      template: {
        ready: Promise.resolve(),
        loaded: true,
        frontmatterFields: [],
        renderFilename<T extends object>(data: T): string {
          const d = data as {
            title: string | null;
            notePath: string | null;
            noteLink: (alias?: string, subpath?: string) => string | null;
          };
          return `${d.title}-${d.notePath}${d.noteLink()}`;
        },
        render<T extends object>(_name: string, data: T): string {
          const ctx = data as {
            noteLink: (alias?: string) => string | null;
            relatedItems: readonly {
              noteLink: (alias?: string) => string | null;
            }[];
          };
          return `root:${ctx.noteLink()}\nrelated:${ctx.relatedItems[0]!.noteLink()}`;
        },
      },
      db: makeDb(),
      noteIndex: {
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: blockedAttachmentImport,
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            indexedKey: "",
            title: null,
            noteLink: () => "",
          }),
          flush: async () => ({ created: 0, skipped: 0, failed: 0 }),
        }),
      },
    };

    const file = await createNoteFeature(deps).createNote(root);

    // Creation path: buildFilenameContext's inert notePath/noteLink stubs
    // render as empty strings.
    expect(file.path).toBe("Literature/Root-.md");

    // Synthetic-fallback path: the related item's filename must render with
    // the same inert-stub shape, so its link target resolves to the same
    // empty-render pattern instead of a `nullnull`-suffixed name.
    expect(app.fileManager.links).toContainEqual(
      expect.objectContaining({ path: "Literature/Related-.md" }),
    );

    // The root's own note link, rendered in the body before the file exists,
    // also goes through the synthetic fallback (the note index is empty) —
    // it must resolve to the same target the creation path produced.
    expect(app.fileManager.links).toContainEqual(
      expect.objectContaining({ path: "Literature/Root-.md" }),
    );
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
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: blockedAttachmentImport,
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            indexedKey: "",
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
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: blockedAttachmentImport,
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            indexedKey: "",
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
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: blockedAttachmentImport,
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            indexedKey: "",
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
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: blockedAttachmentImport,
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            indexedKey: "",
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

/**
 * A note-update harness whose `vault.process` and `fileManager.processFrontMatter`
 * actually run their callbacks against mutable in-memory state, so a test can
 * assert on the note's rewritten body and frontmatter after an update — the seam
 * `updateNote` / `writeNoteUpdate` write through.
 */
interface UpdateHarness {
  deps: SyncRenderDeps;
  /** Note body after the update (byte-identical to what was written). */
  content: () => string;
  frontmatter: () => Record<string, unknown>;
  /** The `content`-template render stub; assert it stays unqueued when no region exists. */
  renderContent: ReturnType<typeof vi.fn>;
  processMock: ReturnType<typeof vi.fn>;
  frontmatterMock: ReturnType<typeof vi.fn>;
}

function makeUpdateHarness(options: {
  content: string;
  frontmatter?: Record<string, unknown>;
  /** What `render("content", …)` returns — already region-wrapped, as the real
   *  engine's transformRender emits. @default a fresh `NEW BODY` region */
  renderedRegion?: string;
  frontmatterFields?: readonly CompiledFrontmatterField[];
}): UpdateHarness {
  let content = options.content;
  const fm: Record<string, unknown> = { ...options.frontmatter };
  const renderContent = vi.fn(
    () => options.renderedRegion ?? formatManagedRegion("NEW BODY"),
  );
  const processMock = vi.fn(
    async (_file: TFile, cb: (data: string) => string) => {
      content = cb(content);
      return content;
    },
  );
  const frontmatterMock = vi.fn(
    async (_file: TFile, cb: (fm: Record<string, unknown>) => void) => {
      cb(fm);
    },
  );

  const template: SyncRenderDeps["template"] = {
    ready: Promise.resolve(),
    loaded: true,
    frontmatterFields: options.frontmatterFields ?? [],
    renderFilename: () => "",
    render: <T extends object>(name: string, _data: T): string =>
      name === "content" ? renderContent() : "",
  };

  const deps: SyncRenderDeps = {
    app: {
      vault: {
        getAbstractFileByPath: () => null,
        getRoot: () => new TFolder(),
        createFolder: vi.fn(),
        create: vi.fn(),
        process: processMock,
      },
      fileManager: {
        generateMarkdownLink: () => "",
        processFrontMatter: frontmatterMock,
      },
    },
    template,
    db: makeDb(),
    noteIndex: {
      ready: Promise.resolve(),
      whenIndexed: async () => {},
      getNotesByItemKey: () => [],
    },
    zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
    settings: makeSettings(),
    attachmentImport: blockedAttachmentImport,
    noteImport: {
      prepare: async () => ({
        resolveChildNote: () => ({
          key: "",
          indexedKey: "",
          title: null,
          noteLink: () => "",
        }),
        flush: async () => ({ created: 0, skipped: 0, failed: 0 }),
      }),
    },
  };

  return {
    deps,
    content: () => content,
    frontmatter: () => fm,
    renderContent,
    processMock,
    frontmatterMock,
  };
}

/** Context the (mocked) `fetchNoteContext` hands back for an update. */
function updateContext(
  overrides: Partial<NoteTemplateContext> = {},
): NoteTemplateContext {
  return {
    indexedKey: "ABC12345",
    citationKey: "smith2024",
    title: "A Study",
    relatedItems: [],
    ...overrides,
  } as unknown as NoteTemplateContext;
}

/** Point the indexedKey lookup path at a resolvable item returning `context`. */
function stubIndexedKeyUpdate(context: NoteTemplateContext): void {
  vi.mocked(resolveIndexedKeyLibrary).mockReturnValue({
    key: "ABC12345",
    libraryID: 1,
  });
  vi.mocked(getItemsByKey).mockReturnValue([
    makeItem({
      key: "ABC12345",
      indexedKey: "ABC12345",
      title: "A Study",
      citationKey: "smith2024",
    }),
  ]);
  vi.mocked(fetchNoteContext).mockReturnValue(context);
}

describe("updateNote", () => {
  it("preserves user content outside the managed region, replacing only the region body", async () => {
    const context = updateContext();
    stubIndexedKeyUpdate(context);

    const prefix = "# My reading notes\n\nSome prose I wrote above.\n\n";
    const suffix = "\n\n## My thoughts\n\nMore prose I wrote below.";
    const harness = makeUpdateHarness({
      content: `${prefix}${formatManagedRegion("OLD rendered body")}${suffix}`,
      renderedRegion: formatManagedRegion("NEW rendered body"),
    });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Literature/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(harness.content()).toBe(
      `${prefix}${formatManagedRegion("NEW rendered body")}${suffix}`,
    );
    expect(harness.content().startsWith(prefix)).toBe(true);
    expect(harness.content().endsWith(suffix)).toBe(true);
    expect(harness.content()).not.toContain("OLD rendered body");
    expect(result).toEqual({ bodyUpdated: true, duplicateRegionCount: 0 });
  });

  it("preserves CRLF user content around the region", async () => {
    const context = updateContext();
    stubIndexedKeyUpdate(context);

    const prefix = "# Title\r\n\r\nUser prose.\r\n";
    const suffix = "\r\nTrailing user prose.\r\n";
    const harness = makeUpdateHarness({
      content: `${prefix}${formatManagedRegion("OLD")}${suffix}`,
      renderedRegion: formatManagedRegion("NEW"),
    });

    await createNoteFeature(harness.deps).updateNote(
      makeFile("Literature/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(harness.content()).toBe(
      `${prefix}${formatManagedRegion("NEW")}${suffix}`,
    );
  });

  it("leaves the body untouched for scope 'metadata' while refreshing frontmatter", async () => {
    const context = updateContext();
    stubIndexedKeyUpdate(context);

    const original = `prefix\n${formatManagedRegion("OLD")}\nsuffix`;
    const harness = makeUpdateHarness({
      content: original,
      frontmatter: { status: "reading" },
    });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Literature/Root.md"),
      { indexedKey: "ABC12345", scope: "metadata" },
    );

    expect(harness.content()).toBe(original);
    expect(harness.processMock).not.toHaveBeenCalled();
    expect(harness.renderContent).not.toHaveBeenCalled();
    expect(harness.frontmatterMock).toHaveBeenCalledOnce();
    expect(harness.frontmatter()).toEqual({
      status: "reading",
      [FIELD_ZOTERO_KEY]: "ABC12345",
    });
    expect(result).toEqual({ bodyUpdated: false, duplicateRegionCount: 0 });
  });

  it("re-evaluates managed frontmatter fields and preserves unmanaged user keys", async () => {
    const context = updateContext();
    stubIndexedKeyUpdate(context);

    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: {
        status: "reading",
        [FIELD_ZOTERO_KEY]: "STALEKEY",
        title: "Old title",
      },
      frontmatterFields: compileFrontmatterFields(
        [
          {
            key: "title",
            expr: "zt.title",
            merge: "replace",
            language: "liquid",
          },
        ],
        { liquid: createLiquidEngine(), javascript: true },
      ).compiled,
    });

    await createNoteFeature(harness.deps).updateNote(
      makeFile("Literature/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(harness.frontmatter()).toEqual({
      status: "reading",
      title: "A Study",
      [FIELD_ZOTERO_KEY]: "ABC12345",
    });
  });

  it("emits frontmatter-eval-failed with the skipped keys when a field expression throws", async () => {
    const context = updateContext();
    stubIndexedKeyUpdate(context);

    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatterFields: compileFrontmatterFields(
        [
          {
            key: "broken",
            expr: "zt.title.no.such",
            merge: "replace",
            language: "javascript",
          },
        ],
        { liquid: createLiquidEngine(), javascript: true },
      ).compiled,
    });

    const feature = createNoteFeature(harness.deps);
    const events: { itemKey: string; fields: string[] }[] = [];
    feature.on("frontmatter-eval-failed", (payload) => events.push(payload));

    await feature.updateNote(makeFile("Literature/Root.md"), {
      indexedKey: "ABC12345",
    });

    expect(events).toEqual([{ itemKey: "ABC12345", fields: ["broken"] }]);
  });

  it("defers the content render and reports no update when the note has no managed region", async () => {
    const context = updateContext();
    stubIndexedKeyUpdate(context);

    const original = "# Just user content\n\nNo managed region here.";
    const harness = makeUpdateHarness({ content: original });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Literature/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(harness.content()).toBe(original);
    expect(harness.renderContent).not.toHaveBeenCalled();
    expect(harness.frontmatterMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ bodyUpdated: false, duplicateRegionCount: 0 });
  });

  it("leaves the note untouched when the markers are unbalanced (start only)", async () => {
    const context = updateContext();
    stubIndexedKeyUpdate(context);

    const original = `before\n${MARKER_START}\nOLD\nafter`;
    const harness = makeUpdateHarness({ content: original });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Literature/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(harness.content()).toBe(original);
    expect(harness.renderContent).not.toHaveBeenCalled();
    expect(result).toEqual({ bodyUpdated: false, duplicateRegionCount: 0 });
  });

  it("leaves the note untouched when the markers are unbalanced (end only)", async () => {
    const context = updateContext();
    stubIndexedKeyUpdate(context);

    const original = `before\nOLD\n${MARKER_END}\nafter`;
    const harness = makeUpdateHarness({ content: original });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Literature/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(harness.content()).toBe(original);
    expect(harness.renderContent).not.toHaveBeenCalled();
    expect(result).toEqual({ bodyUpdated: false, duplicateRegionCount: 0 });
  });

  it("replaces only the first of multiple managed regions and counts the rest", async () => {
    const context = updateContext();
    stubIndexedKeyUpdate(context);

    const region = formatManagedRegion("OLD");
    const harness = makeUpdateHarness({
      content: `${region}\nmid\n${region}\nend\n${region}`,
      renderedRegion: formatManagedRegion("NEW"),
    });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Literature/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(harness.content()).toBe(
      `${formatManagedRegion("NEW")}\nmid\n${region}\nend\n${region}`,
    );
    expect(harness.renderContent).toHaveBeenCalledOnce();
    expect(result).toEqual({ bodyUpdated: true, duplicateRegionCount: 2 });
  });

  it("preserves an unmanaged citekey field when the item has no citation key", async () => {
    const context = updateContext({ citationKey: null });
    stubIndexedKeyUpdate(context);

    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: { [FIELD_CITEKEY]: "stale2020" },
    });

    await createNoteFeature(harness.deps).updateNote(
      makeFile("Literature/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(harness.frontmatter()[FIELD_CITEKEY]).toBe("stale2020");
    expect(harness.frontmatter()[FIELD_ZOTERO_KEY]).toBe("ABC12345");
  });

  it("rejects without touching the file when the indexed key resolves to no item", async () => {
    vi.mocked(resolveIndexedKeyLibrary).mockReturnValue(null);
    const harness = makeUpdateHarness({ content: formatManagedRegion("OLD") });

    await expect(
      createNoteFeature(harness.deps).updateNote(
        makeFile("Literature/Root.md"),
        { indexedKey: "MISSING1" },
      ),
    ).rejects.toThrow("Zotero item not found: MISSING1");
    expect(harness.processMock).not.toHaveBeenCalled();
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
  });
});

describe("writeNoteUpdate", () => {
  const writeOptions = (
    scope?: UpdateScope,
  ): Parameters<NoteFeature["writeNoteUpdate"]>[1] => ({
    client: makeDb().client,
    item: makeItem({
      key: "ABC12345",
      indexedKey: "ABC12345",
      title: "A Study",
      citationKey: "smith2024",
    }),
    tagMemo: new Map(),
    collectionCache: new CollectionCache(),
    settings: { ...settingsDefaults, "note.literature-folder": "Literature" },
    scope,
    username: null,
  });

  it("replaces the region and preserves user content from the already-fetched item", async () => {
    vi.mocked(fetchNoteContext).mockReturnValue(updateContext());

    const prefix = "user prefix\n\n";
    const suffix = "\n\nuser suffix";
    const harness = makeUpdateHarness({
      content: `${prefix}${formatManagedRegion("OLD")}${suffix}`,
      renderedRegion: formatManagedRegion("NEW"),
    });

    const result = await createNoteFeature(harness.deps).writeNoteUpdate(
      makeFile("Literature/Root.md"),
      writeOptions(),
    );

    expect(harness.content()).toBe(
      `${prefix}${formatManagedRegion("NEW")}${suffix}`,
    );
    expect(result).toEqual({ bodyUpdated: true, duplicateRegionCount: 0 });
  });

  it("honors scope 'metadata' by leaving the body untouched", async () => {
    vi.mocked(fetchNoteContext).mockReturnValue(updateContext());

    const original = `prefix\n${formatManagedRegion("OLD")}\nsuffix`;
    const harness = makeUpdateHarness({ content: original });

    const result = await createNoteFeature(harness.deps).writeNoteUpdate(
      makeFile("Literature/Root.md"),
      writeOptions("metadata"),
    );

    expect(harness.content()).toBe(original);
    expect(harness.processMock).not.toHaveBeenCalled();
    expect(harness.frontmatterMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ bodyUpdated: false, duplicateRegionCount: 0 });
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
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: blockedAttachmentImport,
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            indexedKey: "",
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

  it("renders the default cite template without a trailing line break", () => {
    // A vault template file ends with a newline; inserting that into the
    // editor on confirm would add a line break after the citation.
    const result = createNoteFeature(
      annotDeps(citeTemplate(`${defaultCite}\n`)),
    ).renderCitation([{ citationKey: "smith2024" }]);

    expect(result).toBe("[@smith2024]");
  });

  it("normalizes a multi-line cite template to inline form", () => {
    // Citations are in-text tokens: line-break runs collapse to one space and
    // the ends are trimmed, whatever whitespace the template renders.
    const source =
      "[@<%= zt.citations[0].item.citationKey %>,\n   p. 1]   \n\n";
    const result = createNoteFeature(
      annotDeps(citeTemplate(source, { language: "eta" })),
    ).renderCitation([{ citationKey: "smith2024" }]);

    expect(result).toBe("[@smith2024, p. 1]");
  });

  it("carries the selected item's full narrowed data through to the cite template (9.2-CSL #03)", () => {
    // Citation-suggest passes the selected search hit's full item alongside
    // its citationKey; a data-driven (author-year) cite template should see
    // the item's title/date, not just a citekey-only stub.
    const deps: SyncRenderDeps = {
      app: makeApp(),
      template: {
        ready: Promise.resolve(),
        loaded: true,
        frontmatterFields: [],
        renderFilename: () => "",
        render: (_name, data) =>
          (
            data as { citations: { item: { title: string | null } }[] }
          ).citations
            .map((c) => c.item.title)
            .join("; "),
      },
      db: makeDb(),
      noteIndex: {
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: blockedAttachmentImport,
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            indexedKey: "",
            title: null,
            noteLink: () => "",
          }),
          flush: async () => ({ created: 0, skipped: 0, failed: 0 }),
        }),
      },
    };

    const item = makeItem({
      key: "ROOT1234",
      indexedKey: "ROOT1234",
      title: "Stated choice methods",
      citationKey: "root2024",
    });

    const result = createNoteFeature(deps).renderCitation([
      { citationKey: "root2024", item },
    ]);

    expect(result).toBe("Stated choice methods");
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
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: blockedAttachmentImport,
      noteImport: {
        prepare: async () => ({
          resolveChildNote: () => ({
            key: "",
            indexedKey: "",
            title: null,
            noteLink: () => "",
          }),
          flush: async () => ({ created: 0, skipped: 0, failed: 0 }),
        }),
      },
    };

    const result = createNoteFeature(deps).renderAnnotation(1, {
      attachmentImport: { decide: blockedDecide, resolveLink: () => () => "" },
    });

    expect(result).toBeNull();
  });
});

/** A template service backed by the real engine, with a `cite` + optional `annotation` pair. */
function citeTemplate(
  citeSource = defaultCite,
  opts?: { annotation?: string; language?: TemplateLanguage },
): SyncRenderDeps["template"] {
  const facade = new TemplateFacade();
  facade.define("cite", citeSource, opts?.language ?? "liquid");
  if (opts?.annotation !== undefined) {
    facade.define("annotation", opts.annotation, "eta");
  }
  return {
    ready: Promise.resolve(),
    loaded: true,
    frontmatterFields: [],
    renderFilename: () => "",
    render: <T extends object>(name: string, data: T): string =>
      facade.render(name, data),
  };
}

/** One annotation's template data with a parent item carrying `citekey`. */
const annData = (citekey: string | null, pageLabel: string | null) =>
  ({
    key: "ANN1",
    pageLabel,
    parentItem: citekey === null ? null : { citationKey: citekey, citekey },
  }) as never;

function annotDeps(template: SyncRenderDeps["template"]): SyncRenderDeps {
  return {
    app: makeApp(),
    template,
    db: makeDb(),
    noteIndex: {
      ready: Promise.resolve(),
      whenIndexed: async () => {},
      getNotesByItemKey: () => [],
    },
    zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
    settings: makeSettings(),
    attachmentImport: blockedAttachmentImport,
    noteImport: {
      prepare: async () => ({
        resolveChildNote: () => ({
          key: "",
          indexedKey: "",
          title: null,
          noteLink: () => "",
        }),
        flush: async () => ({ created: 0, skipped: 0, failed: 0 }),
      }),
    },
  };
}

describe("renderAnnotation — zt.citation (9.2-CSL #05)", () => {
  const render = (deps: SyncRenderDeps) =>
    createNoteFeature(deps).renderAnnotation(1, {
      attachmentImport: { decide: blockedDecide, resolveLink: () => () => "" },
    });

  it("renders a page-pinned Pandoc cite from the parent item + page label", () => {
    vi.mocked(getAnnotationsByItemId).mockReturnValue([
      { key: "ANN1" } as never,
    ]);
    vi.mocked(fetchAnnotationsTemplateData).mockReturnValue(
      new Map([["ANN1", annData("Hensher2011", "62")]]),
    );
    const result = render(
      annotDeps(
        citeTemplate(defaultCite, { annotation: "<%= zt.citation %>" }),
      ),
    );
    expect(result).toContain("[@Hensher2011, p. 62]");
  });

  it("routes the annotation citation through the user's cite template (locator = page label)", () => {
    vi.mocked(getAnnotationsByItemId).mockReturnValue([
      { key: "ANN1" } as never,
    ]);
    vi.mocked(fetchAnnotationsTemplateData).mockReturnValue(
      new Map([["ANN1", annData("Hensher2011", "62")]]),
    );
    const cite =
      "<%= zt.citations.map(c => `{{${c.item.citationKey}|${c.locator}}}`).join('') %>";
    const result = render(
      annotDeps(
        citeTemplate(cite, {
          annotation: "<%= zt.citation %>",
          language: "eta",
        }),
      ),
    );
    expect(result).toContain("{{Hensher2011|62}}");
  });

  it("leaves zt.citation null when the parent item has no citation key", () => {
    vi.mocked(getAnnotationsByItemId).mockReturnValue([
      { key: "ANN1" } as never,
    ]);
    vi.mocked(fetchAnnotationsTemplateData).mockReturnValue(
      new Map([["ANN1", annData(null, "62")]]),
    );
    const result = render(
      annotDeps(
        citeTemplate(defaultCite, {
          annotation: "<%= JSON.stringify(zt.citation) %>",
        }),
      ),
    );
    expect(result).toBe("null");
  });
});

describe("renderAnnotationCitation (9.2-CSL #06)", () => {
  const renderCite = (deps: SyncRenderDeps): string | null =>
    createNoteFeature(deps).renderAnnotationCitation(1);

  it("produces a page-pinned Pandoc cite from the parent item + page label", () => {
    // The copy-citation action resolves the annotation's parent through the DB
    // and renders it via the shared annotation-citation path (page label as
    // locator), so the string the user pastes is `[@key, p. N]`.
    vi.mocked(getAnnotationsByItemId).mockReturnValue([
      { key: "ANN1" } as never,
    ]);
    vi.mocked(fetchAnnotationsTemplateData).mockReturnValue(
      new Map([["ANN1", annData("Hensher2011", "62")]]),
    );
    expect(renderCite(annotDeps(citeTemplate()))).toContain(
      "[@Hensher2011, p. 62]",
    );
  });

  it("routes the copied citation through the user's cite template (locator = page label)", () => {
    vi.mocked(getAnnotationsByItemId).mockReturnValue([
      { key: "ANN1" } as never,
    ]);
    vi.mocked(fetchAnnotationsTemplateData).mockReturnValue(
      new Map([["ANN1", annData("Hensher2011", "62")]]),
    );
    const cite =
      "<%= zt.citations.map(c => `{{${c.item.citationKey}|${c.locator}}}`).join('') %>";
    expect(
      renderCite(annotDeps(citeTemplate(cite, { language: "eta" }))),
    ).toContain("{{Hensher2011|62}}");
  });

  it("returns null when the parent item has no citation key (so the action can notice instead of copying)", () => {
    vi.mocked(getAnnotationsByItemId).mockReturnValue([
      { key: "ANN1" } as never,
    ]);
    vi.mocked(fetchAnnotationsTemplateData).mockReturnValue(
      new Map([["ANN1", annData(null, "62")]]),
    );
    expect(renderCite(annotDeps(citeTemplate()))).toBeNull();
  });

  it("normalizes the copied citation to inline form", () => {
    // A vault cite template's trailing newline must not reach the clipboard.
    vi.mocked(getAnnotationsByItemId).mockReturnValue([
      { key: "ANN1" } as never,
    ]);
    vi.mocked(fetchAnnotationsTemplateData).mockReturnValue(
      new Map([["ANN1", annData("Hensher2011", "62")]]),
    );
    expect(renderCite(annotDeps(citeTemplate(`${defaultCite}\n`)))).toBe(
      "[@Hensher2011, p. 62]",
    );
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
  const fields = {
    itemType: "journalArticle",
    title: input.title,
    citationKey: input.citationKey,
  } as ItemFields;
  const baseFields = itemBaseFields(fields);
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
    fields,
    baseFields,
    venue: resolveVenue(baseFields),
  };
}
