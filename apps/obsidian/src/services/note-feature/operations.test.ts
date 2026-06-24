import { type FileManager, TFile, TFolder, type App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  getAnnotationsByParent,
  getAttachmentsByParents,
  getItemsByKey,
  getRelatedKeysByItemID,
  getTagsByItemIDs,
  type BaseItem,
  type Item,
} from "@zotlit/db";
import { Temporal } from "@zotlit/shared/temporal";
import { filenameSuffix } from "@zotlit/templates";
import { type ItemFields } from "@zotlit/zotero-types";

import { type SettingsService } from "@/services/settings/service";
import { type TemplateService } from "@/services/template/service";

import { type NoteFeatureContext } from "./context";
import { createNote } from "./operations";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    getAnnotationsByParent: vi.fn(() => []),
    getAttachmentsByParents: vi.fn(() => []),
    getItemsByKey: vi.fn(() => []),
    getRelatedKeysByItemID: vi.fn(() => []),
    getTagsByItemIDs: vi.fn(() => []),
    // The mock DB client can't run real queries; stub the cache to resolve no
    // collections so the note-feature flow under test stays DB-free.
    CollectionCache: class {
      byItemIDs() {
        return new Map();
      }
      byItemIDsAsync() {
        return Promise.resolve(new Map());
      }
    },
  };
});

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

    vi.mocked(getAttachmentsByParents).mockReturnValue([]);
    vi.mocked(getAnnotationsByParent).mockReturnValue([]);
    vi.mocked(getRelatedKeysByItemID).mockReturnValue([
      byItemKey.key,
      byCitekey.key,
      fallback.key,
    ]);
    vi.mocked(getItemsByKey).mockReturnValue([byItemKey, byCitekey, fallback]);
    vi.mocked(getTagsByItemIDs).mockReturnValue([]);

    const existingByItemKey = makeFile("Notes/Existing by item.md");
    const existingByCitekey = makeFile("Notes/Existing by citekey.md");
    const app = makeApp();
    const ctx: NoteFeatureContext = {
      app: app as unknown as App,
      template: makeTemplate() as unknown as TemplateService,
      db: { client: {}, state: "ready", ready: Promise.resolve() } as any,
      noteIndex: {
        ready: Promise.resolve(),
        getNotesByItemKey: (key: string) =>
          key === byItemKey.indexedKey ? [existingByItemKey] : [],
        getNotesByCitekey: (citekey: string) =>
          citekey === "relcite2024" ? [existingByCitekey] : [],
      } as any,
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null } as any,
      settings: makeSettings() as unknown as SettingsService,
      attachmentImport: {
        prepare: vi.fn(async () => ({
          resolveLink: () => () => "",
          flush: vi.fn(async () => ({ copied: 0, skipped: 0 })),
        })),
      } as any,
    };

    const file = await createNote(ctx, root);

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

    vi.mocked(getAttachmentsByParents).mockReturnValue([]);
    vi.mocked(getRelatedKeysByItemID).mockReturnValue([]);
    vi.mocked(getItemsByKey).mockReturnValue([]);
    vi.mocked(getTagsByItemIDs).mockReturnValue([]);

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

    const template = {
      frontmatterFields: [],
      renderFilename: (data: { title: string | null; key: string }) =>
        `${data.title ?? data.key}${filenameSuffix()}`,
      render: () => "body",
    };

    const ctx: NoteFeatureContext = {
      app: {
        vault: {
          getAbstractFileByPath: (path: string) =>
            path === "Literature" ? literature : null,
          getRoot: () => root,
          createFolder: vi.fn(),
          create,
        },
        fileManager: { generateMarkdownLink: () => "" },
      } as unknown as App,
      template: template as unknown as TemplateService,
      db: { client: {}, state: "ready", ready: Promise.resolve() } as any,
      noteIndex: {
        ready: Promise.resolve(),
        getNotesByItemKey: () => [],
        getNotesByCitekey: () => [],
      } as any,
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null } as any,
      settings: makeSettings() as unknown as SettingsService,
      attachmentImport: {
        prepare: vi.fn(async () => ({
          resolveLink: () => () => "",
          flush: vi.fn(async () => ({ copied: 0, skipped: 0 })),
        })),
      } as any,
    };

    const file = await createNote(ctx, item);

    expect(file.path).toMatch(/^Literature\/Root_[\w-]{6}\.md$/);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

function makeTemplate() {
  return {
    frontmatterFields: [],
    renderFilename(data: { title: string | null; key: string }): string {
      return data.title ?? data.key;
    },
    render(
      _name: string,
      data: {
        title: string | null;
        relatedItems: readonly {
          title: string | null;
          notePath: string;
          noteLink(alias?: string): string;
        }[];
        notePath: string;
        noteLink(alias?: string): string;
      },
    ): string {
      return [
        `root:${data.notePath}|${data.noteLink("Root alias")}`,
        ...data.relatedItems.map(
          (item) =>
            `${item.title}:${item.notePath}|${item.noteLink(item.title ?? undefined)}`,
        ),
      ].join("\n");
    },
  };
}

function makeSettings() {
  return {
    current: {
      "note.literature-folder": "Literature",
      "note.frontmatter-fields": [],
    },
    loaded: Promise.resolve({
      "note.literature-folder": "Literature",
      "note.frontmatter-fields": [],
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
  };
  fileManager: {
    links: { path: string; sourcePath: string; alias: string | undefined }[];
    generateMarkdownLink: FileManager["generateMarkdownLink"];
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
