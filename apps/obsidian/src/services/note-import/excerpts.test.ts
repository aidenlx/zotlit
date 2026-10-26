// @vitest-environment happy-dom
// Exercises live and frozen Child Note images through the import writer.
import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";
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

import { testRuntime } from "@/lib/__fixtures__/runtime";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { effectBridge } from "@/lib/effect-bridge";
import type { VaultSource } from "@/lib/obsidian-vault";
import { AttachmentImportService } from "@/services/attachment-import/service";
import { availableOutcome } from "@/services/excerpt-image/__fixtures__/outcome";
import { bluePng, redPng } from "@/services/excerpt-image/__fixtures__/png";
import { PNG_FORMAT } from "@/services/excerpt-image/format";
import { createExcerptPreparation } from "@/services/excerpt-image/prepare";
import type { ExcerptSummary } from "@/services/excerpt-image/prepare";
import type {
  ExcerptOutcome,
  ExcerptRequest,
} from "@/services/excerpt-image/service";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { defaults } from "@/services/settings/schema";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@/services/zotero-reads/test-utils";

import { diskImageHost } from "./__fixtures__/disk-image-host";
import { noteImporterOver } from "./__fixtures__/importer";
import type { ImporterFakes } from "./__fixtures__/importer";

const paragraph = (key: string, image: string) =>
  `<p><img data-attachment-key="${image}" data-annotation="${encodeURIComponent(JSON.stringify({ attachmentURI: "http://zotero.org/users/local/LOCAL/items/RGRPDF24", annotationKey: key }))}"></p>`;
const html = `<div data-schema-version="9">${paragraph("FDRFQ7C2", "SNAP2345")}${paragraph("TYY6Z6ZF", "SNAP3456")}<p>Saved snapshot <img data-attachment-key="FRZN2345"></p><p>Keep this prose.</p></div>`;

async function setupFixture(mode = "normal") {
  await using stack = new AsyncDisposableStack();
  const parent = join(
    await getWorkspaceRoot(import.meta.dirname),
    ".scratch/child-excerpt-tests",
  );
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "run-"));
  stack.defer(() => rm(root, { recursive: true, force: true }));
  const vaultRoot = join(root, "vault");
  const dataDir = join(root, "zotero");
  await mkdir(vaultRoot);
  for (const key of ["FRZN2345", "SNAP2345", "SNAP3456"]) {
    await mkdir(join(dataDir, "storage", key), { recursive: true });
    await writeFile(join(dataDir, "storage", key, "snapshot.png"), redPng);
  }
  const client = createClient(":memory:");
  stack.defer(() => client.$client.close());
  createFixtureSchema(client.$client);
  client.$client.exec(`
    insert into libraries (libraryID,type) values (1,'user');
    insert into items (itemID,itemTypeID,dateAdded,dateModified,libraryID,key) values
      (1,1,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'RUGIER24'),
      (2,2,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'RGRPDF24'),
      (3,4,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'FDRFQ7C2'),
      (4,4,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'TYY6Z6ZF'),
      (5,3,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'NTES2345'),
      (6,2,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'FRZN2345'),
      (7,2,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'SNAP2345'),
      (8,2,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'SNAP3456');
    insert into itemAttachments (itemID,parentItemID,linkMode,contentType,path) values
      (2,1,0,'application/pdf','storage:paper.pdf'),
      (6,5,0,'image/png','storage:snapshot.png'),
      (7,5,0,'image/png','storage:snapshot.png'),
      (8,5,0,'image/png','storage:snapshot.png');
    insert into itemAnnotations (itemID,parentItemID,type,color,pageLabel,position) values
      (3,2,3,'#ffd400','1','{"pageIndex":0,"rects":[[0,0,10,10]]}'),
      (4,2,4,'#ff0000','1','{"pageIndex":0,"width":2,"paths":[[1,2,3,4]]}');
    insert into itemNotes (itemID,parentItemID,title,note) values (5,1,'Mixed','');
  `);
  client.$client
    .prepare("update itemNotes set note=? where itemID=5")
    .run(html);
  const host = diskImageHost(vaultRoot);
  const app = stubService<App>("App", {
    vault: host.app.vault as unknown as Vault,
    metadataCache: host.app.metadataCache as unknown as MetadataCache,
    workspace: host.app.workspace as unknown as Workspace,
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
    fileManager: stubService<FileManager>("FileManager", {
      generateMarkdownLink: (file: TFile) => `[[${file.path}]]`,
    }),
  });
  const settings = {
    ...defaults,
    "attachment.import": mode !== "disabled",
    "attachment.folder-path": "Images",
    "note.default-profile": {
      ...defaults["note.default-profile"],
      bindings: {
        ...defaults["note.default-profile"].bindings,
        "note.import-folder": "Imported",
        "note.import-annotations-as-template": mode !== "frozen",
      },
    },
  };
  const paths = { dataDir, baseAttachmentPath: null };
  const runtime = testRuntime();
  const attachments = stack.use(
    new AttachmentImportService({
      bridge: effectBridge(runtime),
      app,
      settings: {
        current: Effect.succeed(settings),
        changes: Stream.empty,
      },
      zoteroPref: { ...paths, "resolved-changed": Stream.empty },
    }),
  );
  await attachments.ready;
  let outcome: ExcerptOutcome = availableOutcome({
    bytes: bluePng,
    format: PNG_FORMAT,
    provenance: "rendered",
    freshness: "checked",
  });
  const resolve = vi.fn(
    async (request: ExcerptRequest): Promise<ExcerptOutcome> => {
      if (mode === "partial" && request.annotation.type === "ink")
        throw new Error("ink render failed");
      return outcome;
    },
  );
  const facade = new TemplateFacade();
  const render = vi.fn((data: object) =>
    mode === "unused"
      ? "No image requested"
      : mode === "blank"
        ? " "
        : facade.render("annotation", data, {
            source: annotationTemplate,
            language: "liquid",
          }),
  );
  const fakes: ImporterFakes = {
    vault: host.app.vault as unknown as VaultSource,
    workspace: host.app.workspace,
    profile: profileReader(settings),
    noteIndex: {
      getImportedNoteByNoteKey: () => [],
      getNotesByItemKey: () => [],
    },
    template: {
      render: () => "",
      renderCitation: () => "",
      renderProfileAnnotation: render,
    },
    zoteroPref: paths,
    attachmentImport: attachments,
    excerptImages: (options) =>
      createExcerptPreparation({
        app,
        paths,
        resolver: {
          operation: () => ({
            resolve,
            [Symbol.asyncDispose]: async () => {},
          }),
        },
      })(options),
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
  const reports: ExcerptSummary[] = [];
  const cleanup = stack.move();
  return {
    app,
    host,
    vaultRoot,
    client,
    fakes,
    reads,
    settings,
    resolve,
    render,
    reports,
    setOutcome: (next: ExcerptOutcome) => {
      outcome = next;
    },
    note: () => host.vault.getMarkdownFiles()[0]!,
    images: () => readdir(join(vaultRoot, "Images")),
    [Symbol.asyncDispose]: () => cleanup[Symbol.asyncDispose](),
  };
}

/** {@link setupFixture} for the case's Scope, with the real importer over its fakes. */
const fixture = Effect.fnUntraced(function* (mode = "normal") {
  const f = yield* Effect.acquireDisposable(
    Effect.promise(() => setupFixture(mode)),
  );
  const importer = yield* noteImporterOver(f.fakes);
  return {
    ...f,
    import: (targetFile?: TFile) =>
      importer.importNote(
        getNoteByKey(f.client, "NTES2345", { libraryID: 1 })!,
        {
          reads: f.reads,
          settings: f.settings,
          targetFile,
          reportExcerpts: (summary) => f.reports.push(summary),
        },
      ),
  };
});

it.effect(
  "refreshes live image and ink versions while preserving frozen snapshots and old assets",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* f.import();
      const file = f.note();
      const original = yield* Effect.promise(() => f.app.vault.read(file));
      const names = yield* Effect.promise(() => f.images());
      expect(names).toHaveLength(3);
      expect(names).toContain("FRZN2345-snapshot.png");
      expect(original).toContain("Keep this prose.");
      for (const name of names)
        expect(original).toContain(`![[Images/${name}]]`);
      expect(f.render).toHaveBeenCalledTimes(2);
      yield* Effect.promise(() => f.app.vault.create("Other.md", original));
      f.setOutcome(
        availableOutcome({
          bytes: redPng,
          format: PNG_FORMAT,
          provenance: "rendered",
          freshness: "checked",
        }),
      );
      yield* f.import(file);
      const updated = yield* Effect.promise(() => f.app.vault.read(file));
      expect(updated).not.toBe(original);
      expect(f.host.text("Other.md")).toBe(original);
      expect(yield* Effect.promise(() => f.images())).toHaveLength(5);
      for (const name of names)
        expect(
          yield* Effect.promise(() =>
            readFile(join(f.vaultRoot, "Images", name)),
          ),
        ).toEqual(name === "FRZN2345-snapshot.png" ? redPng : bluePng);
      f.setOutcome({ kind: "unavailable" });
      yield* f.import(file);
      expect(yield* Effect.promise(() => f.app.vault.read(file))).toBe(updated);
      expect(f.reports.at(-1)).toEqual({
        zotero: 0,
        unchecked: 0,
        unavailable: 0,
        notRefreshed: 2,
      });
      expect(f.render).toHaveBeenCalledTimes(6);
    }),
);

it.effect(
  "reports committed excerpt outcomes when a frozen image copy fails",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.setOutcome({ kind: "unavailable" });
      yield* Effect.promise(() =>
        mkdir(join(f.vaultRoot, "Images/FRZN2345-snapshot.png"), {
          recursive: true,
        }),
      );
      expect(yield* Effect.flip(f.import())).toMatchObject({
        _tag: "LegacyPortError",
      });
      const content = yield* Effect.promise(() => f.app.vault.read(f.note()));
      expect(content).toContain("Keep this prose.");
      expect(content).not.toContain("zotlit-excerpt-");
      expect(f.reports).toEqual([{ zotero: 0, unchecked: 0, unavailable: 2 }]);
    }),
);

it.effect("finishes mixed content when one live excerpt throws", () =>
  Effect.gen(function* () {
    const f = yield* fixture("partial");
    yield* f.import();
    const content = yield* Effect.promise(() => f.app.vault.read(f.note()));
    const names = yield* Effect.promise(() => f.images());
    expect(names).toHaveLength(2);
    for (const name of names) expect(content).toContain(`![[Images/${name}]]`);
    expect(content).toContain("Keep this prose.");
    expect(content).not.toContain("SNAP3456");
    expect(f.reports).toEqual([{ zotero: 0, unchecked: 0, unavailable: 1 }]);
    expect(f.render).toHaveBeenCalledTimes(2);
  }),
);

const live = [
  "![[Images/SNAP2345-snapshot.png]]",
  "![[Images/SNAP3456-snapshot.png]]",
];
const unavailableReport = [{ zotero: 0, unchecked: 0, unavailable: 2 }];
// An unavailable excerpt points back to its Annotation by the Durable
// Annotation Link, never by this computer's file path.
const sourceLinks = [
  "[Zotero](zotero://open/library/items/RGRPDF24?annotation=FDRFQ7C2&page=1)",
  "[Zotero](zotero://open/library/items/RGRPDF24?annotation=TYY6Z6ZF&page=1)",
];
// `expect.any` leaves a count or report unconstrained for that mode.
it.effect.each([
  {
    mode: "disabled",
    contains: sourceLinks,
    excludes: ["zotlit-excerpt-", "zt-annotation="],
    reports: unavailableReport,
    resolves: 0,
    renders: 2,
  },
  {
    mode: "unavailable",
    contains: sourceLinks,
    excludes: ["zotlit-excerpt-", "zt-annotation="],
    reports: unavailableReport,
    resolves: expect.any(Number),
    renders: 2,
  },
  {
    mode: "unused",
    contains: ["No image requested"],
    excludes: [],
    reports: [{ zotero: 0, unchecked: 0, unavailable: 0 }],
    resolves: expect.any(Number),
    renders: 2,
  },
  {
    mode: "blank",
    contains: live,
    excludes: [],
    reports: expect.any(Array),
    resolves: expect.any(Number),
    renders: 2,
  },
  {
    mode: "frozen",
    contains: live,
    excludes: [],
    reports: expect.any(Array),
    resolves: 0,
    renders: expect.any(Number),
  },
  {
    mode: "missing",
    contains: live,
    excludes: [],
    reports: expect.any(Array),
    resolves: 0,
    renders: expect.any(Number),
  },
])(
  "preserves parser and image outcomes ($mode)",
  ({ mode, contains, excludes, reports, resolves, renders }) =>
    Effect.gen(function* () {
      const f = yield* fixture(mode);
      if (mode === "unavailable" || mode === "unused")
        f.setOutcome({ kind: "unavailable" });
      if (mode === "missing")
        f.client.$client.exec("delete from itemAnnotations");
      yield* f.import();
      const content = yield* Effect.promise(() => f.app.vault.read(f.note()));
      expect(content).toContain("Keep this prose.");
      for (const text of contains) expect(content).toContain(text);
      for (const text of excludes) expect(content).not.toContain(text);
      expect(f.reports).toEqual(reports);
      expect(f.resolve.mock.calls.length).toEqual(resolves);
      expect(f.render.mock.calls.length).toEqual(renders);
    }),
);
