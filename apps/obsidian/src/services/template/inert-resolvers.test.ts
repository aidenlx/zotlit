// @vitest-environment happy-dom
import type { DatabaseSync } from "node:sqlite";
import TurndownService from "turndown";
import { describe, expect, it } from "vitest";

import {
  CollectionCache,
  fetchNoteContext,
  getItemsByKey,
  itemBaseFields,
  resolveVenue,
  USER_LIBRARY_ID,
} from "@zotlit/db";
import type {
  Annotation,
  Attachment,
  BaseItem,
  ChildNote,
  Item,
} from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import type { ItemFields } from "@zotlit/zotero-types";

import { creatorSummary } from "@/lib/item-summary";
import { defaults as settingsDefaults } from "@/services/settings/schema";

import { inertPlaceholderReason } from "./inert-placeholder";
import {
  buildInertNoteResolvers,
  resolveExcerptImageContext,
} from "./inert-resolvers";
import type {
  ExcerptImageContext,
  InertNoteResolverDeps,
} from "./inert-resolvers";

function makeItem(
  fields: { itemType: string } & Record<string, string | null>,
  base?: Partial<BaseItem> & Pick<Partial<Item>, "groupID">,
): Item {
  const baseFields = itemBaseFields(fields as ItemFields);
  return {
    itemID: 1,
    libraryID: USER_LIBRARY_ID,
    key: "ITEM2345",
    indexedKey: "ITEM2345",
    dateAdded: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    creators: [],
    primaryCreatorType: "author",
    customFields: new Map(),
    groupID: null,
    ...base,
    fields: fields as ItemFields,
    baseFields,
    venue: resolveVenue(baseFields),
  };
}

function makeAttachment(overrides: Partial<Attachment>): Attachment {
  return {
    itemID: 10,
    libraryID: USER_LIBRARY_ID,
    groupID: null,
    key: "ATCH2345",
    indexedKey: "ATCH2345",
    parentItemID: 1,
    path: "storage:paper.pdf",
    contentType: "application/pdf",
    linkMode: 0,
    dateAdded: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeAnnotation(overrides: Partial<Annotation>): Annotation {
  return {
    itemID: 100,
    key: "ANNO0001",
    indexedKey: "ANNO0001",
    libraryID: USER_LIBRARY_ID,
    groupID: null,
    dateAdded: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    type: 1, // highlight — no cache image
    text: "excerpt",
    comment: null,
    color: "#ffd400",
    pageLabel: "5",
    sortIndex: "0",
    position: { pageIndex: 0, rects: [] },
    authorName: null,
    isExternal: false,
    parentItemID: 10,
    parentKey: "ATCH2345",
    ...overrides,
  };
}

const INDEXED_KEY = "ITEM2345";
const NOTE_PATH = "Literature/Smith 2024.md";
const IMPORTED_NOTE_KEY = "NOTE1234";
const IMPORTED_NOTE_PATH = "Zotero Notes/Methods.md";
const VAULT_FOLDER = "attachments/zotero";
const VAULT_IMAGE_PATH = `${VAULT_FOLDER}/ANNO0001.png`;

function makeFakeNoteIndex() {
  const stubFile = { path: NOTE_PATH } as never;
  const importedFile = { path: IMPORTED_NOTE_PATH } as never;
  return {
    getNotesByItemKey: (indexedKey: string) =>
      indexedKey === INDEXED_KEY ? [stubFile] : [],
    getImportedNoteByNoteKey: (noteKey: string) =>
      noteKey === IMPORTED_NOTE_KEY ? [importedFile] : [],
  };
}

function makeFakeFileManager() {
  return {
    // Mirrors Obsidian's (file, sourcePath, subpath, alias) signature.
    generateMarkdownLink: (...args: unknown[]) => {
      const file = args[0] as { path: string };
      const sourcePath = args[1] as string;
      const alias = args[3] as string | undefined;
      return `[[${file.path}|${alias ?? ""}]]<-${sourcePath}`;
    },
  };
}

function makeFakeVault(existingPaths: readonly string[] = []) {
  return {
    getFileByPath: (path: string) =>
      existingPaths.includes(path) ? ({ path } as never) : null,
  };
}

function buildResolvers(overrides?: Partial<InertNoteResolverDeps>) {
  return buildInertNoteResolvers({
    noteIndex: makeFakeNoteIndex(),
    fileManager: makeFakeFileManager(),
    vault: makeFakeVault(),
    zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
    Turndown: TurndownService,
    sourcePath: "",
    excerptImages: { kind: "file-url" },
    ...overrides,
  });
}

describe("buildInertNoteResolvers", () => {
  it("resolves an attachment's absolute file path for real", () => {
    const resolvers = buildResolvers();
    const attachment = makeAttachment({ path: "storage:paper.pdf" });
    expect(resolvers.annotation.filePath(attachment)).toBe(
      "/data/storage/ATCH2345/paper.pdf",
    );
  });

  it("renders a real file:// markdown link anchored to the annotation page", () => {
    const resolvers = buildResolvers();
    const attachment = makeAttachment({ path: "storage:paper.pdf" });
    const link = resolvers.annotation.fileLink(attachment, 5)();
    expect(link).toContain("#page=5");
    expect(link).toContain("paper.pdf");
    expect(link).toBe(
      "[paper.pdf](file:///data/storage/ATCH2345/paper.pdf#page=5)",
    );
  });

  it("converts comment HTML through the real turndown conversion", () => {
    const resolvers = buildResolvers();
    expect(resolvers.annotation.commentToMarkdown("<b>hi</b>")).toBe("**hi**");
  });

  it("resolves notePath from an already-indexed note, null otherwise", () => {
    const resolvers = buildResolvers();
    expect(
      resolvers.item.notePath({
        indexedKey: INDEXED_KEY,
        citationKey: null,
      } as never),
    ).toBe(NOTE_PATH);
    expect(
      resolvers.item.notePath({
        indexedKey: "UNKNOWN1",
        citationKey: null,
      } as never),
    ).toBeNull();
  });

  it("resolves noteLink from an already-indexed note, null otherwise", () => {
    const resolvers = buildResolvers();
    expect(
      resolvers.item.noteLink(
        { indexedKey: INDEXED_KEY, citationKey: null } as never,
        "Alias",
      ),
    ).toBe(`[[${NOTE_PATH}|Alias]]<-`);
    expect(
      resolvers.item.noteLink({
        indexedKey: "UNKNOWN1",
        citationKey: null,
      } as never),
    ).toBeNull();
  });

  it("does not treat a matching citation key as note identity", () => {
    const resolvers = buildResolvers();
    expect(
      resolvers.item.notePath({
        indexedKey: "UNKNOWN1",
        citationKey: "smith2024",
      } as never),
    ).toBeNull();
  });

  it("delegates authorsShort to the real creatorSummary helper", () => {
    const resolvers = buildResolvers();
    const item = makeItem(
      { itemType: "journalArticle", title: "A Study" },
      {
        creators: [
          {
            firstName: "Jane",
            lastName: "Smith",
            creatorType: "author",
            fieldMode: 0,
          },
        ],
      },
    );
    expect(resolvers.item.authorsShort(item)).toBe(creatorSummary(item));
  });

  describe("annotationImageLink", () => {
    it("returns null for a non-image annotation type", () => {
      const resolvers = buildResolvers();
      const highlightAnnotation = makeAnnotation({ type: 1 }); // "highlight"
      expect(
        resolvers.annotation.annotationImageLink(highlightAnnotation),
      ).toBeNull();
    });

    it("evaluates to a real file:// link when attachment import is disabled", () => {
      const resolvers = buildResolvers({ excerptImages: { kind: "file-url" } });
      const imageAnnotation = makeAnnotation({ type: 3 }); // "image"
      const link = resolvers.annotation.annotationImageLink(imageAnnotation);
      expect(link).not.toBeNull();
      expect(inertPlaceholderReason(link)).toBeUndefined();
      expect(link?.()).toBe(
        "[ANNO0001.png](file:///data/cache/library/ANNO0001.png)",
      );
    });

    it("links through generateMarkdownLink when the vault image already exists", () => {
      const resolvers = buildResolvers({
        vault: makeFakeVault([VAULT_IMAGE_PATH]),
        sourcePath: NOTE_PATH,
        excerptImages: { kind: "vault", folderPath: VAULT_FOLDER },
      });
      const imageAnnotation = makeAnnotation({ type: 3 });
      const link = resolvers.annotation.annotationImageLink(imageAnnotation);
      expect(link).not.toBeNull();
      expect(inertPlaceholderReason(link)).toBeUndefined();
      expect(link?.()).toBe(`[[${VAULT_IMAGE_PATH}|]]<-${NOTE_PATH}`);
    });

    it("returns a branded placeholder when the vault image does not exist", () => {
      const resolvers = buildResolvers({
        vault: makeFakeVault(),
        excerptImages: { kind: "vault", folderPath: VAULT_FOLDER },
      });
      const imageAnnotation = makeAnnotation({ type: 3 });
      const link = resolvers.annotation.annotationImageLink(imageAnnotation);
      expect(link).not.toBeNull();
      expect(inertPlaceholderReason(link)).toBe("Not imported");
      expect(link?.()).toBe("");
    });

    it("returns a branded placeholder when the literature note isn't imported", () => {
      const resolvers = buildResolvers({
        excerptImages: { kind: "not-imported" },
      });
      const imageAnnotation = makeAnnotation({ type: 3 });
      const link = resolvers.annotation.annotationImageLink(imageAnnotation);
      expect(link).not.toBeNull();
      expect(inertPlaceholderReason(link)).toBe("Not imported");
      expect(link?.()).toBe("");
    });
  });

  describe("resolveChildNote", () => {
    const childNote: ChildNote = {
      itemID: 200,
      libraryID: USER_LIBRARY_ID,
      groupID: null,
      parentItemID: 1,
      key: IMPORTED_NOTE_KEY,
      indexedKey: IMPORTED_NOTE_KEY,
      title: "Methods",
      dateModified: Temporal.Instant.from("2024-01-02T00:00:00Z"),
    };

    it("links through generateMarkdownLink with the note title as default alias when already imported", () => {
      const resolvers = buildResolvers({ sourcePath: NOTE_PATH });
      const result = resolvers.resolveChildNote?.(childNote);
      expect(result?.key).toBe(IMPORTED_NOTE_KEY);
      expect(result?.title).toBe("Methods");
      expect(inertPlaceholderReason(result?.noteLink)).toBeUndefined();
      expect(result?.noteLink()).toBe(
        `[[${IMPORTED_NOTE_PATH}|Methods]]<-${NOTE_PATH}`,
      );
    });

    it("returns a branded placeholder when the child note isn't imported", () => {
      const resolvers = buildResolvers();
      const unimported: ChildNote = {
        ...childNote,
        key: "NOTE9999",
        indexedKey: "NOTE9999",
      };
      const result = resolvers.resolveChildNote?.(unimported);
      expect(inertPlaceholderReason(result?.noteLink)).toBe("Not imported");
      expect(result?.noteLink()).toBe("");
    });
  });
});

describe("resolveExcerptImageContext", () => {
  it("resolves to file-url when attachment import is disabled", async () => {
    const context = await resolveExcerptImageContext({
      app: {} as never,
      settings: { ...settingsDefaults, "attachment.import": false },
      litNotePath: NOTE_PATH,
    });
    expect(context).toEqual<ExcerptImageContext>({ kind: "file-url" });
  });

  it("resolves to not-imported when import is enabled, no explicit folder is set, and no literature note exists", async () => {
    const context = await resolveExcerptImageContext({
      app: {} as never,
      settings: { ...settingsDefaults, "attachment.import": true },
      litNotePath: null,
    });
    expect(context).toEqual<ExcerptImageContext>({ kind: "not-imported" });
  });

  it("resolves to vault with the explicit folder path even without a literature note", async () => {
    // An explicit attachment.folder-path is deterministic regardless of any
    // note path, so an already-imported excerpt image should still resolve.
    const context = await resolveExcerptImageContext({
      app: {} as never,
      settings: {
        ...settingsDefaults,
        "attachment.import": true,
        "attachment.folder-path": VAULT_FOLDER,
      },
      litNotePath: null,
    });
    expect(context).toEqual<ExcerptImageContext>({
      kind: "vault",
      folderPath: VAULT_FOLDER,
    });
  });

  it("resolves to vault with the configured folder path when a literature note exists", async () => {
    // With an explicit folder path, resolveAttachmentFolderPath never touches
    // `app`, so a minimal stub is sufficient here.
    const context = await resolveExcerptImageContext({
      app: {} as never,
      settings: {
        ...settingsDefaults,
        "attachment.import": true,
        "attachment.folder-path": VAULT_FOLDER,
      },
      litNotePath: NOTE_PATH,
    });
    expect(context).toEqual<ExcerptImageContext>({
      kind: "vault",
      folderPath: VAULT_FOLDER,
    });
  });
});

// ADR-0005 guarantee: full-browse zero-write test. Building resolvers and
// evaluating every helper — including an unimported child note and an
// unimported excerpt image — must only read (noteIndex lookups, vault file
// existence checks, generateMarkdownLink renders), never queue an import or
// mint a new vault path.
describe("buildInertNoteResolvers — full browse queues no vault write (ADR 0005)", () => {
  it("records only read/render calls across a full evaluation", () => {
    const callLog: string[] = [];

    const recordingNoteIndex = {
      getNotesByItemKey: (indexedKey: string) => {
        callLog.push("noteIndex.getNotesByItemKey");
        return indexedKey === INDEXED_KEY ? [{ path: NOTE_PATH } as never] : [];
      },
      getImportedNoteByNoteKey: (_noteKey: string) => {
        callLog.push("noteIndex.getImportedNoteByNoteKey");
        return [];
      },
    };
    const recordingVault = {
      getFileByPath: (_path: string) => {
        callLog.push("vault.getFileByPath");
        return null;
      },
    };
    const recordingFileManager = {
      generateMarkdownLink: (...args: unknown[]) => {
        callLog.push("fileManager.generateMarkdownLink");
        return makeFakeFileManager().generateMarkdownLink(...args);
      },
    };

    const resolvers = buildInertNoteResolvers({
      noteIndex: recordingNoteIndex,
      fileManager: recordingFileManager,
      vault: recordingVault,
      zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
      Turndown: TurndownService,
      sourcePath: NOTE_PATH,
      excerptImages: { kind: "vault", folderPath: VAULT_FOLDER },
    });

    const item = makeItem({ itemType: "journalArticle", title: "A Study" });
    const attachment = makeAttachment({});
    const imageAnnotation = makeAnnotation({ type: 3 });
    const childNote: ChildNote = {
      itemID: 200,
      libraryID: USER_LIBRARY_ID,
      groupID: null,
      parentItemID: 1,
      key: "NOTE9999",
      indexedKey: "NOTE9999",
      title: "Methods",
      dateModified: Temporal.Instant.from("2024-01-02T00:00:00Z"),
    };

    resolvers.annotation.filePath(attachment);
    resolvers.annotation.fileLink(attachment, 1)();
    const imageLink = resolvers.annotation.annotationImageLink(imageAnnotation);
    imageLink?.();
    resolvers.item.notePath({
      indexedKey: item.indexedKey,
      citationKey: null,
    } as never);
    resolvers.item.noteLink({
      indexedKey: item.indexedKey,
      citationKey: null,
    } as never);
    resolvers.resolveChildNote?.(childNote).noteLink();

    // The recording fakes above expose only reads/renders (getNotesByItemKey,
    // getImportedNoteByNoteKey, vault.getFileByPath,
    // fileManager.generateMarkdownLink) — no queue/create/mint surface exists
    // for the resolvers to call, so a full browse cannot invoke one.
    expect(callLog).toEqual([
      "vault.getFileByPath",
      "noteIndex.getNotesByItemKey",
      "noteIndex.getNotesByItemKey",
      "fileManager.generateMarkdownLink",
      "noteIndex.getImportedNoteByNoteKey",
    ]);
  });
});

// ADR-0005 guarantee, exercised over a real `fetchNoteContext` tree instead of
// hand-built objects: build the note-root context from the db-package test
// fixture schema, browse every property/getter/helper it exposes, and assert
// the recording fakes never see an import/queue call.
describe("buildInertNoteResolvers over a real fetchNoteContext tree", () => {
  const MAIN_KEY = "FULL0001";
  const MAIN_NOTE_PATH = "Literature/Full Context Study.md";
  const CHILD_NOTE_KEY = "NOTE9999";

  function seedFullContext(sqlite: DatabaseSync): void {
    createFixtureSchema(sqlite);
    sqlite.exec(`
      insert into libraries (libraryID, type, editable, filesEditable)
        values (1, 'user', 1, 1);

      insert into itemTypes (itemTypeID, typeName)
        values (1, 'journalArticle'), (2, 'attachment'), (3, 'note'), (4, 'annotation');

      insert into fieldsCombined (fieldID, fieldName, custom)
        values (10, 'title', 0);

      insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
        values
          (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, '${MAIN_KEY}'),
          (10, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATCH0001'),
          (100, 4, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ANNO0001'),
          (200, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, '${CHILD_NOTE_KEY}');

      insert into itemDataValues (valueID, value) values (1, 'A Full Context Study');
      insert into itemData (itemID, fieldID, valueID) values (1, 10, 1);

      insert into creators (creatorID, firstName, lastName, fieldMode)
        values (1, 'Jane', 'Smith', 0);
      insert into creatorTypes (creatorTypeID, creatorType) values (1, 'author');
      insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex)
        values (1, 1, 1, 0);

      insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
        values (10, 1, 0, 'application/pdf', 'storage:paper.pdf');

      insert into itemAnnotations (
        itemID, parentItemID, type, authorName, text, comment, color, pageLabel,
        sortIndex, position, isExternal
      ) values (
        100, 10, 3, null, 'excerpt text', '<i>note</i>', '#ffd400', '5',
        '00000|000004|00000', '{"pageIndex":4,"rects":[[0,0,1,1]]}', 0
      );

      insert into itemNotes (itemID, parentItemID, note, title)
        values (200, 1, '<p>body</p>', 'Methods');
    `);
  }

  /**
   * Recursively reads every enumerable own property (invoking getters) and,
   * for zero-required-arg function members (the `noteLink`/`fileLink`/`imgLink`
   * helpers the display layer evaluates the same way — see
   * `display-tree.ts#evaluateHelper`), calls them and walks their result too.
   * A `visited` guard stops the walk from looping on the annotation ->
   * `parentItem` back-reference to the tree root.
   */
  function fullyWalk(value: unknown, visited: WeakSet<object>): void {
    if (value === null || value === undefined) return;
    if (typeof value === "function") {
      let result: unknown;
      try {
        result = (value as (...args: never[]) => unknown)();
      } catch {
        return;
      }
      fullyWalk(result, visited);
      return;
    }
    if (typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);
    for (const key of Object.keys(value)) {
      const desc = Object.getOwnPropertyDescriptor(value, key)!;
      const child = desc.get ? desc.get.call(value) : desc.value;
      fullyWalk(child, visited);
    }
  }

  it("browses the full tree read-only and resolves both real and inert values correctly", () => {
    const client = createClient(":memory:");
    seedFullContext(client.$client as DatabaseSync);

    const callLog: string[] = [];
    const recordingNoteIndex = {
      getNotesByItemKey: (indexedKey: string) => {
        callLog.push("noteIndex.getNotesByItemKey");
        return indexedKey === MAIN_KEY
          ? [{ path: MAIN_NOTE_PATH } as never]
          : [];
      },
      getImportedNoteByNoteKey: (_noteKey: string) => {
        callLog.push("noteIndex.getImportedNoteByNoteKey");
        return [];
      },
    };
    const recordingVault = {
      getFileByPath: (_path: string) => {
        callLog.push("vault.getFileByPath");
        return null;
      },
    };
    const recordingFileManager = {
      generateMarkdownLink: (...args: unknown[]) => {
        callLog.push("fileManager.generateMarkdownLink");
        return makeFakeFileManager().generateMarkdownLink(...args);
      },
    };

    const resolvers = buildInertNoteResolvers({
      noteIndex: recordingNoteIndex,
      fileManager: recordingFileManager,
      vault: recordingVault,
      zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
      Turndown: TurndownService,
      sourcePath: MAIN_NOTE_PATH,
      // Excerpt images are not imported for this item, so the excerpt-image
      // helper must resolve to the inert placeholder rather than minting a
      // vault path.
      excerptImages: { kind: "not-imported" },
    });

    const [main] = getItemsByKey(client, USER_LIBRARY_ID, [MAIN_KEY]);
    expect(main).toBeDefined();

    const ctx = fetchNoteContext(client, main!, {
      resolvers,
      collectionCache: new CollectionCache(),
      username: null,
    });

    // Spot-check evaluated values before the full browse.
    expect(ctx.notePath).toBe(MAIN_NOTE_PATH);
    expect(ctx.noteLink()).toContain(MAIN_NOTE_PATH);
    expect(ctx.attachments).toHaveLength(1);
    expect(ctx.annotations).toHaveLength(1);
    const annotation = ctx.annotations[0]!;
    expect(annotation.page).toBe(5);
    expect(inertPlaceholderReason(annotation.imgLink)).toBe("Not imported");
    expect(annotation.imgLink?.()).toBe("");
    expect(ctx.notes).toHaveLength(1);
    const childNote = ctx.notes[0]!;
    expect(childNote.key).toBe(CHILD_NOTE_KEY);
    expect(inertPlaceholderReason(childNote.noteLink)).toBe("Not imported");
    expect(childNote.noteLink()).toBe("");

    callLog.length = 0;
    fullyWalk(ctx, new WeakSet());

    // The recording fakes above expose only reads/renders — no queue/create/
    // mint surface exists for the resolvers to call, so a full browse cannot
    // invoke one; every recorded call is a read or a render.
    expect(callLog.length).toBeGreaterThan(0);
    for (const call of callLog) {
      expect(call).toMatch(
        /^(noteIndex\.(getNotesByItemKey|getImportedNoteByNoteKey)|vault\.getFileByPath|fileManager\.generateMarkdownLink)$/,
      );
    }

    (client.$client as DatabaseSync).close();
  });
});
