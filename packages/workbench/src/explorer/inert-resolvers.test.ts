import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CollectionCache,
  fetchNoteContext,
  getItemsByKey,
  USER_LIBRARY_ID,
} from "@zotlit/db";
import type { Annotation, Attachment, ChildNote } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import { attachmentAbsPath, resolveAnnotCachePath } from "@zotlit/db/path";
import { createFixtureSchema } from "@zotlit/db/test-utils";

import { inertPlaceholderReason } from "./inert-placeholder";
import { buildInertNoteResolvers } from "./inert-resolvers";
import type { InertNoteResolverDeps } from "./inert-resolvers";

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
    tags: [],
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
    createdByUserID: null,
    parentItemID: 10,
    parentKey: "ATCH2345",
    ...overrides,
    version: overrides.version ?? 0,
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
  return buildInertNoteResolvers(makeResolverDeps(overrides));
}

function makeResolverDeps(
  overrides?: Partial<InertNoteResolverDeps>,
): InertNoteResolverDeps {
  const fileManager = makeFakeFileManager();
  const vault = makeFakeVault();
  const pathContext = { dataDir: "/data", baseAttachmentPath: null };
  return {
    noteIndex: makeFakeNoteIndex(),
    getFileByPath: vault.getFileByPath,
    generateMarkdownLink: ({ file, sourcePath, subpath, alias }) =>
      fileManager.generateMarkdownLink(file, sourcePath, subpath, alias),
    sourcePath: "",
    excerptImages: { kind: "file-url" },
    notImportedReason: () => "Not imported",
    attachmentAbsPath: (attachment) =>
      attachmentAbsPath(attachment, pathContext),
    attachmentFileLink: (attachment, anchor) => {
      const absPath = attachmentAbsPath(attachment, pathContext);
      if (!absPath) return () => null;
      const defaultAlias = basename(absPath) || "attachment";
      const defaultSubpath = anchor?.page == null ? "" : `#page=${anchor.page}`;
      const href = pathToFileURL(absPath).href;
      return (alias = defaultAlias, subpath = defaultSubpath) =>
        `[${alias}](${href}${subpath})`;
    },
    annotationCachePath: (annotation) =>
      resolveAnnotCachePath(annotation, {
        dataDir: pathContext.dataDir,
        groupID: annotation.groupID,
      }),
    commentToMarkdown: (html) => (html === "<b>hi</b>" ? "**hi**" : html),
    authorsShort: () => "Host author summary",
    fileUrlLink: (absPath, defaultAlias) => {
      const href = pathToFileURL(absPath).href;
      return (alias = defaultAlias, subpath = "") =>
        `[${alias}](${href}${subpath})`;
    },
    normalizeVaultPath: (path) => path,
    ...overrides,
  };
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
    const link = resolvers.annotation.fileLink(attachment, { page: 5 })();
    expect(link).toContain("#page=5");
    expect(link).toContain("paper.pdf");
    expect(link).toBe(
      "[paper.pdf](file:///data/storage/ATCH2345/paper.pdf#page=5)",
    );
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
        getFileByPath: makeFakeVault([VAULT_IMAGE_PATH]).getFileByPath,
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
        getFileByPath: makeFakeVault().getFileByPath,
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

    it("links a child note that isn't imported to Zotero", () => {
      const resolvers = buildResolvers();
      const unimported: ChildNote = {
        ...childNote,
        key: "NOTE9999",
        indexedKey: "NOTE9999",
      };
      const result = resolvers.resolveChildNote?.(unimported);
      expect(inertPlaceholderReason(result?.noteLink)).toBeUndefined();
      expect(result?.noteLink()).toBe(
        "[Methods](zotero://select/library/items/NOTE9999)",
      );
    });
  });
});

// Build the note-root context from the db-package test fixture schema,
// check its resolved values, and browse every property/getter/helper it exposes.
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

    const noteIndex = {
      getNotesByItemKey: (indexedKey: string) => {
        return indexedKey === MAIN_KEY
          ? [{ path: MAIN_NOTE_PATH } as never]
          : [];
      },
      getImportedNoteByNoteKey: (_noteKey: string) => {
        return [];
      },
    };
    const vault = {
      getFileByPath: (_path: string) => {
        return null;
      },
    };
    const fileManager = {
      generateMarkdownLink: (...args: unknown[]) => {
        return makeFakeFileManager().generateMarkdownLink(...args);
      },
    };

    const resolvers = buildInertNoteResolvers(
      makeResolverDeps({
        noteIndex,
        generateMarkdownLink: ({ file, sourcePath, subpath, alias }) =>
          fileManager.generateMarkdownLink(file, sourcePath, subpath, alias),
        getFileByPath: vault.getFileByPath,
        sourcePath: MAIN_NOTE_PATH,
        // Excerpt images are not imported for this item, so the excerpt-image
        // helper must resolve to the inert placeholder rather than minting a
        // vault path.
        excerptImages: { kind: "not-imported" },
      }),
    );

    const [main] = getItemsByKey(client, [MAIN_KEY], {
      libraryID: USER_LIBRARY_ID,
    });
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
    expect(inertPlaceholderReason(childNote.noteLink)).toBeUndefined();
    expect(childNote.noteLink()).toBe(
      `[Methods](zotero://select/library/items/${CHILD_NOTE_KEY})`,
    );

    fullyWalk(ctx, new WeakSet());

    (client.$client as DatabaseSync).close();
  });
});
