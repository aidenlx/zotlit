// @vitest-environment happy-dom
// One initiating import batch reusing one retention, through the real writer.
import { it } from "@effect/vitest";
import { Effect } from "effect";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type {
  App,
  FileManager,
  MetadataCache,
  TFile,
  Vault,
  Workspace,
} from "obsidian";
import Turndown from "turndown";
import { expect, vi } from "vitest";

import { getNoteByKey } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";
import annotationTemplate from "@zotlit/templates/defaults/annotation.liquid?raw";
import { TemplateFacade } from "@zotlit/templates/facade";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { NodeExcerptImageFixture as ExcerptImageService } from "@/services/excerpt-image/__fixtures__/node-service";
import { bluePng } from "@/services/excerpt-image/__fixtures__/png";
import { PNG_FORMAT } from "@/services/excerpt-image/format";
import type { ExcerptImage } from "@/services/excerpt-image/format";
import { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";
import type { ExcerptSummary } from "@/services/excerpt-image/prepare";
import type { ExcerptEntry } from "@/services/excerpt-image/service";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { defaults } from "@/services/settings/schema";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";

import { diskImageHost } from "./__fixtures__/disk-image-host";
import { noteImporterOver } from "./__fixtures__/importer";
import type { ImporterFakes } from "./__fixtures__/importer";

/** One paragraph naming the Shared Annotation both Child Notes quote. */
const paragraph = `<p><img data-attachment-key="SNAP2345" data-annotation="${encodeURIComponent(
  JSON.stringify({
    attachmentURI: "http://zotero.org/users/local/LOCAL/items/RGRPDF24",
    annotationKey: "FDRFQ7C2",
  }),
)}"></p>`;
const childNoteHtml = `<div data-schema-version="9">${paragraph}<p>Keep this prose.</p></div>`;

async function setupFixture(
  options: { failWrites?: boolean; unreadablePdf?: boolean } = {},
) {
  await using stack = new AsyncDisposableStack();
  const parent = join(
    await getWorkspaceRoot(import.meta.dirname),
    ".scratch/outcome-scope-tests",
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

  const host = diskImageHost(vaultRoot);
  const app = stubService<App>("App", {
    vault: host.app.vault as unknown as Vault,
    metadataCache: host.app.metadataCache as unknown as MetadataCache,
    workspace: host.app.workspace as unknown as Workspace,
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
    fileManager: stubService<FileManager>("FileManager", {
      generateMarkdownLink: (file: TFile) => `![[${file.path}]]`,
    }),
  });
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

  const entries = new Map<string, ExcerptEntry>();
  const render = vi.fn(async (): Promise<ExcerptImage> => ({
    bytes: bluePng,
    format: PNG_FORMAT,
  }));
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
  const fakes: ImporterFakes = {
    vault: host.app.vault,
    workspace: host.app.workspace,
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
    attachmentImport: {
      settings,
      fileManager: app.fileManager,
      basePath: vaultRoot,
    },
    excerptImages: {
      resolver: {
        operation: (options) => {
          scopes.push(options?.outcomes);
          return service.operation(options);
        },
        resolve: (request, signal) => service.resolve(request, signal),
      },
      fileManager: app.fileManager,
      metadataCache: app.metadataCache,
    },
  };
  const { reads } = await stack.use(
    inProcessReadsService(sharedClientOpener(client)),
  ).ready;
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
  const cleanup = stack.move();
  return {
    app,
    client,
    reads,
    settings,
    fakes,
    vaultRoot,
    render,
    renderAnnotation,
    scopes,
    reports,
    entries,
    /** The imported-note files the run created, keyed by their note key. */
    notes: () =>
      host.vault
        .getMarkdownFiles()
        .map((file) => file.path)
        .sort(),
    imageNames: () => readdir(join(vaultRoot, "Images")),
    content: (path: string) => host.text(path),
    [Symbol.asyncDispose]: () => cleanup[Symbol.asyncDispose](),
  };
}

/** {@link setupFixture} for the case's Scope, with the real importer over its fakes. */
const fixture = Effect.fnUntraced(function* (
  options: Parameters<typeof setupFixture>[0] = {},
) {
  const f = yield* Effect.acquireDisposable(
    Effect.promise(() => setupFixture(options)),
  );
  const importer = yield* noteImporterOver(f.fakes);
  return {
    ...f,
    importNote: (noteKey: string, outcomes?: ExcerptOutcomeScope) => {
      const report: ExcerptSummary[] = [];
      f.reports.push(report);
      return importer.importNote(
        getNoteByKey(f.client, noteKey, { libraryID: 1 })!,
        {
          reads: f.reads,
          settings: f.settings,
          outcomes,
          reportExcerpts: (summary) => report.push(summary),
        },
      );
    },
  };
});

it.effect(
  "reuses one resolution across the notes of one initiating import batch",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture({ unreadablePdf: true });
      const outcomes = yield* Effect.acquireDisposable(
        Effect.sync(() => new ExcerptOutcomeScope()),
      );
      yield* f.importNote("NTES2345", outcomes);
      yield* f.importNote("NTES3456", outcomes);
      // Both notes quote the same Annotation, so the batch renders it once and the
      // second note reaches the bytes the first one produced.
      expect(f.render).toHaveBeenCalledTimes(1);
      expect(f.entries.size).toBe(0);
      const [asset] = yield* Effect.promise(() => f.imageNames());
      expect(yield* Effect.promise(() => f.imageNames())).toHaveLength(1);
      const files = f.notes();
      expect(files).toHaveLength(2);
      for (const path of files) {
        const markdown = f.content(path);
        expect(markdown).toContain("Keep this prose.");
        expect(markdown).toContain(`![[Images/${asset}]]`);
        expect(markdown).not.toContain("Images/SNAP2345-snapshot.png");
      }
      expect(
        yield* Effect.promise(() =>
          readFile(join(f.vaultRoot, "Images", asset!)),
        ),
      ).toEqual(bluePng);
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
    }),
);

it.effect("reuses the bytes a store whose write failed never kept", () =>
  Effect.gen(function* () {
    const f = yield* fixture({ failWrites: true });
    const outcomes = yield* Effect.acquireDisposable(
      Effect.sync(() => new ExcerptOutcomeScope()),
    );
    yield* f.importNote("NTES2345", outcomes);
    yield* f.importNote("NTES3456", outcomes);
    expect(f.notes()).toHaveLength(2);
    // The store kept nothing, and the batch still rendered the excerpt once.
    expect(f.entries.size).toBe(0);
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(yield* Effect.promise(() => f.imageNames())).toHaveLength(1);
  }),
);

it.effect(
  "keeps two simultaneous batches isolated and releases each batch's retention",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture({ unreadablePdf: true });
      yield* Effect.all([f.importNote("NTES2345"), f.importNote("NTES3456")], {
        concurrency: "unbounded",
      });
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
    }),
);

it.effect(
  "keeps a caller's batch scope open until the caller releases it",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const outcomes = new ExcerptOutcomeScope();
      yield* f.importNote("NTES2345", outcomes);
      expect(f.scopes[0]).toBe(outcomes);
      expect(outcomes.diagnostics).toMatchObject({
        released: false,
        retained: 1,
      });
      yield* Effect.promise(() => outcomes[Symbol.asyncDispose]());
      expect(outcomes.diagnostics).toMatchObject({
        released: true,
        retained: 0,
      });
    }),
);
