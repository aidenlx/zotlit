/**
 * Automatic Profile Selection by Collection and Tag membership, exercised
 * through the Note Feature's creation operations against real relational
 * rows: a two-Library Zotero database whose Collections share names and keys
 * across Libraries, nest, and hold one Item in several places, and whose
 * Tags differ by case and origin.
 */
import { TFile, TFolder } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import type { Item, NoteTemplateContext } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import type { ItemFields } from "@zotlit/zotero-types";

import {
  FIELD_LITERATURE_NOTE_PROFILE,
  FIELD_ZOTERO_KEY,
} from "@/lib/constants";
import type { ProfileId } from "@/lib/profile-stamp";
import type { SourceOrigin } from "@/services/attachment-import/service";
import { listCollectionChoices } from "@/services/profile-selection";
import type { ProfileSelectionRule } from "@/services/profile-selection";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import type { ProfileFixtureSettings } from "@/services/profile/__fixtures__/reader";
import { defaults as settingsDefaults } from "@/services/settings/schema";
import type { ResolvedLiteratureNoteTemplate } from "@/services/template/service";

import type { NoteFeatureDeps, SyncRenderDeps } from "./context";
import { createNoteFeature } from "./operations";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    // The template context is not under test; every relational read a rule
    // needs (Tags, Collections, Libraries) runs against the fixture rows.
    fetchNoteContext: vi.fn(
      (_client: unknown, item: Item): NoteTemplateContext =>
        ({
          indexedKey: item.indexedKey,
          citationKey: (item.fields as { citationKey: string }).citationKey,
          title: (item.fields as { title: string }).title,
          notePath: "",
          noteLink: () => "",
          relatedItems: [],
        }) as unknown as NoteTemplateContext,
    ),
  };
});

const books = "Bk3Qn7XvT2Lp" as ProfileId;
const papers = "Rz9Wm4YfH6Kd" as ProfileId;

/**
 * My Library (1) and the "Lab Archive" group (2, groupID 118).
 *
 * Collections: My Library holds Project (PROJ0001) > Drafts (DRFT0001) and
 * Other (OTHR0001); the group holds its own Project with the same key
 * PROJ0001.
 *
 * Items: the book BOOK0001 (1) is filed in Drafts and Other, tagged "Read"
 * (manual) and "READ" (automatic); the group book BOOK0002 (2) is filed in
 * the group's Project; the article ARTC0001 (3) is filed directly in My
 * Library's Project, tagged "auto-tag" (automatic).
 */
function seed(client: NodeDatabaseClient): void {
  createFixtureSchema(client.$client);
  client.$client.exec(`
    insert into libraries (libraryID, type) values (1, 'user'), (2, 'group');
    insert into groups (groupID, libraryID, name) values (118, 2, 'Lab Archive');
    insert into itemTypes (itemTypeID, typeName) values (1, 'book'), (2, 'journalArticle');
    insert into items (itemID, itemTypeID, libraryID, key)
      values (1, 1, 1, 'BOOK0001'), (2, 1, 2, 'BOOK0002'), (3, 2, 1, 'ARTC0001');
    insert into collections (collectionID, collectionName, parentCollectionID, libraryID, key)
      values
        (100, 'Project', null, 1, 'PROJ0001'),
        (101, 'Drafts', 100, 1, 'DRFT0001'),
        (102, 'Other', null, 1, 'OTHR0001'),
        (200, 'Project', null, 2, 'PROJ0001');
    insert into collectionItems (collectionID, itemID)
      values (101, 1), (102, 1), (200, 2), (100, 3);
    insert into tags (tagID, name) values (1, 'Read'), (2, 'READ'), (3, 'auto-tag');
    insert into itemTags (itemID, tagID, type) values (1, 1, 0), (1, 2, 1), (3, 3, 1);
  `);
}

const personalBook = item({
  itemID: 1,
  libraryID: 1,
  groupID: null,
  key: "BOOK0001",
  itemType: "book",
});
const groupBook = item({
  itemID: 2,
  libraryID: 2,
  groupID: 118,
  key: "BOOK0002",
  itemType: "book",
});
const article = item({
  itemID: 3,
  libraryID: 1,
  groupID: null,
  key: "ARTC0001",
  itemType: "journalArticle",
});

function item(input: {
  itemID: number;
  libraryID: number;
  groupID: number | null;
  key: string;
  itemType: string;
}): Item {
  return {
    itemID: input.itemID,
    libraryID: input.libraryID,
    groupID: input.groupID,
    key: input.key,
    indexedKey: input.key,
    dateAdded: {} as Temporal.Instant,
    dateModified: {} as Temporal.Instant,
    creators: [],
    primaryCreatorType: "author",
    customFields: new Map(),
    fields: {
      itemType: input.itemType,
      title: input.key,
      citationKey: input.key.toLowerCase(),
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

function rule(
  overrides: Partial<ProfileSelectionRule> & { id: string },
): ProfileSelectionRule {
  return {
    scope: { mode: "all" },
    expression: "",
    profile: books,
    ...overrides,
  };
}

/** The Books document: notes land under `Reading/<title>.md`. */
function booksDocument(): ResolvedLiteratureNoteTemplate {
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
    },
    frontmatter: undefined,
    hasManagedBlock: true,
    renderForCreate: () => "DOCUMENT BODY",
    renderForUpdate: () => null,
    renderAnnotation: () => "",
    renderFilename: (data) => (data as { title: string }).title,
  };
}

interface Harness {
  deps: SyncRenderDeps;
  client: NodeDatabaseClient;
  /** Every note the vault holds, by path. */
  vault: Map<string, string>;
}

function harness(rules: readonly ProfileSelectionRule[]): Harness {
  const client = createClient(":memory:");
  seed(client);
  const vault = new Map<string, string>();
  const files = new Map<string, TFile>();
  const notesByItemKey = new Map<string, TFile[]>();
  const root = new TFolder();
  root.path = "/";
  const current: ProfileFixtureSettings = {
    ...settingsDefaults,
    "profile.selection-rules": rules,
    profiles: [
      {
        id: books,
        label: "Books",
        document: "books.md",
        bindings: { "note.literature-folder": "Reading" },
      },
      { id: papers, label: "Papers" },
    ],
  };
  const settings: NoteFeatureDeps["settings"] = {
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
  const app = {
    metadataCache: {
      getFileCache: (file: TFile) => {
        const stamp = vault
          .get(file.path)
          ?.match(new RegExp(`${FIELD_LITERATURE_NOTE_PROFILE}: (.*)`))?.[1];
        return stamp
          ? { frontmatter: { [FIELD_LITERATURE_NOTE_PROFILE]: stamp } }
          : null;
      },
    },
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      getRoot: () => root,
      createFolder: async () => new TFolder(),
      create: async (path: string, content: string) => {
        vault.set(path, content);
        const file = new TFile();
        file.path = path;
        file.name = path.split("/").at(-1)!;
        file.basename = file.name.replace(/\.md$/, "");
        file.extension = "md";
        files.set(path, file);
        return file;
      },
      process: async () => "",
    },
    fileManager: {
      generateMarkdownLink: () => "",
      processFrontMatter: async () => {},
      renameFile: async () => {},
    },
  } as unknown as NoteFeatureDeps["app"];
  const deps: SyncRenderDeps = {
    app,
    settings,
    profile: profileReader(() => current, app.metadataCache),
    template: {
      ready: Promise.resolve(),
      loaded: true,
      frontmatterFields: [],
      getLiteratureNoteTemplate: (reference) =>
        reference === "books.md" ? booksDocument() : undefined,
      renderProfileAnnotation: () => "",
      renderFilename: (data) => (data as { title: string }).title,
      render: () => "",
    },
    db: {
      state: "ready",
      client,
      acquireRead: async () => ({ client, [Symbol.dispose]() {} }),
    },
    noteIndex: {
      ready: Promise.resolve(),
      whenIndexed: async () => {},
      getImportedNoteByNoteKey: () => [],
      getNotesByItemKey: (indexedKey) => notesByItemKey.get(indexedKey) ?? [],
    },
    zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
    attachmentImport: {
      prepare: async () => ({
        decide: (path: string, origin: SourceOrigin) => ({
          approved: false,
          path,
          origin,
          reason: "no-trusted-root",
        }),
        resolveLink: () => () => "",
        flush: async () => ({
          copied: 0,
          skipped: 0,
          missing: 0,
          blocked: 0,
          refused: 0,
        }),
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
  };
  // The Note Index sees every note this harness creates.
  const create = app.vault.create;
  app.vault.create = async (path: string, content: string) => {
    const file = await create(path, content);
    const indexedKey = content.match(
      new RegExp(`${FIELD_ZOTERO_KEY}: (\\S+)`),
    )?.[1];
    if (indexedKey)
      notesByItemKey.set(indexedKey, [
        ...(notesByItemKey.get(indexedKey) ?? []),
        file,
      ]);
    return file;
  };
  return { deps, client, vault };
}

describe("Profile Selection Rules over Collection and Tag rows", () => {
  it("tells identical Collection names and keys apart by their portable Library reference", async () => {
    const groupProject = rule({
      id: "group-project",
      expression: 'inCollection("group:118", "PROJ0001")',
      profile: papers,
    });
    const myProject = rule({
      id: "my-project",
      expression: 'inCollection("personal", "PROJ0001")',
    });
    const feature = createNoteFeature(harness([groupProject, myProject]).deps);
    // The personal book sits in Drafts, a child of My Library's Project.
    expect(
      await feature.resolveCreationProfile({ item: personalBook }),
    ).toEqual({
      selector: books,
      source: "rule",
      shouldAsk: true,
      rule: myProject,
    });
    expect(await feature.resolveCreationProfile({ item: groupBook })).toEqual({
      selector: papers,
      source: "rule",
      shouldAsk: true,
      rule: groupProject,
    });
    expect(await feature.resolveCreationProfile({ item: article })).toEqual({
      selector: books,
      source: "rule",
      shouldAsk: true,
      rule: myProject,
    });
  });

  it("includes subcollections by default and limits a direct-only condition to the Collection itself", async () => {
    const directProject = rule({
      id: "direct-project",
      expression: 'inCollectionDirectly("personal", "PROJ0001")',
    });
    const directDrafts = rule({
      id: "direct-drafts",
      expression: 'inCollectionDirectly("personal", "DRFT0001")',
      profile: papers,
    });
    const feature = createNoteFeature(
      harness([directProject, directDrafts]).deps,
    );
    expect(
      await feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({ selector: papers, rule: directDrafts });
    expect(
      await feature.resolveCreationProfile({ item: article }),
    ).toMatchObject({ selector: books, rule: directProject });
  });

  it("reads every Collection the Item is filed in, not the one a screen shows it under", async () => {
    const other = rule({
      id: "other",
      expression: 'inCollection("personal", "OTHR0001")',
    });
    const feature = createNoteFeature(harness([other]).deps);
    expect(
      await feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({ selector: books, rule: other });
    expect(await feature.resolveCreationProfile({ item: article })).toEqual({
      selector: "default",
      source: "bound",
      shouldAsk: true,
    });
  });

  it("keeps matching after a Collection rename and shows the new path", async () => {
    const drafts = rule({
      id: "drafts",
      expression: 'inCollection("personal", "DRFT0001")',
    });
    const { deps, client } = harness([drafts]);
    const feature = createNoteFeature(deps);
    client.$client.exec(
      "update collections set collectionName = 'Manuscripts' where collectionID = 101",
    );
    expect(
      await feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({ selector: books, rule: drafts });
    expect(
      listCollectionChoices(client, [
        { selector: { type: "personal" }, libraryID: 1, name: null },
      ]).map(({ key, path }) => [key, path.join(" / ")]),
    ).toEqual([
      ["OTHR0001", "Other"],
      ["PROJ0001", "Project"],
      ["DRFT0001", "Project / Manuscripts"],
    ]);
  });

  it("stops on a missing or trashed Collection reference instead of advancing to Default", async () => {
    const gone = rule({
      id: "gone",
      expression: 'inCollection("personal", "GONE0000")',
    });
    const drafts = rule({
      id: "drafts",
      expression: 'inCollection("personal", "DRFT0001")',
    });
    const catchAll = rule({ id: "catch-all", profile: "default" });
    const { deps, client } = harness([gone, catchAll]);
    const feature = createNoteFeature(deps);
    expect(
      await feature.resolveCreationProfile({ item: personalBook }),
    ).toEqual({
      selector: "default",
      source: "bound",
      shouldAsk: true,
      problem: {
        kind: "broken-rule",
        rule: gone,
        problem: {
          code: "missing-collection",
          library: { type: "personal" },
          key: "GONE0000",
        },
      },
    });
    // A reference to a Library this database lacks is just as unevaluable.
    deps.settings.update({
      "profile.selection-rules": [
        { ...gone, expression: 'inCollection("group:999", "PROJ0001")' },
        catchAll,
      ],
    });
    expect(
      await feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({
      problem: {
        kind: "broken-rule",
        problem: {
          code: "missing-collection",
          library: { type: "group", groupID: 999 },
        },
      },
    });
    // Drafts matches until Zotero trashes it; then the rule is broken, not
    // a nonmatch that the catch-all would quietly absorb.
    deps.settings.update({ "profile.selection-rules": [drafts, catchAll] });
    expect(
      await feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({ selector: books, rule: drafts });
    client.$client.exec(
      "insert into deletedCollections (collectionID) values (101)",
    );
    expect(
      await feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({
      selector: "default",
      problem: {
        kind: "broken-rule",
        rule: drafts,
        problem: { code: "missing-collection", key: "DRFT0001" },
      },
    });
  });

  it("matches Tag names exactly and case-sensitively across manual and automatic applications", async () => {
    const read = rule({ id: "read", expression: 'hasTag("Read")' });
    const upper = rule({
      id: "upper",
      expression: 'hasTag("READ")',
      profile: papers,
    });
    const lower = rule({
      id: "lower",
      expression: 'hasTag("read")',
      profile: "default",
    });
    const auto = rule({ id: "auto", expression: 'hasTag("auto-tag")' });
    const { deps } = harness([lower, upper, read]);
    const feature = createNoteFeature(deps);
    // "read" matches nothing; the automatic "READ" wins before manual "Read".
    expect(
      await feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({ selector: papers, rule: upper });
    deps.settings.update({ "profile.selection-rules": [lower, read] });
    expect(
      await feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({ selector: books, rule: read });
    deps.settings.update({ "profile.selection-rules": [lower, auto] });
    expect(
      await feature.resolveCreationProfile({ item: article }),
    ).toMatchObject({ selector: books, rule: auto });
    expect(
      await feature.resolveCreationProfile({ item: personalBook }),
    ).toEqual({ selector: "default", source: "bound", shouldAsk: true });
  });

  it("combines Collection and Tag conditions with the item type and the Library scope", async () => {
    const combined = rule({
      id: "combined",
      scope: { mode: "selected", libraries: [{ type: "personal" }] },
      expression:
        'inCollection("personal", "PROJ0001") && hasTag("Read") && itemType == "book"',
    });
    const anyProject = rule({
      id: "any-project",
      expression:
        'inCollection("personal", "PROJ0001") || inCollection("group:118", "PROJ0001")',
      profile: papers,
    });
    const feature = createNoteFeature(harness([combined, anyProject]).deps);
    expect(
      await feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({ selector: books, rule: combined });
    expect(
      await feature.resolveCreationProfile({ item: article }),
    ).toMatchObject({ selector: papers, rule: anyProject });
    expect(
      await feature.resolveCreationProfile({ item: groupBook }),
    ).toMatchObject({ selector: papers, rule: anyProject });
  });

  it("keeps a previewed selection fixed while Tags and memberships change, and lets the next operation see the change", async () => {
    const read = rule({
      id: "read",
      expression: 'hasTag("Read") && inCollection("personal", "OTHR0001")',
    });
    const { deps, client, vault } = harness([read]);
    const feature = createNoteFeature(deps);
    expect(
      await feature.resolveCreationProfile({ item: personalBook }),
    ).toMatchObject({ selector: books, source: "rule", rule: read });
    const previews = await feature.prepareCreationProfiles(personalBook);
    const preview = previews.find(({ selector }) => selector === books)!;
    expect(preview.path).toBe("Reading/BOOK0001.md");
    // Zotero removes the Tag and the membership after the preview.
    client.$client.exec(`
      delete from itemTags where itemID = 1 and tagID = 1;
      delete from collectionItems where itemID = 1 and collectionID = 102;
    `);
    await expect(preview.create()).resolves.toMatchObject({
      outcome: "created",
      file: { path: "Reading/BOOK0001.md" },
    });
    expect(vault.get("Reading/BOOK0001.md")).toContain(
      `${FIELD_LITERATURE_NOTE_PROFILE}: Books (${books})`,
    );
    // The next operation reads the changed rows: no match, so Default.
    expect(
      await feature.resolveCreationProfile({ item: personalBook }),
    ).toEqual({ selector: "default", source: "bound", shouldAsk: true });
    // The existing note keeps its recorded membership; nothing recreates it.
    await expect(
      feature.createNote(personalBook, { profile: "default" }),
    ).resolves.toMatchObject({
      outcome: "refused",
      diagnostic: { code: "literature-note-exists" },
    });
    expect(vault.get("Reading/BOOK0001.md")).toContain(
      `${FIELD_LITERATURE_NOTE_PROFILE}: Books (${books})`,
    );
    expect(vault.size).toBe(1);
  });
});
