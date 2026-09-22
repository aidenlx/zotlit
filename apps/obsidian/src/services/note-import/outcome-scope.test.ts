// @vitest-environment happy-dom
// One initiating import batch reusing one retention, through the real writer.
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { FileSystemAdapter, TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import Turndown from "turndown";
import { expect, it, vi } from "vitest";

import { getNoteByKey } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";
import annotationTemplate from "@zotlit/templates/defaults/annotation.liquid?raw";
import { TemplateFacade } from "@zotlit/templates/facade";

import { AttachmentImportService } from "@/services/attachment-import/service";
import { bluePng } from "@/services/excerpt-image/__fixtures__/png";
import { PNG_FORMAT } from "@/services/excerpt-image/format";
import type { ExcerptImage } from "@/services/excerpt-image/format";
import { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";
import { createExcerptPreparation } from "@/services/excerpt-image/prepare";
import type { ExcerptSummary } from "@/services/excerpt-image/prepare";
import { ExcerptImageService } from "@/services/excerpt-image/service";
import type { ExcerptEntry } from "@/services/excerpt-image/service";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { defaults } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import { createNoteImporter } from "./service";

/** One paragraph naming the Shared Annotation both Child Notes quote. */
const paragraph = `<p><img data-attachment-key="SNAP2345" data-annotation="${encodeURIComponent(
  JSON.stringify({
    attachmentURI: "http://zotero.org/users/local/LOCAL/items/RGRPDF24",
    annotationKey: "FDRFQ7C2",
  }),
)}"></p>`;
const childNoteHtml = `<div data-schema-version="9">${paragraph}<p>Keep this prose.</p></div>`;

async function fixture(
  options: { failWrites?: boolean; unreadablePdf?: boolean } = {},
) {
  await using stack = new AsyncDisposableStack();
  const parent = join(
    await getWorkspaceRoot(import.meta.dirname),
    "tmp/outcome-scope-tests",
  );
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "run-"));
  stack.defer(() => rm(root, { recursive: true, force: true }));
  const vaultRoot = join(root, "vault");
  const dataDir = join(root, "zotero");
  await mkdir(vaultRoot);
  await mkdir(join(dataDir, "storage/SNAP2345"), { recursive: true });
  await writeFile(join(dataDir, "storage/SNAP2345/snapshot.png"), bluePng);

  const client = createClient(":memory:");
  stack.defer(() => client.$client.close());
  createFixtureSchema(client.$client);
  client.$client.exec(`
    insert into libraries (libraryID,type) values (1,'user');
    insert into items (itemID,itemTypeID,dateAdded,dateModified,libraryID,key) values
      (1,1,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'RUGIER24'),
      (2,2,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'RGRPDF24'),
      (3,4,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'FDRFQ7C2'),
      (5,3,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'NTES2345'),
      (6,3,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'NTES3456'),
      (7,2,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'SNAP2345');
    insert into itemAttachments (itemID,parentItemID,linkMode,contentType,path) values
      (2,1,0,'application/pdf','storage:paper.pdf'),
      (7,5,0,'image/png','storage:snapshot.png');
    insert into itemAnnotations (itemID,parentItemID,type,color,pageLabel,position) values
      (3,2,3,'#ffd400','1','{"pageIndex":0,"rects":[[0,0,10,10]]}');
    insert into itemNotes (itemID,parentItemID,title,note) values
      (5,1,'Quoted once',''),
      (6,1,'Quoted twice','');
  `);
  const statement = client.$client.prepare(
    "update itemNotes set note=? where itemID=?",
  );
  statement.run(childNoteHtml, 5);
  statement.run(childNoteHtml, 6);

  const files = new Map<string, TFile>();
  const folders = new Map<string, TFolder>();
  const register = (path: string) => {
    const file = Object.assign(new TFile(), { path });
    files.set(path, file);
    return file;
  };
  const app = {
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
    vault: {
      adapter: Object.assign(Object.create(FileSystemAdapter.prototype), {
        getFullPath: (path: string) => join(vaultRoot, path),
        reconcileInternalFile: async (path: string) => {
          register(path);
        },
      }),
      getRoot: () => Object.assign(new TFolder(), { path: "" }),
      getFileByPath: (path: string) => files.get(path) ?? null,
      getAbstractFileByPath: (path: string) =>
        files.get(path) ?? folders.get(path) ?? null,
      createFolder: async (path: string) => {
        await mkdir(join(vaultRoot, path), { recursive: true });
        const folder = Object.assign(new TFolder(), { path });
        folders.set(path, folder);
        return folder;
      },
      create: async (path: string, content: string) => {
        await mkdir(dirname(join(vaultRoot, path)), { recursive: true });
        await writeFile(join(vaultRoot, path), content);
        return register(path);
      },
      read: (file: TFile) => readFile(join(vaultRoot, file.path), "utf8"),
      process: async (file: TFile, edit: (content: string) => string) => {
        const content = edit(
          await readFile(join(vaultRoot, file.path), "utf8"),
        );
        await writeFile(join(vaultRoot, file.path), content);
        return content;
      },
    },
    metadataCache: {
      getFileCache: () => null,
      getFirstLinkpathDest: (path: string) => files.get(path) ?? null,
    },
    fileManager: {
      generateMarkdownLink: (file: TFile) => `![[${file.path}]]`,
    },
  } as unknown as App;
  const settings = {
    ...defaults,
    "attachment.import": true,
    "attachment.folder-path": "Images",
    "note.default-profile": {
      ...defaults["note.default-profile"],
      bindings: {
        ...defaults["note.default-profile"].bindings,
        "note.import-folder": "Imported",
        "note.import-annotations-as-template": true,
      },
    },
  };
  const paths = { dataDir, baseAttachmentPath: null };
  const attachments = stack.use(
    new AttachmentImportService({
      app,
      settings: {
        loaded: Promise.resolve(settings),
        subscribe: () => () => {},
      } as unknown as SettingsService,
      zoteroPref: { ...paths, on: () => () => {} },
    }),
  );
  await attachments.ready;

  const entries = new Map<string, ExcerptEntry>();
  const render = vi.fn(
    async (): Promise<ExcerptImage> => ({ bytes: bluePng, format: PNG_FORMAT }),
  );
  const service = stack.use(
    new ExcerptImageService({
      cache: {
        get: async (key) => entries.get(key),
        put: async (key, entry) => {
          if (options.failWrites) throw new Error("store write failed");
          entries.set(key, entry);
        },
      },
      stamp: options.unreadablePdf
        ? async () => {
            throw new Error("PDF freshness unavailable");
          }
        : async () => ({ size: 100, mtimeMs: 10 }),
      render,
      read: async () => bluePng,
    }),
  );
  const facade = new TemplateFacade();
  const renderAnnotation = vi.fn((data: object) =>
    facade.render("annotation", data, {
      source: annotationTemplate,
      language: "liquid",
    }),
  );
  /** Every scope the import writer handed to its excerpt preparation. */
  const scopes: (ExcerptOutcomeScope | undefined)[] = [];
  const preparation = createExcerptPreparation({
    app,
    paths,
    resolver: service,
  });
  const importer = createNoteImporter({
    app,
    profile: profileReader(settings),
    noteIndex: {
      getImportedNoteByNoteKey: () => [],
      getNotesByItemKey: () => [],
    },
    template: {
      render: () => "",
      renderCitation: () => "",
      renderProfileAnnotation: renderAnnotation,
    },
    zoteroPref: paths,
    attachmentImport: attachments,
    excerptImages: (options) => {
      scopes.push(options.outcomes);
      return preparation(options);
    },
  });
  const priorTurndown = Object.getOwnPropertyDescriptor(
    globalThis,
    "TurndownService",
  );
  Object.defineProperty(globalThis, "TurndownService", {
    value: Turndown,
    configurable: true,
  });
  stack.defer(() => {
    if (priorTurndown)
      Object.defineProperty(globalThis, "TurndownService", priorTurndown);
    else Reflect.deleteProperty(globalThis, "TurndownService");
  });
  const reports: ExcerptSummary[][] = [];
  const importNote = (noteKey: string, outcomes?: ExcerptOutcomeScope) => {
    const report: ExcerptSummary[] = [];
    reports.push(report);
    return importer.importNote(
      getNoteByKey(client, noteKey, { libraryID: 1 })!,
      {
        client,
        settings,
        outcomes,
        reportExcerpts: (summary) => report.push(summary),
      },
    );
  };
  const cleanup = stack.move();
  return {
    app,
    client,
    settings,
    importer,
    vaultRoot,
    render,
    renderAnnotation,
    scopes,
    reports,
    entries,
    importNote,
    /** The imported-note files the run created, keyed by their note key. */
    notes: () =>
      [...files.keys()]
        .filter((path) => path.endsWith(".md"))
        .sort()
        .map((path) => path),
    imageNames: () => readdir(join(vaultRoot, "Images")),
    content: (path: string) => readFile(join(vaultRoot, path), "utf8"),
    [Symbol.asyncDispose]: () => cleanup[Symbol.asyncDispose](),
  };
}

it("reuses one resolution across the notes of one initiating import batch", async () => {
  await using f = await fixture({ unreadablePdf: true });
  await using outcomes = new ExcerptOutcomeScope();
  await f.importNote("NTES2345", outcomes);
  await f.importNote("NTES3456", outcomes);
  // Both notes quote the same Annotation, so the batch renders it once and the
  // second note reaches the bytes the first one produced.
  expect(f.render).toHaveBeenCalledTimes(1);
  expect(f.entries.size).toBe(0);
  const [asset] = await f.imageNames();
  expect(await f.imageNames()).toHaveLength(1);
  const files = f.notes();
  expect(files).toHaveLength(2);
  for (const path of files) {
    const markdown = await f.content(path);
    expect(markdown).toContain("Keep this prose.");
    expect(markdown).toContain(`![[Images/${asset}]]`);
    expect(markdown).not.toContain("Images/SNAP2345-snapshot.png");
  }
  expect(await readFile(join(f.vaultRoot, "Images", asset!))).toEqual(bluePng);
  // The template still runs once per note, and each note accounts its own use.
  expect(f.renderAnnotation).toHaveBeenCalledTimes(2);
  expect(f.reports.map((report) => report.at(-1))).toEqual([
    { zotero: 0, unchecked: 1, unavailable: 0 },
    { zotero: 0, unchecked: 1, unavailable: 0 },
  ]);
  expect(outcomes.diagnostics).toMatchObject({
    hits: 1,
    retained: 1,
    consumers: 0,
    released: false,
  });
});

it("reuses the bytes a store whose write failed never kept", async () => {
  await using f = await fixture({ failWrites: true });
  const noteImport = await f.importer.prepare({
    client: f.client,
    sourcePath: "Literature/Paper.md",
    settings: f.settings,
  });
  for (const key of ["NTES2345", "NTES3456"])
    noteImport
      .resolveChildNote(getNoteByKey(f.client, key, { libraryID: 1 })!)
      .noteLink();
  expect(await noteImport.flush()).toEqual({
    created: 2,
    skipped: 0,
    failed: 0,
  });
  // The store kept nothing, and the batch still rendered the excerpt once.
  expect(f.entries.size).toBe(0);
  expect(f.render).toHaveBeenCalledTimes(1);
  expect(await f.imageNames()).toHaveLength(1);
});

it("keeps two simultaneous batches isolated and releases each batch's retention", async () => {
  await using f = await fixture({ unreadablePdf: true });
  await Promise.all([f.importNote("NTES2345"), f.importNote("NTES3456")]);
  // Separate imports are separate batches: each resolves its own excerpt.
  expect(f.render).toHaveBeenCalledTimes(2);
  expect(f.scopes).toHaveLength(2);
  expect(f.scopes[0]).not.toBe(f.scopes[1]);
  for (const scope of f.scopes) {
    expect(scope?.diagnostics).toMatchObject({
      released: true,
      retained: 0,
      consumers: 0,
      hits: 0,
    });
  }
});

it("keeps a caller's batch scope open until the caller releases it", async () => {
  await using f = await fixture();
  const outcomes = new ExcerptOutcomeScope();
  await f.importNote("NTES2345", outcomes);
  expect(f.scopes[0]).toBe(outcomes);
  expect(outcomes.diagnostics).toMatchObject({ released: false, retained: 1 });
  await outcomes[Symbol.asyncDispose]();
  expect(outcomes.diagnostics).toMatchObject({ released: true, retained: 0 });
});

it("shares one retention across the Child Notes one flush imports", async () => {
  await using f = await fixture();
  const noteImport = await f.importer.prepare({
    client: f.client,
    sourcePath: "Literature/Paper.md",
    settings: f.settings,
  });
  for (const key of ["NTES2345", "NTES3456"]) {
    const link = noteImport.resolveChildNote(
      getNoteByKey(f.client, key, { libraryID: 1 })!,
    );
    expect(link.noteLink()).toContain("Imported/");
  }
  expect(await noteImport.flush()).toEqual({
    created: 2,
    skipped: 0,
    failed: 0,
  });
  // One flush is one initiating batch: its own scope answers the second note.
  expect(f.render).toHaveBeenCalledTimes(1);
  expect(f.scopes).toHaveLength(2);
  expect(f.scopes[0]).toBe(f.scopes[1]);
  expect(f.scopes[0]?.diagnostics).toMatchObject({
    released: true,
    retained: 0,
    hits: 1,
  });
  expect(f.notes()).toHaveLength(2);
});
