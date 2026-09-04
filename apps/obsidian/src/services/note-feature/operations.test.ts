import { TFile, TFolder } from "obsidian";
import type { FileManager } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import {
  CollectionCache,
  fetchAnnotationsTemplateData,
  fetchNoteContext,
  getAnnotationsByItemId,
  getChildNotesByParentIDs,
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
import type {
  CompiledFrontmatterField,
  CompiledManagedFrontmatter,
} from "@zotlit/templates/frontmatter";
import { createLiquidEngine } from "@zotlit/templates/liquid";
import {
  formatManagedRegion,
  MARKER_END,
  MARKER_START,
} from "@zotlit/templates/obsidian";
import type { ItemFields } from "@zotlit/zotero-types";

import {
  FIELD_CITATION_STYLE,
  FIELD_CITEKEY,
  FIELD_LITERATURE_NOTE_PROFILE,
  FIELD_ZOTERO_KEY,
} from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import type { ProfileId } from "@/lib/profile-stamp";
import type {
  AttachmentSource,
  SourceOrigin,
} from "@/services/attachment-import/service";
import type { ProfileFixtureSettings as Settings } from "@/services/profile/__fixtures__/reader";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/profile/bindings";
import { defaults as settingsDefaults } from "@/services/settings/schema";
import { ProfileAnnotationError } from "@/services/template/service";
import type { ResolvedLiteratureNoteTemplate } from "@/services/template/service";

import type {
  NoteFeatureDeps,
  SyncRenderDeps as RuntimeSyncRenderDeps,
} from "./context";
type SyncRenderDeps = Omit<RuntimeSyncRenderDeps, "profile"> &
  Partial<Pick<RuntimeSyncRenderDeps, "profile">>;
import { createNoteFeature as createFeature } from "./operations";
function createNoteFeature(deps: SyncRenderDeps) {
  return createFeature({
    ...deps,
    profile:
      deps.profile ??
      profileReader(
        () => deps.settings.current ?? settingsDefaults,
        deps.app.metadataCache,
      ),
  });
}
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
    getChildNotesByParentIDs: vi.fn(),
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

describe("Companion note target", () => {
  it.each([undefined, "default"] as const)(
    "opens an existing unknown stamp with recovery data for URL Profile %s",
    async (profile) => {
      const harness = makeUpdateHarness({
        content: "Unchanged",
        frontmatter: { "zotlit-profile": "Missing (Rz9Wm4YfH6Kd)" },
      });
      const file = makeFile("Paper.md");
      harness.deps.noteIndex.getNotesByItemKey = () => [file];
      await expect(
        createNoteFeature(harness.deps).resolveCompanionNote("ABC12345", {
          profile,
        }),
      ).resolves.toMatchObject({
        outcome: "existing",
        files: [file],
        diagnostic: {
          code: "unknown-literature-note-profile",
          stamp: "Missing (Rz9Wm4YfH6Kd)",
          path: "Paper.md",
          recovery: { action: "switch-profile" },
        },
      });
    },
  );

  it("returns a matching or unqualified existing note without a kept-Profile notice", async () => {
    const books = "Bk3Qn7XvT2Lp" as ProfileId;
    const harness = makeUpdateHarness({
      content: "Unchanged",
      frontmatter: { "zotlit-profile": `Books (${books})` },
      settings: { profiles: [{ id: books, label: "Books" }] },
    });
    const file = makeFile("Books/Paper.md");
    const duplicate = makeFile("Other/Paper.md");
    harness.deps.noteIndex.getNotesByItemKey = () => [file, duplicate];
    const feature = createNoteFeature(harness.deps);
    for (const profile of [undefined, books]) {
      await expect(
        feature.resolveCompanionNote("ABC12345", { profile }),
      ).resolves.toEqual({
        outcome: "existing",
        files: [file, duplicate],
        keptProfile: undefined,
      });
    }
  });

  it("offers creation only when there is no existing note and the requested Profile resolves", async () => {
    const { deps } = makeUpdateHarness({ content: "" });
    await expect(
      createNoteFeature(deps).resolveCompanionNote("ABC12345", {
        profile: "default",
      }),
    ).resolves.toEqual({ outcome: "create" });
  });

  it.each([false, true])(
    "refuses an unknown URL Profile before fallback, including a matching stamp (existing: %s)",
    async (existing) => {
      const missing = "Rz9Wm4YfH6Kd" as ProfileId;
      const harness = makeUpdateHarness({
        content: "Unchanged",
        frontmatter: { "zotlit-profile": `Missing (${missing})` },
      });
      harness.deps.noteIndex.getNotesByItemKey = () =>
        existing ? [makeFile("Paper.md")] : [];
      await expect(
        createNoteFeature(harness.deps).resolveCompanionNote("ABC12345", {
          profile: missing,
        }),
      ).resolves.toMatchObject({
        outcome: "refused",
        diagnostic: {
          code: "unknown-literature-note-profile",
          stamp: missing,
          indexedKey: "ABC12345",
        },
      });
      expect(harness.processMock).not.toHaveBeenCalled();
      expect(harness.frontmatterMock).not.toHaveBeenCalled();
    },
  );

  it("keeps the stamped Profile and returns the existing note for a conflicting link", async () => {
    const books = "Bk3Qn7XvT2Lp" as ProfileId;
    const papers = "Rz9Wm4YfH6Kd" as ProfileId;
    const harness = makeUpdateHarness({
      content: "An unchanged note",
      frontmatter: { "zotlit-profile": `Old name (${books})` },
      settings: {
        profiles: [
          { id: books, label: "Books" },
          { id: papers, label: "Papers" },
        ],
      },
    });
    const file = makeFile("Books/Paper.md");
    harness.deps.noteIndex.getNotesByItemKey = () => [file];
    const feature = createNoteFeature(harness.deps);

    await expect(
      feature.resolveCompanionNote("ABC12345", { profile: papers }),
    ).resolves.toEqual({
      outcome: "existing",
      files: [file],
      keptProfile: { selector: books, label: "Books" },
    });
    expect(harness.processMock).not.toHaveBeenCalled();
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
  });
});

describe("Profile source selection", () => {
  it("reserves batch filename suffixes before creation so two rows have distinct exact paths", async () => {
    const id = "Bk3Qn7XvT2Lp" as ProfileId;
    const { deps } = makeUpdateHarness({
      content: "",
      settings: {
        profiles: [
          {
            id,
            label: "Reading",
            document: "reading.md",
            bindings: { "note.literature-folder": "Reading" },
          },
        ],
      },
    });
    const app = makeApp();
    deps.app = app;
    deps.template = {
      ...makeTemplate(),
      getLiteratureNoteTemplate: () =>
        makeDocumentTemplate({
          filename: `Paper${filenameSuffix()}`,
          createBody: "Body",
        }),
    };
    stubIndexedKeyUpdate(updateContext());
    const feature = createNoteFeature(deps);
    const plans = await feature.prepareBatchCreationProfiles([
      makeItem({
        itemID: 1,
        key: "ABCD2345",
        indexedKey: "ABCD2345",
        title: "One",
        citationKey: null,
      }),
      makeItem({
        itemID: 2,
        key: "EFGH6789",
        indexedKey: "EFGH6789",
        title: "Two",
        citationKey: null,
      }),
    ]);
    const first = plans.get(1)!.find((plan) => plan.selector === id)!;
    const second = plans.get(2)!.find((plan) => plan.selector === id)!;
    expect(first.path).toBe("Reading/Paper.md");
    expect(second.path).not.toBe(first.path);
    expect(app.vault.create).not.toHaveBeenCalled();
    expect(createdFile(await first.create()).path).toBe(first.path);
    expect(createdFile(await second.create()).path).toBe(second.path);
  });

  it("previews the draft stamp and document Properties, then creates at the same suffixed path", async () => {
    const id = "Bk3Qn7XvT2Lp" as ProfileId;
    const { deps } = makeUpdateHarness({
      content: "",
      settings: {
        profiles: [
          {
            id,
            label: "Reading",
            document: "reading.md",
            bindings: { "note.literature-folder": "Reading" },
          },
        ],
      },
    });
    const app = makeApp();
    deps.app = app;
    const document = makeDocumentTemplate({
      filename: `Paper${filenameSuffix()}`,
      createBody: "# A Study",
      frontmatter: compileDocumentFrontmatter([
        { key: "topic", merge: "replace", value: "Research" },
      ]),
    });
    deps.template = {
      ...makeTemplate(),
      getLiteratureNoteTemplate: () => document,
    };
    stubIndexedKeyUpdate(updateContext());
    await app.vault.create("Reading/Paper.md", "Occupied");
    const feature = createNoteFeature(deps);
    const preview = feature.prepareProfileNote({
      profile: profileReader(deps.settings.current!).resolveProfile(id)!,
      document,
      note: updateContext(),
      filename: {},
    });
    expect(preview.path).not.toBe("Reading/Paper.md");
    expect(preview.properties).toEqual({
      "zotero-key": "ABC12345",
      "zotlit-profile": "Reading (Bk3Qn7XvT2Lp)",
      topic: "Research",
    });
    expect(preview.body).toBe("# A Study");
    expect(app.vault.create).toHaveBeenCalledTimes(1);
    const file = createdFile(await preview.create());
    expect(file.path).toBe(preview.path);
    expect(app.vault.contentByPath.get("Reading/Paper.md")).toBe("Occupied");
  });

  it("keeps the preview's random suffix and retries safely if another file takes that path", async () => {
    const { deps } = makeUpdateHarness({ content: "" });
    const app = makeApp();
    const write = app.vault.create.getMockImplementation()!;
    app.vault.create.mockImplementation(async (path, content) => {
      if (app.vault.getAbstractFileByPath(path))
        throw new Error("File already exists.");
      return write(path, content);
    });
    deps.app = app;
    deps.template = {
      ...makeTemplate(),
      renderFilename: () => `Root${filenameSuffix()}`,
    };
    vi.mocked(fetchNoteContext).mockImplementation(
      (_client, current, options) =>
        stubNoteContext(current, [], options!.resolvers),
    );
    await app.vault.create("Literature/Root.md", "Occupied");
    const feature = createNoteFeature(deps);
    const [preview] =
      await feature.prepareCreationProfiles(makeCreateGateItem());
    expect(preview!.path).not.toBe("Literature/Root.md");
    const created = createdFile(await preview!.create());
    expect(created.path).toBe(preview!.path);
    expect(app.vault.contentByPath.get("Literature/Root.md")).toBe("Occupied");

    const otherItem = { ...makeCreateGateItem(), indexedKey: "PAPER234" };
    const [second] = await feature.prepareCreationProfiles(otherItem);
    await app.vault.create(second!.path!, "Arrived after preview");
    const otherCreated = createdFile(await second!.create());
    expect(otherCreated.path).not.toBe(second!.path);
    expect(app.vault.contentByPath.get(second!.path!)).toBe(
      "Arrived after preview",
    );
  });

  it("keeps usable Profiles available when another Profile's filename cannot render", async () => {
    const books = "Bk3Qn7XvT2Lp" as ProfileId;
    const { deps } = makeUpdateHarness({
      content: "",
      settings: {
        profiles: [{ id: books, label: "Books", document: "books.md" }],
      },
    });
    deps.template = {
      ...makeTemplate(),
      getLiteratureNoteTemplate: () => makeDocumentTemplate({ filename: "" }),
    };
    const profiles =
      await createNoteFeature(deps).prepareCreationProfiles(
        makeCreateGateItem(),
      );
    expect(profiles).toMatchObject([
      { selector: "default", path: "Literature/Root.md" },
      {
        selector: books,
        path: undefined,
        unavailable: m.notice_empty_filename(),
      },
    ]);
  });
  it("prepares each Profile's effective folder and filename and creates at the displayed path", async () => {
    const books = "Bk3Qn7XvT2Lp" as ProfileId;
    const item = makeCreateGateItem();
    const { deps } = makeUpdateHarness({
      content: "",
      settings: {
        profiles: [
          {
            id: books,
            label: "Books",
            document: "books.md",
            bindings: {
              "note.literature-folder": "Reading",
              "citation.references-style": "apa",
            },
          },
        ],
      },
    });
    deps.app = makeApp();
    const document = makeDocumentTemplate({ filename: "Shelf/Root" });
    deps.template = {
      ...makeTemplate(),
      getLiteratureNoteTemplate: (reference) =>
        reference === "books.md" ? document : undefined,
    };
    vi.mocked(fetchNoteContext).mockImplementation(
      (_client, current, options) =>
        stubNoteContext(current, [], options!.resolvers),
    );
    const feature = createNoteFeature(deps);
    const profiles = await feature.prepareCreationProfiles(item);
    expect(
      profiles.map(({ selector, folder, citationStyle, document, path }) => ({
        selector,
        folder,
        citationStyle,
        document,
        path,
      })),
    ).toEqual([
      {
        selector: "default",
        folder: "Literature",
        citationStyle: null,
        document: undefined,
        path: "Literature/Root.md",
      },
      {
        selector: books,
        folder: "Reading",
        citationStyle: "apa",
        document: "books.md",
        path: "Reading/Shelf/Root.md",
      },
    ]);
    const result = await profiles[1]!.create();
    expect(result).toMatchObject({
      outcome: "created",
      file: { path: "Reading/Shelf/Root.md" },
    });
    expect(deps.settings.current!["note.last-used-profile"]).toBe(books);
    expect(await profiles[1]!.create()).toMatchObject({
      outcome: "refused",
      diagnostic: { code: "literature-note-exists" },
    });
  });
  it("preselects headless before last-used and lets an asked choice override both", async () => {
    const books = "Bk3Qn7XvT2Lp" as ProfileId;
    const papers = "Rz9Wm4YfH6Kd" as ProfileId;
    const { deps } = makeUpdateHarness({
      content: "",
      settings: {
        "note.last-used-profile": books,
        profiles: [
          { id: books, label: "Books" },
          { id: papers, label: "Papers" },
        ],
      },
    });
    const feature = createNoteFeature(deps);
    expect(await feature.resolveCreationProfile()).toEqual({
      selector: books,
      source: "last-used",
      shouldAsk: true,
    });
    expect(await feature.resolveCreationProfile({ headless: papers })).toEqual({
      selector: papers,
      source: "headless",
      shouldAsk: true,
    });
    expect(
      await feature.resolveCreationProfile({
        headless: papers,
        asked: "default",
      }),
    ).toEqual({ selector: "default", source: "asked", shouldAsk: true });
    deps.settings.update({ "note.last-used-profile": null });
    expect(
      await feature.resolveCreationProfile({
        headless: "Missing12345" as ProfileId,
      }),
    ).toEqual({ selector: "default", source: "bound", shouldAsk: true });
  });
  it("uses Default without a picker when no added Profile resolves, and clears stale memory", async () => {
    const { deps } = makeUpdateHarness({
      content: "",
      settings: { "note.last-used-profile": "Bk3Qn7XvT2Lp" as ProfileId },
    });
    expect(
      await createNoteFeature(deps).resolveCreationProfile({
        headless: "Rz9Wm4YfH6Kd" as ProfileId,
      }),
    ).toEqual({ selector: "default", source: "bound", shouldAsk: false });
    expect(deps.settings.current!["note.last-used-profile"]).toBeNull();
  });
});

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
        getImportedNoteByNoteKey: () => [],
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

    const file = createdFile(await createNoteFeature(deps).createNote(root));

    expect(file.path).toBe("Literature/Root.md");
    expect(deps.settings.current!["note.last-used-profile"]).toBe("default");
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
        getLiteratureNoteTemplate: () => undefined,
        renderProfileAnnotation: () => "",
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
        getImportedNoteByNoteKey: () => [],
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

    const file = createdFile(await createNoteFeature(deps).createNote(root));

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

  it("preserves suffix retries for a Profile document filename", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
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
        metadataCache: { getFileCache: () => null },
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
          renameFile: vi.fn(),
        },
      },
      template: {
        ...makeTemplate(),
        getLiteratureNoteTemplate: () =>
          makeDocumentTemplate({ filename: `Root${filenameSuffix()}` }),
      },
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings({
        profiles: [
          {
            id: profileId,
            label: "Books",
            document: "books.md",
          },
        ],
      }),
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

    const file = createdFile(
      await createNoteFeature(deps).createNote(item, { profile: profileId }),
    );

    expect(file.path).toMatch(/^Literature\/Root_[\w-]{6}\.md$/);
    expect(deps.settings.current!["note.last-used-profile"]).toBe(profileId);
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
    const create = app.vault.create;
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
        getLiteratureNoteTemplate: () => undefined,
        renderProfileAnnotation: () => "",
        renderFilename: () => "Root",
        render: () => "body",
      },
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
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

  it("refuses creation after the index settles when the item already has a literature note", async () => {
    const item = { indexedKey: "ROOT1234" } as Item;
    const existing = makeFile("Literature/Existing.md");
    const app = makeApp();
    let indexed = false;
    const deps: SyncRenderDeps = {
      app,
      template: makeTemplate(),
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
        ready: Promise.resolve(),
        whenIndexed: async () => {
          indexed = true;
        },
        getNotesByItemKey: (indexedKey) => {
          expect(indexed).toBe(true);
          return indexedKey === item.indexedKey ? [existing] : [];
        },
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
    const create = app.vault.create;

    deps.settings.update({
      "note.last-used-profile": "Bk3Qn7XvT2Lp" as ProfileId,
    });
    const result = await createNoteFeature(deps).createNote(item);

    expect(result).toEqual({
      outcome: "refused",
      diagnostic: {
        code: "literature-note-exists",
        hint: "Open the existing Literature Note instead of creating another.",
        indexedKey: "ROOT1234",
        paths: ["Literature/Existing.md"],
      },
    });
    expect(create).not.toHaveBeenCalled();
    expect(deps.settings.current!["note.last-used-profile"]).toBe(
      "Bk3Qn7XvT2Lp",
    );
  });

  it("returns a diagnostic that lists every duplicate literature note", async () => {
    const item = { indexedKey: "ROOT1234" } as Item;
    const app = makeApp();
    const deps: SyncRenderDeps = {
      app,
      template: makeTemplate(),
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [
          makeFile("Literature/Newer.md"),
          makeFile("Archive/Older.md"),
        ],
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
    const create = app.vault.create;

    const result = await createNoteFeature(deps).createNote(item);

    expect(result).toEqual({
      outcome: "refused",
      diagnostic: {
        code: "duplicate-literature-notes",
        hint: "Resolve the duplicate Literature Notes, then run create again.",
        indexedKey: "ROOT1234",
        paths: ["Literature/Newer.md", "Archive/Older.md"],
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("serializes concurrent creates and refuses the second result", async () => {
    const item = makeCreateGateItem();
    vi.mocked(fetchNoteContext).mockReturnValue(createGateContext());
    const app = makeApp();
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const create = app.vault.create;
    const gatedCreate = vi.fn(async (path, content) => {
      await createGate;
      return create(path, content);
    });
    app.vault.create = gatedCreate;
    const feature = createNoteFeature({
      app,
      template: makeTemplate(),
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
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
    });

    const first = feature.createNote(item);
    const second = feature.createNote(item);
    releaseCreate();

    const [created, refused] = await Promise.all([first, second]);
    expect(created.outcome).toBe("created");
    expect(refused).toEqual({
      outcome: "refused",
      diagnostic: {
        code: "literature-note-exists",
        hint: "Open the existing Literature Note instead of creating another.",
        indexedKey: "ROOT1234",
        paths: ["Literature/Root.md"],
      },
    });
    expect(gatedCreate).toHaveBeenCalledOnce();
  });

  it("refuses an immediate repeat before the Note Index observes the created file", async () => {
    const item = makeCreateGateItem();
    vi.mocked(fetchNoteContext).mockReturnValue(createGateContext());
    const app = makeApp();
    const create = app.vault.create;
    const feature = createNoteFeature({
      app,
      template: makeTemplate(),
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
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
    });

    const created = await feature.createNote(item);
    const refused = await feature.createNote(item);

    expect(created.outcome).toBe("created");
    expect(refused.outcome).toBe("refused");
    expect(create).toHaveBeenCalledOnce();
  });

  it("allows recreation after the created file loses its Zotero key", async () => {
    const item = makeCreateGateItem();
    vi.mocked(fetchNoteContext).mockReturnValue(createGateContext());
    const app = makeApp();
    const feature = createNoteFeature({
      app,
      template: makeTemplate(),
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
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
    });

    const first = await feature.createNote(item);
    vi.mocked(app.metadataCache.getFileCache).mockReturnValue({
      frontmatter: {},
    });
    const second = await feature.createNote(item);

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("created");
    expect(app.vault.create).toHaveBeenCalledTimes(2);
  });

  it("refuses a retry when post-create import flushing fails", async () => {
    const item = makeCreateGateItem();
    vi.mocked(fetchNoteContext).mockReturnValue(createGateContext());
    const app = makeApp();
    const template = makeTemplate();
    template.renderFilename = () => `Root${filenameSuffix()}`;
    const feature = createNoteFeature({
      app,
      template,
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings(),
      attachmentImport: {
        prepare: async () => ({
          decide: blockedDecide,
          resolveLink: () => () => "",
          flush: async () => {
            throw new Error("File already exists.");
          },
        }),
      },
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
    });

    await expect(feature.createNote(item)).rejects.toThrow(
      "File already exists.",
    );
    const retry = await feature.createNote(item);

    expect(retry.outcome).toBe("refused");
    expect(app.vault.create).toHaveBeenCalledOnce();
  });

  it.each(["template", "profile"] as const)(
    "awaits %s.ready before writing the note",
    async (service) => {
      // Protocol-driven creation waits for both document compilation and Profile discovery.
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
        profile: {
          ...profileReader(makeSettings().current!),
          ready: service === "profile" ? templateReady : Promise.resolve(),
        },
        template: {
          ready: service === "template" ? templateReady : Promise.resolve(),
          loaded: true,
          frontmatterFields: [],
          getLiteratureNoteTemplate: () => undefined,
          renderProfileAnnotation: () => "",
          renderFilename: () => {
            renderFilenameCalledBeforeSignal = true;
            return "Root";
          },
          render: () => "body",
        },
        db: makeDb(),
        noteIndex: {
          getImportedNoteByNoteKey: () => [],
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
      const file = createdFile(await createPromise);
      expect(renderFilenameCalledBeforeSignal).toBe(true);
      expect(file.path).toBe("Literature/Root.md");
    },
  );

  it("creates under an explicit Profile with its folder, stamp, and citation style", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    const item = makeItem({
      key: "ROOT1234",
      indexedKey: "ROOT1234",
      title: "Root",
      citationKey: "root2024",
    });
    vi.mocked(fetchNoteContext).mockReturnValue(createGateContext());
    const app = makeApp();
    const deps: SyncRenderDeps = {
      app,
      template: makeTemplate(),
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings({
        profiles: [
          {
            id: profileId,
            label: "Books",
            bindings: {
              "note.literature-folder": "Books",
              "citation.references-style": "apa",
            },
          },
        ],
      }),
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

    const file = createdFile(
      await createNoteFeature(deps).createNote(item, { profile: profileId }),
    );

    expect(file.path).toBe("Books/Root.md");
    expect(app.vault.contentByPath.get(file.path)).toContain(
      `${FIELD_LITERATURE_NOTE_PROFILE}: Books (Bk3Qn7XvT2Lp)`,
    );
    expect(app.vault.contentByPath.get(file.path)).toContain(
      `${FIELD_CITATION_STYLE}: apa`,
    );
  });

  it("keeps the default Profile on legacy rendering while conversion is pending", async () => {
    vi.mocked(fetchNoteContext).mockReturnValue(createGateContext());
    const app = makeApp();
    const template = makeTemplate();
    const renderLegacy = vi.spyOn(template, "render");
    const result = await createNoteFeature({
      app,
      template,
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings({ "note.template-conversion-pending": true }),
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
    }).createNote(makeCreateGateItem());

    expect(result.outcome).toBe("created");
    expect(renderLegacy).toHaveBeenCalledWith("note", expect.anything());
  });

  it("gates added Profiles while legacy template conversion is pending", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    const app = makeApp();
    const result = await createNoteFeature({
      app,
      template: makeTemplate(),
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings({
        "note.template-conversion-pending": true,
        profiles: [{ id: profileId, label: "Books" }],
      }),
      attachmentImport: { prepare: vi.fn() },
      noteImport: { prepare: vi.fn() },
    }).createNote(makeCreateGateItem(), { profile: profileId });

    expect(result).toEqual({
      outcome: "refused",
      diagnostic: {
        code: "literature-note-template-conversion-required",
        hint: expect.stringContaining("Convert"),
        profileId,
        indexedKey: "ROOT1234",
      },
    });
    expect(app.vault.create).not.toHaveBeenCalled();
  });

  it("uses the converted document for the default Profile", async () => {
    vi.mocked(fetchNoteContext).mockReturnValue(createGateContext());
    const app = makeApp();
    const document = makeDocumentTemplate({
      createBody: `# Converted\n\n${formatManagedRegion("BODY")}`,
      filename: "Converted-Root",
    });
    const result = await createNoteFeature({
      app,
      template: {
        ...makeTemplate(),
        getLiteratureNoteTemplate: (reference) =>
          reference === "zotlit-profile.default.md" ? document : undefined,
      },
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings({
        defaultDocument: "zotlit-profile.default.md",
      }),
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
    }).createNote(makeCreateGateItem());

    const file = createdFile(result);
    expect(file.path).toBe("Literature/Converted-Root.md");
    expect(document.renderForCreate).toHaveBeenCalledOnce();
  });

  it("creates a Profile note from its document body, filename, and frontmatter", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    const item = makeCreateGateItem();
    vi.mocked(fetchNoteContext).mockReturnValue(createGateContext());
    const app = makeApp();
    const document = makeDocumentTemplate({
      createBody: `# Books layout\n\n${formatManagedRegion("BOOK BODY")}`,
      filename: `Book-Root${filenameSuffix()}`,
      frontmatter: compileDocumentFrontmatter([
        { key: "2", merge: "replace", value: "two" },
        { key: "__proto__", merge: "replace", value: "safe" },
        { key: "conditional", merge: "replace", value: { $if: "false" } },
        { key: "1", merge: "replace", value: "one" },
      ]),
    });
    const template: SyncRenderDeps["template"] = {
      ...makeTemplate(),
      getLiteratureNoteTemplate: (reference) =>
        reference === "books.md" ? document : undefined,
    };
    const renderLegacy = vi.spyOn(template, "render");
    const deps: SyncRenderDeps = {
      app,
      template,
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings({
        profiles: [
          {
            id: profileId,
            label: "Books",
            document: "books.md",
            bindings: { "note.literature-folder": "Books" },
          },
        ],
      }),
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

    const file = createdFile(
      await createNoteFeature(deps).createNote(item, { profile: profileId }),
    );

    expect(file.path).toBe("Books/Book-Root.md");
    expect(app.vault.contentByPath.get(file.path)).toContain(
      `# Books layout\n\n${formatManagedRegion("BOOK BODY")}`,
    );
    const content = app.vault.contentByPath.get(file.path)!;
    expect(content).toContain('"2": two');
    expect(content).toContain("__proto__: safe");
    expect(content).toContain('"1": one');
    expect(content).not.toContain("conditional:");
    expect(content.indexOf('"2": two')).toBeLessThan(
      content.indexOf("__proto__: safe"),
    );
    expect(content.indexOf("__proto__: safe")).toBeLessThan(
      content.indexOf('"1": one'),
    );
    expect(content).toContain(`${FIELD_ZOTERO_KEY}: ROOT1234`);
    expect(content).toContain(
      `${FIELD_LITERATURE_NOTE_PROFILE}: Books (Bk3Qn7XvT2Lp)`,
    );
    expect(document.renderForCreate).toHaveBeenCalledOnce();
    expect(document.renderFilename).toHaveBeenCalled();
    expect(renderLegacy).not.toHaveBeenCalledWith("note", expect.anything());
  });

  it.each([
    { entry: { key: "scripted", js: "zt.title" }, field: "scripted" },
    { entry: { js: "({ title: zt.title })" }, field: "entry #1" },
  ])(
    "refuses create before writing when document $field is inert",
    async ({ entry, field }) => {
      const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
      vi.mocked(fetchNoteContext).mockReturnValue(createGateContext());
      const app = makeApp();
      const document = makeDocumentTemplate({
        frontmatter: compileDocumentFrontmatter(
          [{ ...entry, merge: "replace" }],
          false,
        ),
      });
      const result = await createNoteFeature({
        app,
        template: {
          ...makeTemplate(),
          getLiteratureNoteTemplate: () => document,
        },
        db: makeDb(),
        noteIndex: {
          ready: Promise.resolve(),
          whenIndexed: async () => {},
          getImportedNoteByNoteKey: () => [],
          getNotesByItemKey: () => [],
        },
        zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
        settings: makeSettings({
          profiles: [{ id: profileId, label: "Books", document: "books.md" }],
        }),
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
      }).createNote(makeCreateGateItem(), { profile: profileId });

      expect(result).toMatchObject({
        outcome: "refused",
        diagnostic: {
          code: "managed-frontmatter-refused",
          failures: [
            {
              field,
              message: expect.stringContaining(field),
              hint: expect.any(String),
            },
          ],
        },
      });
      expect(app.vault.create).not.toHaveBeenCalled();
      expect(document.renderForCreate).not.toHaveBeenCalled();
    },
  );

  it("refuses create when a Profile document is missing", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    const app = makeApp();
    const deps: SyncRenderDeps = {
      app,
      template: {
        ...makeTemplate(),
        getLiteratureNoteTemplate: () => undefined,
      },
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings({
        profiles: [
          {
            id: profileId,
            label: "Books",
            document: "missing.md",
          },
        ],
      }),
      attachmentImport: { prepare: vi.fn() },
      noteImport: { prepare: vi.fn() },
    };

    const result = await createNoteFeature(deps).createNote(
      makeCreateGateItem(),
      { profile: profileId },
    );

    expect(result).toEqual({
      outcome: "refused",
      diagnostic: {
        code: "missing-literature-note-template",
        hint: expect.stringContaining("Restore"),
        document: "missing.md",
        indexedKey: "ROOT1234",
      },
    });
    expect(app.vault.create).not.toHaveBeenCalled();
  });

  it("returns a Profile conflict when an explicit create disagrees with the existing stamp", async () => {
    const existingProfileId = "Bk3Qn7XvT2Lp" as ProfileId;
    const requestedProfileId = "Rz9Wm4YfH6Kd" as ProfileId;
    const existing = makeFile("Books/Root.md");
    const app = makeApp();
    app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: existingProfileId },
    });
    const deps: SyncRenderDeps = {
      app,
      template: makeTemplate(),
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: () => [existing],
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      settings: makeSettings({
        profiles: [
          { id: existingProfileId, label: "Books" },
          { id: requestedProfileId, label: "Papers" },
        ],
      }),
      attachmentImport: blockedAttachmentImport,
      noteImport: {
        prepare: vi.fn(),
      },
    };

    const result = await createNoteFeature(deps).createNote(
      makeCreateGateItem(),
      { profile: requestedProfileId },
    );

    expect(result).toEqual({
      outcome: "refused",
      diagnostic: {
        code: "literature-note-profile-conflict",
        hint: expect.stringContaining("Keep"),
        indexedKey: "ROOT1234",
        path: "Books/Root.md",
        existingProfile: existingProfileId,
        requestedProfile: requestedProfileId,
      },
    });
  });
});

describe("overwriteNote", () => {
  it("re-emits the stamp with the Profile's current label", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
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
    vi.mocked(fetchNoteContext).mockReturnValue(updateContext());
    const harness = makeUpdateHarness({
      content: "Old body content",
      frontmatter: {
        [FIELD_LITERATURE_NOTE_PROFILE]: `Reading notes (${profileId})`,
      },
      settings: {
        profiles: [{ id: profileId, label: "Books" }],
      },
    });

    const result = await createNoteFeature(harness.deps).overwriteNote(
      makeFile("Books/Root.md"),
      item.indexedKey,
    );

    expect(result.diagnostic).toBeUndefined();
    expect(harness.frontmatter()).toMatchObject({
      [FIELD_LITERATURE_NOTE_PROFILE]: "Books (Bk3Qn7XvT2Lp)",
    });
  });

  it("refuses before writing when a document field fails", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
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
    vi.mocked(fetchNoteContext).mockReturnValue(updateContext());
    const harness = makeUpdateHarness({
      content: "Old body content",
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: profileId },
      settings: {
        profiles: [{ id: profileId, label: "Books", document: "books.md" }],
      },
    });
    harness.deps.template.getLiteratureNoteTemplate = () =>
      makeDocumentTemplate({
        frontmatter: compileDocumentFrontmatter([
          { key: "broken", merge: "replace", expr: "zt.title | flatten" },
        ]),
      });

    const result = await createNoteFeature(harness.deps).overwriteNote(
      makeFile("Books/Root.md"),
      item.indexedKey,
    );

    expect(result.diagnostic).toMatchObject({
      code: "managed-frontmatter-refused",
      failures: [{ field: "broken" }],
    });
    expect(harness.content()).toBe("Old body content");
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
    expect(harness.processMock).not.toHaveBeenCalled();
  });

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
        metadataCache: { getFileCache: () => null },
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
          renameFile: vi.fn(),
        },
      },
      template: {
        ready: Promise.resolve(),
        loaded: true,
        frontmatterFields: [],
        getLiteratureNoteTemplate: () => undefined,
        renderProfileAnnotation: () => "",
        renderFilename: () => "",
        render: () => "New body content",
      },
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
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
  settings?: Partial<Settings> & Partial<ResolvedLiteratureNoteProfileBindings>;
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
    getLiteratureNoteTemplate: () => undefined,
    renderProfileAnnotation: () => "",
    renderFilename: () => "",
    render: <T extends object>(name: string, _data: T): string =>
      name === "content" ? renderContent() : "",
  };

  const deps: SyncRenderDeps = {
    app: {
      metadataCache: { getFileCache: () => ({ frontmatter: fm }) },
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
        renameFile: vi.fn(),
      },
    },
    template,
    db: makeDb(),
    noteIndex: {
      getImportedNoteByNoteKey: () => [],
      ready: Promise.resolve(),
      whenIndexed: async () => {},
      getNotesByItemKey: () => [],
    },
    zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
    settings: makeSettings(options.settings),
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
  it("gates a stamped added Profile while legacy conversion is pending", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: profileId },
      settings: {
        "note.template-conversion-pending": true,
        profiles: [{ id: profileId, label: "Books" }],
      },
    });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Books/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(result).toEqual({
      bodyUpdated: false,
      duplicateRegionCount: 0,
      diagnostic: {
        code: "literature-note-template-conversion-required",
        hint: expect.stringContaining("Convert"),
        profileId,
        path: "Books/Root.md",
      },
    });
    expect(harness.processMock).not.toHaveBeenCalled();
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
  });

  it("reports a Profile conflict for a requested Profile against an unconfigured stamped id", async () => {
    const stampedId = "Rz9Wm4YfH6Kd" as ProfileId;
    const requestedId = "Bk3Qn7XvT2Lp" as ProfileId;
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: `Books (${stampedId})` },
      settings: {
        profiles: [{ id: requestedId, label: "Papers" }],
      },
    });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Books/Root.md"),
      { indexedKey: "ABC12345", profile: requestedId },
    );

    expect(result).toEqual({
      bodyUpdated: false,
      duplicateRegionCount: 0,
      diagnostic: {
        code: "literature-note-profile-conflict",
        hint: expect.stringContaining("Follow"),
        indexedKey: "ABC12345",
        path: "Books/Root.md",
        existingProfile: stampedId,
        requestedProfile: requestedId,
      },
    });
    expect(harness.processMock).not.toHaveBeenCalled();
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
  });

  it("follows the stamped Profile and refreshes its citation-style binding", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    stubIndexedKeyUpdate(updateContext());
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: profileId },
      settings: {
        profiles: [
          {
            id: profileId,
            label: "Books",
            bindings: {
              "note.literature-folder": "Books",
              "citation.references-style": "apa",
            },
          },
        ],
      },
    });

    await createNoteFeature(harness.deps).updateNote(
      makeFile("Books/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(harness.frontmatter()).toMatchObject({
      [FIELD_ZOTERO_KEY]: "ABC12345",
      [FIELD_LITERATURE_NOTE_PROFILE]: "Books (Bk3Qn7XvT2Lp)",
      [FIELD_CITATION_STYLE]: "apa",
    });
  });

  it("resolves a stale hint by its ID and refreshes it to the current label", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    stubIndexedKeyUpdate(updateContext());
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: {
        [FIELD_LITERATURE_NOTE_PROFILE]: `Reading notes (${profileId})`,
      },
      settings: {
        profiles: [
          {
            id: profileId,
            label: "Books",
            bindings: { "citation.references-style": "apa" },
          },
        ],
      },
    });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Books/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(result.diagnostic).toBeUndefined();
    // The renamed Profile still owns the note, and the note now names it.
    expect(harness.frontmatter()).toMatchObject({
      [FIELD_LITERATURE_NOTE_PROFILE]: "Books (Bk3Qn7XvT2Lp)",
      [FIELD_CITATION_STYLE]: "apa",
    });
  });

  it("takes the last parenthesised id when the label ends in one too", async () => {
    // The worst label a user can write: one that itself ends in something
    // shaped exactly like a Profile stamp, naming the other Profile.
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    const otherId = "Rz9Wm4YfH6Kd" as ProfileId;
    stubIndexedKeyUpdate(updateContext());
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: {
        [FIELD_LITERATURE_NOTE_PROFILE]: `Books (${otherId}) (${profileId})`,
      },
      settings: {
        profiles: [
          {
            id: profileId,
            label: `Books (${otherId})`,
            bindings: { "citation.references-style": "apa" },
          },
          {
            id: otherId,
            label: "Papers",
            bindings: { "citation.references-style": "ieee" },
          },
        ],
      },
    });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Books/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(result.diagnostic).toBeUndefined();
    expect(harness.frontmatter()).toMatchObject({
      [FIELD_LITERATURE_NOTE_PROFILE]: "Books (Rz9Wm4YfH6Kd) (Bk3Qn7XvT2Lp)",
      [FIELD_CITATION_STYLE]: "apa",
    });
  });

  it("carries a non-Latin Profile label into the stamp unchanged", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    stubIndexedKeyUpdate(updateContext());
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: profileId },
      settings: {
        profiles: [{ id: profileId, label: "读书笔记" }],
      },
    });

    await createNoteFeature(harness.deps).updateNote(
      makeFile("Books/Root.md"),
      {
        indexedKey: "ABC12345",
      },
    );

    expect(harness.frontmatter()).toMatchObject({
      [FIELD_LITERATURE_NOTE_PROFILE]: "读书笔记 (Bk3Qn7XvT2Lp)",
    });
  });

  it("refuses a hint-only stamp instead of matching it to a label", async () => {
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: "Reading notes" },
      settings: {
        profiles: [{ id: "Bk3Qn7XvT2Lp" as ProfileId, label: "Reading notes" }],
      },
    });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Literature/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(result).toEqual({
      bodyUpdated: false,
      duplicateRegionCount: 0,
      diagnostic: {
        code: "unknown-literature-note-profile",
        recovery: { action: "switch-profile" },
        hint: expect.stringContaining("Switch profile..."),
        stamp: "Reading notes",
        path: "Literature/Root.md",
      },
    });
    expect(harness.processMock).not.toHaveBeenCalled();
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
  });

  it("refuses a stamp whose parenthesised id is malformed", async () => {
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: "Books (nope)" },
      settings: {
        profiles: [{ id: "Bk3Qn7XvT2Lp" as ProfileId, label: "Books" }],
      },
    });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Literature/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(result.diagnostic).toMatchObject({
      code: "unknown-literature-note-profile",
      recovery: { action: "switch-profile" },
      stamp: "Books (nope)",
      path: "Literature/Root.md",
    });
    expect(harness.processMock).not.toHaveBeenCalled();
  });

  it("prints an unknown full-form stamp exactly as the note carries it", async () => {
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: {
        [FIELD_LITERATURE_NOTE_PROFILE]: "Books (Rz9Wm4YfH6Kd)",
      },
      settings: {
        profiles: [{ id: "Bk3Qn7XvT2Lp" as ProfileId, label: "Books" }],
      },
    });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Literature/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(result.diagnostic).toMatchObject({
      code: "unknown-literature-note-profile",
      recovery: { action: "switch-profile" },
      stamp: "Books (Rz9Wm4YfH6Kd)",
      path: "Literature/Root.md",
    });
  });

  it("removes zotlit-csl when the stamped Profile selects the built-in style", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    stubIndexedKeyUpdate(updateContext());
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: {
        [FIELD_LITERATURE_NOTE_PROFILE]: profileId,
        [FIELD_CITATION_STYLE]: "apa",
      },
      settings: {
        profiles: [
          {
            id: profileId,
            label: "Books",
            bindings: { "citation.references-style": null },
          },
        ],
      },
    });

    await createNoteFeature(harness.deps).updateNote(
      makeFile("Books/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(harness.frontmatter()).not.toHaveProperty(FIELD_CITATION_STYLE);
  });

  it("inherits omitted Profile bindings from the main settings", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    stubIndexedKeyUpdate(updateContext());
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: profileId },
      settings: {
        "citation.references-style": "apa",
        profiles: [
          {
            id: profileId,
            label: "Books",
            bindings: { "note.literature-folder": "Books" },
          },
        ],
      },
    });
    const prepare = vi.fn(harness.deps.noteImport.prepare);
    harness.deps.noteImport.prepare = prepare;

    await createNoteFeature(harness.deps).updateNote(
      makeFile("Books/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          "note.literature-folder": "Books",
          "citation.references-style": "apa",
        }),
      }),
    );
  });

  it("renders only the stamped Profile document Managed Block on update", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    stubIndexedKeyUpdate(updateContext());
    const harness = makeUpdateHarness({
      content: `User prefix\n${formatManagedRegion("OLD")}\nUser suffix`,
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: profileId },
      settings: {
        profiles: [
          {
            id: profileId,
            label: "Books",
            document: "books.md",
          },
        ],
      },
    });
    const document = makeDocumentTemplate({
      updateRegion: formatManagedRegion("BOOK UPDATE"),
    });
    harness.deps.template.getLiteratureNoteTemplate = () => document;

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Books/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(harness.content()).toBe(
      `User prefix\n${formatManagedRegion("BOOK UPDATE")}\nUser suffix`,
    );
    expect(document.renderForUpdate).toHaveBeenCalledOnce();
    expect(document.renderForCreate).not.toHaveBeenCalled();
    expect(harness.renderContent).not.toHaveBeenCalled();
    expect(result).toEqual({ bodyUpdated: true, duplicateRegionCount: 0 });
  });

  it("uses document Managed Frontmatter in entry order and preserves other keys", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    stubIndexedKeyUpdate(updateContext());
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: {
        unmanaged: "keep",
        title: "Old title",
        [FIELD_LITERATURE_NOTE_PROFILE]: profileId,
      },
      settings: {
        profiles: [{ id: profileId, label: "Books", document: "books.md" }],
      },
    });
    Object.defineProperty(harness.deps.template, "frontmatterFields", {
      get: () => {
        throw new Error("Document fields must not read the legacy field set");
      },
    });
    const document = makeDocumentTemplate({
      frontmatter: compileDocumentFrontmatter([
        { key: "title", merge: "replace", expr: "zt.title" },
        {
          key: "tags",
          merge: "replace",
          value: [{ $eval: "zt.title" }],
        },
        { key: "label", merge: "replace", js: "zt.title + '!'" },
      ]),
    });
    harness.deps.template.getLiteratureNoteTemplate = () => document;

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Books/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(result.diagnostic).toBeUndefined();
    expect(harness.frontmatter()).toEqual({
      unmanaged: "keep",
      title: "A Study",
      [FIELD_LITERATURE_NOTE_PROFILE]: "Books (Bk3Qn7XvT2Lp)",
      tags: ["A Study"],
      label: "A Study!",
      [FIELD_ZOTERO_KEY]: "ABC12345",
    });
    expect(harness.frontmatter()).not.toHaveProperty("legacy-only");
  });

  it("uses document Managed Frontmatter for a metadata-only update", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    stubIndexedKeyUpdate(updateContext());
    const original = `prefix\n${formatManagedRegion("OLD")}\nsuffix`;
    const harness = makeUpdateHarness({
      content: original,
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: profileId },
      settings: {
        profiles: [{ id: profileId, label: "Books", document: "books.md" }],
      },
    });
    harness.deps.template.getLiteratureNoteTemplate = () =>
      makeDocumentTemplate({
        frontmatter: compileDocumentFrontmatter([
          { key: "title", merge: "replace", expr: "zt.title" },
        ]),
      });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Books/Root.md"),
      { indexedKey: "ABC12345", scope: "metadata" },
    );

    expect(result).toEqual({ bodyUpdated: false, duplicateRegionCount: 0 });
    expect(harness.content()).toBe(original);
    expect(harness.processMock).not.toHaveBeenCalled();
    expect(harness.frontmatter()).toMatchObject({
      title: "A Study",
      [FIELD_ZOTERO_KEY]: "ABC12345",
      [FIELD_LITERATURE_NOTE_PROFILE]: "Books (Bk3Qn7XvT2Lp)",
    });
  });

  it("refuses every document field when a js entry is inert", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    stubIndexedKeyUpdate(updateContext());
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: {
        status: "reading",
        [FIELD_LITERATURE_NOTE_PROFILE]: profileId,
      },
      settings: {
        profiles: [{ id: profileId, label: "Books", document: "books.md" }],
      },
    });
    harness.deps.template.getLiteratureNoteTemplate = () =>
      makeDocumentTemplate({
        frontmatter: compileDocumentFrontmatter(
          [
            {
              key: "broken-expr",
              merge: "replace",
              expr: "zt.title | flatten",
            },
            { key: "scripted", merge: "replace", js: "zt.title" },
          ],
          false,
        ),
      });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Books/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(result.diagnostic).toMatchObject({
      code: "managed-frontmatter-refused",
      failures: [
        {
          field: "broken-expr",
          message: expect.any(String),
          hint: expect.any(String),
        },
        {
          field: "scripted",
          message: expect.any(String),
          hint: expect.any(String),
        },
      ],
    });
    expect(harness.frontmatter()).toEqual({
      status: "reading",
      [FIELD_LITERATURE_NOTE_PROFILE]: profileId,
    });
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
    expect(harness.processMock).not.toHaveBeenCalled();
  });

  it("collects document field errors and leaves the whole note untouched", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    stubIndexedKeyUpdate(updateContext({ infinity: Number.POSITIVE_INFINITY }));
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: {
        status: "reading",
        [FIELD_LITERATURE_NOTE_PROFILE]: profileId,
      },
      settings: {
        profiles: [{ id: profileId, label: "Books", document: "books.md" }],
      },
    });
    harness.deps.template.getLiteratureNoteTemplate = () =>
      makeDocumentTemplate({
        frontmatter: compileDocumentFrontmatter([
          { key: "broken-expr", merge: "replace", expr: "zt.title | flatten" },
          {
            key: "broken-value",
            merge: "replace",
            value: { $eval: "zt.infinity" },
          },
          { key: "working", merge: "replace", expr: "zt.title" },
          { merge: "replace", value: { "${'zotero-key'}": "bad" } },
          { merge: "replace", value: null },
          { merge: "replace", js: "({ invalid: undefined })" },
        ]),
      });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Books/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(result.diagnostic).toMatchObject({
      code: "managed-frontmatter-refused",
      failures: [
        {
          field: "broken-expr",
          message: expect.any(String),
          hint: expect.any(String),
        },
        {
          field: "broken-value",
          message: expect.any(String),
          hint: expect.any(String),
        },
        {
          field: "'zotero-key' (entry #4)",
          message: expect.stringContaining("'zotero-key' (entry #4)"),
          hint: expect.any(String),
        },
        {
          field: "entry #5",
          message: expect.stringContaining("entry #5"),
          hint: expect.any(String),
        },
        {
          field: "'invalid' (entry #6)",
          message: expect.stringContaining("'invalid' (entry #6)"),
          hint: expect.any(String),
        },
      ],
    });
    expect(harness.frontmatter()).toEqual({
      status: "reading",
      [FIELD_LITERATURE_NOTE_PROFILE]: profileId,
    });
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
    expect(harness.processMock).not.toHaveBeenCalled();
  });

  it.each([
    ["replace", false],
    ["append", true],
    ["keep", true],
  ] as const)(
    "applies an absent document value under %s",
    async (merge, preserved) => {
      const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
      stubIndexedKeyUpdate(updateContext());
      const harness = makeUpdateHarness({
        content: formatManagedRegion("OLD"),
        frontmatter: {
          conditional: "existing",
          [FIELD_LITERATURE_NOTE_PROFILE]: profileId,
        },
        settings: {
          profiles: [{ id: profileId, label: "Books", document: "books.md" }],
        },
      });
      harness.deps.template.getLiteratureNoteTemplate = () =>
        makeDocumentTemplate({
          frontmatter: compileDocumentFrontmatter([
            {
              key: "conditional",
              merge,
              value: { $if: "false" },
            },
          ]),
        });

      const result = await createNoteFeature(harness.deps).updateNote(
        makeFile("Books/Root.md"),
        { indexedKey: "ABC12345" },
      );

      expect(result.diagnostic).toBeUndefined();
      expect(Object.hasOwn(harness.frontmatter(), "conditional")).toBe(
        preserved,
      );
      if (preserved) expect(harness.frontmatter().conditional).toBe("existing");
    },
  );

  it("updates only frontmatter for a Profile document without a Managed Block", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    stubIndexedKeyUpdate(updateContext());
    const harness = makeUpdateHarness({
      content: "Static user-owned body",
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: profileId },
      settings: {
        profiles: [
          {
            id: profileId,
            label: "Books",
            document: "static.md",
          },
        ],
      },
    });
    const document = makeDocumentTemplate({ hasManagedBlock: false });
    harness.deps.template.getLiteratureNoteTemplate = () => document;

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Books/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(harness.content()).toBe("Static user-owned body");
    expect(harness.frontmatter()).toMatchObject({
      [FIELD_ZOTERO_KEY]: "ABC12345",
    });
    expect(harness.processMock).not.toHaveBeenCalled();
    expect(document.renderForUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({
      bodyUpdated: false,
      duplicateRegionCount: 0,
      noManagedBlock: true,
    });
  });

  it("refuses a body update when the stamped Profile document is missing", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: profileId },
      settings: {
        profiles: [
          {
            id: profileId,
            label: "Books",
            document: "missing.md",
          },
        ],
      },
    });
    harness.deps.template.getLiteratureNoteTemplate = () => undefined;

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Books/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(result).toEqual({
      bodyUpdated: false,
      duplicateRegionCount: 0,
      diagnostic: {
        code: "missing-literature-note-template",
        hint: expect.stringContaining("clear"),
        document: "missing.md",
        path: "Books/Root.md",
      },
    });
    expect(harness.processMock).not.toHaveBeenCalled();
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
  });

  it("refuses an unknown Profile stamp without touching the note", async () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: profileId },
    });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Literature/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(result).toEqual({
      bodyUpdated: false,
      duplicateRegionCount: 0,
      diagnostic: {
        code: "unknown-literature-note-profile",
        recovery: { action: "switch-profile" },
        hint: expect.stringContaining("Switch profile..."),
        stamp: profileId,
        path: "Literature/Root.md",
      },
    });
    expect(harness.processMock).not.toHaveBeenCalled();
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
  });

  it("refuses a note stamped with the selector text itself, never treating it as the default Profile", async () => {
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: "default" },
    });

    const result = await createNoteFeature(harness.deps).updateNote(
      makeFile("Literature/Root.md"),
      { indexedKey: "ABC12345" },
    );

    expect(result).toEqual({
      bodyUpdated: false,
      duplicateRegionCount: 0,
      diagnostic: {
        code: "unknown-literature-note-profile",
        recovery: { action: "switch-profile" },
        hint: expect.stringContaining("Switch profile..."),
        stamp: "default",
        path: "Literature/Root.md",
      },
    });
    expect(harness.processMock).not.toHaveBeenCalled();
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
  });

  it("switches the stamp after consent and leaves managed content for the next update", async () => {
    const oldProfileId = "Bk3Qn7XvT2Lp" as ProfileId;
    const newProfileId = "Rz9Wm4YfH6Kd" as ProfileId;
    stubIndexedKeyUpdate(updateContext());
    const harness = makeUpdateHarness({
      content: `My notes\n${formatManagedRegion("OLD")}\nMy conclusion`,
      frontmatter: {
        [FIELD_LITERATURE_NOTE_PROFILE]: oldProfileId,
        [FIELD_CITATION_STYLE]: "apa",
      },
      settings: {
        profiles: [
          { id: oldProfileId, label: "Books" },
          {
            id: newProfileId,
            label: "Papers",
            bindings: { "citation.references-style": "ieee" },
          },
        ],
      },
    });

    const result = await createNoteFeature(harness.deps).switchNoteProfile(
      makeFile("Books/Root.md"),
      { profile: newProfileId },
    );

    expect(result.diagnostic).toBeUndefined();
    expect(harness.frontmatter()).toMatchObject({
      [FIELD_LITERATURE_NOTE_PROFILE]: "Papers (Rz9Wm4YfH6Kd)",
      [FIELD_CITATION_STYLE]: "apa",
    });
    expect(harness.content()).toBe(
      `My notes\n${formatManagedRegion("OLD")}\nMy conclusion`,
    );
    expect(harness.processMock).not.toHaveBeenCalled();
  });

  it("moves the existing basename through the file manager only with consent", async () => {
    const target = "Rz9Wm4YfH6Kd" as ProfileId;
    const harness = makeUpdateHarness({
      content: "My notes",
      settings: {
        profiles: [
          {
            id: target,
            label: "Papers",
            bindings: { "note.literature-folder": "Research/Papers" },
          },
        ],
      },
    });
    const file = makeFile("Books/My chosen name.md");
    const rename = vi.fn(async (_file: TFile, path: string) => {
      file.path = path;
    });
    harness.deps.app.fileManager.renameFile = rename;
    const feature = createNoteFeature(harness.deps);
    await feature.switchNoteProfile(file, {
      profile: target,
    });
    expect(rename).not.toHaveBeenCalled();
    await feature.switchNoteProfile(file, {
      profile: target,
      move: true,
    });
    expect(rename).toHaveBeenCalledWith(
      file,
      "Research/Papers/My chosen name.md",
    );
    expect(file.path).toBe("Research/Papers/My chosen name.md");
    expect(harness.content()).toBe("My notes");
    expect(harness.processMock).not.toHaveBeenCalled();
  });

  it("lists the Imported Notes that belong to one Zotero item", async () => {
    const first = makeFile("Imported/First.md");
    const second = makeFile("Imported/Second.md");
    stubIndexedKeyUpdate(updateContext());
    vi.mocked(getChildNotesByParentIDs).mockReturnValueOnce([
      { indexedKey: "NOTE0001" },
      { indexedKey: "NOTE0002" },
      { indexedKey: "NOTEGONE" },
    ] as never);
    const harness = makeUpdateHarness({ content: formatManagedRegion("OLD") });
    harness.deps.noteIndex.getImportedNoteByNoteKey = (key) =>
      key === "NOTE0001" ? [first] : key === "NOTE0002" ? [second] : [];

    await expect(
      createNoteFeature(harness.deps).getImportedNotesForItem("ABC12345"),
    ).resolves.toEqual([first, second]);
  });

  it("prepares current Profile, real Imported Notes and switch paths that keep the existing name", async () => {
    const books = "Bk3Qn7XvT2Lp" as ProfileId;
    const papers = "Rz9Wm4YfH6Kd" as ProfileId;
    const imported = makeFile("Imported/First.md");
    stubIndexedKeyUpdate(updateContext());
    vi.mocked(getChildNotesByParentIDs).mockReturnValueOnce([
      { indexedKey: "NOTE0001" },
      { indexedKey: "NOTEGONE" },
    ] as never);
    const harness = makeUpdateHarness({
      content: "My content",
      frontmatter: {
        [FIELD_LITERATURE_NOTE_PROFILE]: books,
        "zotero-key": "ABCD2345",
      },
      settings: {
        profiles: [
          {
            id: books,
            label: "Books",
            bindings: { "note.literature-folder": "Books" },
          },
          {
            id: papers,
            label: "Papers",
            bindings: {
              "note.literature-folder": "Research/Papers",
              "citation.references-style": "ieee",
            },
          },
        ],
      },
    });
    harness.deps.noteIndex.getImportedNoteByNoteKey = (key) =>
      key === "NOTE0001" ? [imported] : [];
    const plan = await createNoteFeature(harness.deps).prepareProfileSwitch(
      makeFile("Books/My title.md"),
    );
    expect(plan.current).toMatchObject({ selector: books, label: "Books" });
    expect(plan.importedNotes).toEqual([imported]);
    expect(plan.profiles).toMatchObject([
      {
        selector: "default",
        folder: "Literature",
        path: "Literature/My title.md",
      },
      { selector: books, folder: "Books", path: "Books/My title.md" },
      {
        selector: papers,
        folder: "Research/Papers",
        citationStyle: "ieee",
        path: "Research/Papers/My title.md",
      },
    ]);
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
  });

  it.each(["missing item", "unavailable database"])(
    "recovers the existing Literature Note with %s",
    async (failure) => {
      const target = "Rz9Wm4YfH6Kd" as ProfileId;
      stubIndexedKeyUpdate(updateContext());
      const harness = makeUpdateHarness({
        content: "My preserved reading notes",
        frontmatter: {
          "zotero-key": "ABCD2345",
          [FIELD_LITERATURE_NOTE_PROFILE]: "Missing profile (Qw8Er5Ty2Ui9)",
        },
        settings: { profiles: [{ id: target, label: "Papers" }] },
      });
      if (failure === "missing item")
        vi.mocked(getItemsByKey).mockReturnValueOnce([]);
      else
        harness.deps.db.acquireRead = async () => {
          throw new Error("Database unavailable");
        };
      const file = makeFile("Literature/Paper.md");
      const feature = createNoteFeature(harness.deps);
      const plan = await feature.prepareProfileSwitch(file);
      expect(plan.importedNotes).toBeNull();
      expect(plan.current.selector).toBeUndefined();
      expect(plan.profiles.map(({ selector }) => selector)).toEqual([
        "default",
        target,
      ]);
      const result = await feature.switchNoteProfile(file, { profile: target });
      expect(result.diagnostic).toBeUndefined();
      expect(harness.frontmatter()[FIELD_LITERATURE_NOTE_PROFILE]).toBe(
        "Papers (Rz9Wm4YfH6Kd)",
      );
      expect(harness.content()).toBe("My preserved reading notes");
    },
  );

  it("re-stamps an opted-in Imported Note family after the Literature Note switch", async () => {
    const oldProfileId = "Bk3Qn7XvT2Lp" as ProfileId;
    const newProfileId = "Rz9Wm4YfH6Kd" as ProfileId;
    const imported = [
      makeFile("Imported/First.md"),
      makeFile("Imported/Second.md"),
    ];
    stubIndexedKeyUpdate(updateContext());
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: oldProfileId },
      settings: {
        profiles: [
          { id: oldProfileId, label: "Books" },
          { id: newProfileId, label: "Papers" },
        ],
      },
    });
    const result = await createNoteFeature(harness.deps).switchNoteProfile(
      makeFile("Books/Root.md"),
      {
        profile: newProfileId,
        importedNotes: imported,
      },
    );

    expect(result.diagnostic).toBeUndefined();
    expect(harness.frontmatterMock.mock.calls.map(([file]) => file)).toEqual(
      expect.arrayContaining(imported),
    );
  });

  it("recovers an Imported Note directly with its import folder and no parent Literature Note", async () => {
    const target = "Rz9Wm4YfH6Kd" as ProfileId;
    const harness = makeUpdateHarness({
      content: "Imported body",
      frontmatter: {
        "zotero-note-key": "NTE23456",
        [FIELD_LITERATURE_NOTE_PROFILE]: "Missing profile (Qw8Er5Ty2Ui9)",
      },
      settings: {
        profiles: [
          {
            id: target,
            label: "Papers",
            bindings: {
              "note.import-folder": "Imported/Papers",
              "note.literature-folder": "Literature/Papers",
            },
          },
        ],
      },
    });
    harness.deps.db.acquireRead = async () => {
      throw new Error("Recovery must not need a parent lookup");
    };
    const file = makeFile("Imports/Child.md");
    harness.deps.app.fileManager.renameFile = async (_file, path) => {
      file.path = path;
    };
    const feature = createNoteFeature(harness.deps);
    const plan = await feature.prepareProfileSwitch(file);
    expect(plan.imported).toBe(true);
    expect(plan.importedNotes).toEqual([]);
    expect(
      plan.profiles.find(({ selector }) => selector === target),
    ).toMatchObject({
      folder: "Imported/Papers",
      path: "Imported/Papers/Child.md",
    });
    await feature.switchNoteProfile(file, { profile: target, move: true });
    expect(file.path).toBe("Imported/Papers/Child.md");
    expect(harness.frontmatter()[FIELD_LITERATURE_NOTE_PROFILE]).toBe(
      "Papers (Rz9Wm4YfH6Kd)",
    );
    expect(harness.content()).toBe("Imported body");
  });

  it("does not re-stamp the Imported Note family when the Literature Note switch is refused", async () => {
    const newProfileId = "Rz9Wm4YfH6Kd" as ProfileId;
    const imported = makeFile("Imported/First.md");
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      settings: {
        profiles: [{ id: newProfileId, label: "Papers" }],
        "note.template-conversion-pending": true,
      },
    });

    const result = await createNoteFeature(harness.deps).switchNoteProfile(
      makeFile("Literature/Root.md"),
      {
        profile: newProfileId,
        importedNotes: [imported],
      },
    );

    expect(result.diagnostic?.code).toBe(
      "literature-note-template-conversion-required",
    );
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
  });

  it("restores all note stamps and the original path when one family write fails", async () => {
    const oldProfileId = "Bk3Qn7XvT2Lp" as ProfileId;
    const newProfileId = "Rz9Wm4YfH6Kd" as ProfileId;
    const literature = makeFile("Literature/Root.md");
    const imported = [
      makeFile("Imported/First.md"),
      makeFile("Imported/Second.md"),
    ];
    stubIndexedKeyUpdate(updateContext());
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      settings: {
        profiles: [
          { id: oldProfileId, label: "Books" },
          {
            id: newProfileId,
            label: "Papers",
            bindings: { "note.literature-folder": "Papers" },
          },
        ],
      },
    });
    const frontmatters = new Map(
      [literature, ...imported].map((file) => [
        file,
        { [FIELD_LITERATURE_NOTE_PROFILE]: oldProfileId },
      ]),
    );
    harness.deps.app.metadataCache.getFileCache = (file) => ({
      frontmatter: frontmatters.get(file),
    });
    let failed = false;
    harness.deps.app.fileManager.processFrontMatter = vi.fn(
      async (file, callback) => {
        callback(frontmatters.get(file)!);
        if (file === imported[1] && !failed) {
          failed = true;
          throw new Error("frontmatter write failed");
        }
      },
    );
    const rename = vi.fn(async (file: TFile, path: string) => {
      file.path = path;
    });
    harness.deps.app.fileManager.renameFile = rename;

    await expect(
      createNoteFeature(harness.deps).switchNoteProfile(literature, {
        profile: newProfileId,
        importedNotes: imported,
        move: true,
      }),
    ).rejects.toThrow("frontmatter write failed");

    expect(literature.path).toBe("Literature/Root.md");
    expect(rename.mock.calls.map(([, path]) => path)).toEqual([
      "Papers/Root.md",
      "Literature/Root.md",
    ]);
    expect(frontmatters.get(literature)).toMatchObject({
      [FIELD_LITERATURE_NOTE_PROFILE]: oldProfileId,
    });
    for (const file of imported) {
      expect(frontmatters.get(file)).toMatchObject({
        [FIELD_LITERATURE_NOTE_PROFILE]: oldProfileId,
      });
    }
  });

  it("keeps the previous stamp when a requested folder move fails", async () => {
    const oldProfileId = "Bk3Qn7XvT2Lp" as ProfileId;
    const newProfileId = "Rz9Wm4YfH6Kd" as ProfileId;
    stubIndexedKeyUpdate(updateContext());
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: oldProfileId },
      settings: {
        profiles: [
          { id: oldProfileId, label: "Books" },
          { id: newProfileId, label: "Papers" },
        ],
      },
    });
    harness.deps.app.fileManager.renameFile = vi.fn(async () => {
      throw new Error("destination exists");
    });

    await expect(
      createNoteFeature(harness.deps).switchNoteProfile(
        makeFile("Books/Root.md"),
        { profile: newProfileId, move: true },
      ),
    ).rejects.toThrow("destination exists");

    expect(harness.frontmatter()[FIELD_LITERATURE_NOTE_PROFILE]).toBe(
      oldProfileId,
    );
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
  });

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
    settings: {
      ...settingsDefaults,
      "note.default-profile": {
        ...settingsDefaults["note.default-profile"],
        bindings: {
          ...settingsDefaults["note.default-profile"].bindings,
          "note.literature-folder": "Literature",
        },
      },
    },
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

  it("uses document Managed Frontmatter for a headless metadata update", async () => {
    vi.mocked(fetchNoteContext).mockReturnValue(updateContext());
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    const original = `prefix\n${formatManagedRegion("OLD")}\nsuffix`;
    const harness = makeUpdateHarness({
      content: original,
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: profileId },
    });
    harness.deps.template.getLiteratureNoteTemplate = () =>
      makeDocumentTemplate({
        frontmatter: compileDocumentFrontmatter([
          { key: "title", merge: "replace", expr: "zt.title" },
        ]),
      });
    const options = writeOptions("metadata");
    const profileSettings: Settings = {
      ...options.settings,
      profiles: [{ id: profileId, label: "Books", document: "books.md" }],
    };
    harness.deps.profile = profileReader(
      profileSettings,
      harness.deps.app.metadataCache,
    );

    const result = await createNoteFeature(harness.deps).writeNoteUpdate(
      makeFile("Books/Root.md"),
      options,
    );

    expect(result).toEqual({ bodyUpdated: false, duplicateRegionCount: 0 });
    expect(harness.content()).toBe(original);
    expect(harness.processMock).not.toHaveBeenCalled();
    expect(harness.frontmatter()).toMatchObject({
      title: "A Study",
      [FIELD_ZOTERO_KEY]: "ABC12345",
      [FIELD_LITERATURE_NOTE_PROFILE]: "Books (Bk3Qn7XvT2Lp)",
    });
  });

  it("refuses a conflicting explicit Profile on the headless batch seam", async () => {
    const stampedId = "Bk3Qn7XvT2Lp" as ProfileId;
    const requestedId = "Rz9Wm4YfH6Kd" as ProfileId;
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: stampedId },
    });
    const options = writeOptions();
    const profileSettings: Settings = {
      ...options.settings,
      profiles: [
        { id: stampedId, label: "Books" },
        { id: requestedId, label: "Papers" },
      ],
    };
    harness.deps.profile = profileReader(
      profileSettings,
      harness.deps.app.metadataCache,
    );
    options.profile = requestedId;

    const result = await createNoteFeature(harness.deps).writeNoteUpdate(
      makeFile("Books/Root.md"),
      options,
    );

    expect(result.diagnostic).toMatchObject({
      code: "literature-note-profile-conflict",
      existingProfile: stampedId,
      requestedProfile: requestedId,
    });
    expect(harness.processMock).not.toHaveBeenCalled();
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
  });

  it("refuses an unknown stamp on the headless batch seam instead of reporting a conflict", async () => {
    const requestedId = "Rz9Wm4YfH6Kd" as ProfileId;
    const harness = makeUpdateHarness({
      content: formatManagedRegion("OLD"),
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: "legacy" },
    });
    const options = writeOptions();
    const profileSettings: Settings = {
      ...options.settings,
      profiles: [{ id: requestedId, label: "Papers" }],
    };
    harness.deps.profile = profileReader(
      profileSettings,
      harness.deps.app.metadataCache,
    );
    options.profile = requestedId;

    const result = await createNoteFeature(harness.deps).writeNoteUpdate(
      makeFile("Books/Root.md"),
      options,
    );

    expect(result.diagnostic).toMatchObject({
      code: "unknown-literature-note-profile",
      recovery: { action: "switch-profile" },
      stamp: "legacy",
    });
    expect(harness.processMock).not.toHaveBeenCalled();
    expect(harness.frontmatterMock).not.toHaveBeenCalled();
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
        getLiteratureNoteTemplate: () => undefined,
        renderProfileAnnotation: () => "",
        renderFilename: () => "",
        render,
      },
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
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
        getLiteratureNoteTemplate: () => undefined,
        renderProfileAnnotation: () => "",
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
        getImportedNoteByNoteKey: () => [],
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
        getLiteratureNoteTemplate: () => undefined,
        renderProfileAnnotation: vi.fn(),
        renderFilename: () => "",
        render: vi.fn(),
      },
      db: makeDb(),
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
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

  it("uses the annotation parent item's stamped Profile at drag start", () => {
    const profileId = "Bk3Qn7XvT2Lp" as ProfileId;
    vi.mocked(getAnnotationsByItemId).mockReturnValue([
      { key: "ANN1" } as never,
    ]);
    vi.mocked(fetchAnnotationsTemplateData).mockReturnValue(
      new Map([["ANN1", annData("Hensher2011", "62", "PARENT1")]]),
    );
    const file = makeFile("Literature/Parent.md");
    const app = makeApp();
    app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: profileId },
    });
    const template = citeTemplate();
    template.renderProfileAnnotation = vi.fn(() => "PROFILE ANNOTATION");
    const deps = {
      ...annotDeps(template),
      app,
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: (indexedKey: string) =>
          indexedKey === "PARENT1" ? [file] : [],
      },
      settings: makeSettings({
        profiles: [
          {
            id: profileId,
            label: "Books",
            document: "books.md",
          },
        ],
      }),
    };

    const result = createNoteFeature(deps).renderAnnotation(1, {
      attachmentImport: { decide: blockedDecide, resolveLink: () => () => "" },
    });

    expect(result).toBe("PROFILE ANNOTATION");
    expect(template.renderProfileAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        parentItem: expect.objectContaining({ indexedKey: "PARENT1" }),
      }),
      expect.objectContaining({
        profile: expect.objectContaining({
          selector: profileId,
          label: "Books",
          stamp: `Books (${profileId})`,
        }),
      }),
    );
  });

  it("uses the default Profile when the annotation parent has no stamped note", () => {
    vi.mocked(getAnnotationsByItemId).mockReturnValue([
      { key: "ANN1" } as never,
    ]);
    vi.mocked(fetchAnnotationsTemplateData).mockReturnValue(
      new Map([["ANN1", annData("Hensher2011", "62", "PARENT1")]]),
    );
    const template = citeTemplate();
    template.renderProfileAnnotation = vi.fn(() => "DEFAULT ANNOTATION");
    const deps = annotDeps(template);

    const result = createNoteFeature(deps).renderAnnotation(1, {
      attachmentImport: { decide: blockedDecide, resolveLink: () => () => "" },
    });

    expect(result).toBe("DEFAULT ANNOTATION");
    expect(template.renderProfileAnnotation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        profile: expect.objectContaining({ selector: "default" }),
      }),
    );
  });

  it("throws when the annotation parent's stamped Profile names none configured", () => {
    vi.mocked(getAnnotationsByItemId).mockReturnValue([
      { key: "ANN1" } as never,
    ]);
    vi.mocked(fetchAnnotationsTemplateData).mockReturnValue(
      new Map([["ANN1", annData("Hensher2011", "62", "PARENT1")]]),
    );
    const file = makeFile("Literature/Parent.md");
    const app = makeApp();
    app.metadataCache.getFileCache.mockReturnValue({
      frontmatter: {
        [FIELD_LITERATURE_NOTE_PROFILE]: "Deleted (Nn4Pp6Qq8Rr0)",
      },
    });
    const template = citeTemplate();
    template.renderProfileAnnotation = vi.fn(() => "PROFILE ANNOTATION");
    const deps = {
      ...annotDeps(template),
      app,
      noteIndex: {
        getImportedNoteByNoteKey: () => [],
        ready: Promise.resolve(),
        whenIndexed: async () => {},
        getNotesByItemKey: (indexedKey: string) =>
          indexedKey === "PARENT1" ? [file] : [],
      },
    };

    let thrown: unknown;
    try {
      createNoteFeature(deps).renderAnnotation(1, {
        attachmentImport: {
          decide: blockedDecide,
          resolveLink: () => () => "",
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProfileAnnotationError);
    expect((thrown as ProfileAnnotationError).diagnostic).toMatchObject({
      code: "unknown-literature-note-profile",
      recovery: { action: "switch-profile" },
      stamp: "Deleted (Nn4Pp6Qq8Rr0)",
      path: "Literature/Parent.md",
    });
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
    getLiteratureNoteTemplate: () => undefined,
    renderProfileAnnotation: <T extends object>(data: T): string =>
      facade.render("annotation", data),
    renderFilename: () => "",
    render: <T extends object>(name: string, data: T): string =>
      facade.render(name, data),
  };
}

/** One annotation's template data with a parent item carrying `citekey`. */
const annData = (
  citekey: string | null,
  pageLabel: string | null,
  indexedKey = "PARENT1",
) =>
  ({
    key: "ANN1",
    pageLabel,
    parentItem:
      citekey === null ? null : { citationKey: citekey, citekey, indexedKey },
  }) as never;

function annotDeps(template: SyncRenderDeps["template"]): SyncRenderDeps {
  return {
    app: makeApp(),
    template,
    db: makeDb(),
    noteIndex: {
      getImportedNoteByNoteKey: () => [],
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
    expect(result).toContain("[@Hensher2011, {p. 62}]");
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
      "[@Hensher2011, {p. 62}]",
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
      "[@Hensher2011, {p. 62}]",
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
    getLiteratureNoteTemplate: () => undefined,
    renderProfileAnnotation: () => "",
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

function makeDocumentTemplate(
  options: {
    createBody?: string;
    updateRegion?: string;
    filename?: string;
    hasManagedBlock?: boolean;
    frontmatter?: CompiledManagedFrontmatter;
  } = {},
): ResolvedLiteratureNoteTemplate & {
  renderForCreate: ReturnType<typeof vi.fn>;
  renderForUpdate: ReturnType<typeof vi.fn>;
  renderFilename: ReturnType<typeof vi.fn>;
} {
  const hasManagedBlock = options.hasManagedBlock ?? true;
  return {
    reference: "books.md",
    path: "templates/books.md",
    manifest: {
      id: "books",
      name: "Books",
      version: "1.0.0",
      author: "ZotLit",
      description: "Books fixture",
      contract: 1,
      filename: "{{ zt.title }}",
      language: "liquid",
      ...(options.frontmatter ? { frontmatter: [] } : {}),
    },
    frontmatter: options.frontmatter,
    hasManagedBlock,
    renderForCreate: vi.fn(() => options.createBody ?? "DOCUMENT BODY"),
    renderForUpdate: vi.fn(() =>
      hasManagedBlock
        ? (options.updateRegion ?? formatManagedRegion("DOCUMENT UPDATE"))
        : null,
    ),
    renderAnnotation: vi.fn(() => "DOCUMENT ANNOTATION"),
    renderFilename: vi.fn(() => options.filename ?? "Document note"),
  };
}

function compileDocumentFrontmatter(
  entries: Parameters<TemplateFacade["compileManagedFrontmatterEntries"]>[0],
  javascript = true,
): CompiledManagedFrontmatter {
  return new TemplateFacade().compileManagedFrontmatterEntries(entries, {
    javascript,
  });
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

function makeSettings(
  overrides: Partial<Settings> &
    Partial<ResolvedLiteratureNoteProfileBindings> = {},
): NoteFeatureDeps["settings"] {
  const {
    ["note.literature-folder"]: literatureFolder,
    ["citation.references-style"]: referencesStyle,
    ["note.import-folder"]: importFolder,
    ["note.import-colored-highlights"]: importColoredHighlights,
    ["note.import-annotations-as-template"]: importAnnotationsAsTemplate,
    ...persisted
  } = overrides;
  const current = {
    ...settingsDefaults,
    ...persisted,
    "note.default-profile": {
      ...settingsDefaults["note.default-profile"],
      ...persisted["note.default-profile"],
      bindings: {
        ...settingsDefaults["note.default-profile"].bindings,
        ...persisted["note.default-profile"]?.bindings,
        "note.literature-folder": literatureFolder ?? "Literature",
        ...(referencesStyle === undefined
          ? {}
          : { "citation.references-style": referencesStyle }),
        ...(importFolder === undefined
          ? {}
          : { "note.import-folder": importFolder }),
        ...(importColoredHighlights === undefined
          ? {}
          : { "note.import-colored-highlights": importColoredHighlights }),
        ...(importAnnotationsAsTemplate === undefined
          ? {}
          : {
              "note.import-annotations-as-template":
                importAnnotationsAsTemplate,
            }),
      },
    },
  };
  return {
    current,
    loaded: Promise.resolve(current),
    update: (patch) => {
      Object.assign(
        current,
        typeof patch === "function" ? patch(current) : patch,
      );
      return current;
    },
  };
}

interface MockNoteApp {
  metadataCache: {
    getFileCache: Mock<() => { frontmatter?: Record<string, unknown> } | null>;
  };
  vault: {
    contentByPath: Map<string, string>;
    getAbstractFileByPath(path: string): TFile | TFolder | null;
    getRoot(): TFolder;
    createFolder(path: string): Promise<TFolder>;
    create: Mock<(path: string, content: string) => Promise<TFile>>;
    process(): Promise<string>;
  };
  fileManager: {
    links: { path: string; sourcePath: string; alias: string | undefined }[];
    generateMarkdownLink: FileManager["generateMarkdownLink"];
    processFrontMatter(): Promise<void>;
    renameFile: FileManager["renameFile"];
  };
}

function makeApp(): MockNoteApp {
  const root = new TFolder();
  root.path = "/";
  const literature = new TFolder();
  literature.path = "Literature";
  const contentByPath = new Map<string, string>();
  const filesByPath = new Map<string, TFile>();
  const links: {
    path: string;
    sourcePath: string;
    alias: string | undefined;
  }[] = [];

  return {
    metadataCache: {
      getFileCache: vi.fn(() => null),
    },
    vault: {
      contentByPath,
      getAbstractFileByPath: (path: string) =>
        path === "Literature" ? literature : (filesByPath.get(path) ?? null),
      getRoot: () => root,
      createFolder: vi.fn(),
      create: vi.fn(async (path: string, content: string) => {
        contentByPath.set(path, content);
        const file = makeFile(path);
        filesByPath.set(path, file);
        return file;
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
      renameFile: vi.fn(),
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

function createdFile(
  result: Awaited<ReturnType<NoteFeature["createNote"]>>,
): TFile {
  expect(result.outcome).toBe("created");
  if (result.outcome !== "created") {
    throw new Error(`Expected a created note, got ${result.outcome}`);
  }
  return result.file;
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

function makeCreateGateItem(): Item {
  return {
    itemID: 1,
    libraryID: 1,
    key: "ROOT1234",
    indexedKey: "ROOT1234",
    dateAdded: {} as Temporal.Instant,
    dateModified: {} as Temporal.Instant,
    creators: [],
    primaryCreatorType: "author",
    customFields: new Map(),
    groupID: null,
    fields: {
      itemType: "journalArticle",
      title: "Root",
      citationKey: "root",
    } as ItemFields,
    baseFields: {
      publicationTitle: null,
      publisher: null,
      volume: null,
      issue: null,
      pages: null,
    },
    venue: null,
  };
}

function createGateContext(): NoteTemplateContext {
  return {
    indexedKey: "ROOT1234",
    notePath: "Literature/Root.md",
    noteLink: () => "[[Literature/Root.md]]",
    relatedItems: [],
  } as unknown as NoteTemplateContext;
}
