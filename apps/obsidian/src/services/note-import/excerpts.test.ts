// @vitest-environment happy-dom
// Exercises live and frozen Child Note images through the import writer.
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
import type { SettingsService } from "@/services/settings/service";

import { createNoteImporter } from "./service";

const paragraph = (key: string, image: string) =>
  `<p><img data-attachment-key="${image}" data-annotation="${encodeURIComponent(JSON.stringify({ attachmentURI: "http://zotero.org/users/local/LOCAL/items/RGRPDF24", annotationKey: key }))}"></p>`;
const html = `<div data-schema-version="9">${paragraph("FDRFQ7C2", "SNAP2345")}${paragraph("TYY6Z6ZF", "SNAP3456")}<p>Saved snapshot <img data-attachment-key="FRZN2345"></p><p>Keep this prose.</p></div>`;

async function fixture(mode = "normal") {
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
    fileManager: { generateMarkdownLink: (file: TFile) => `[[${file.path}]]` },
  } as unknown as App;
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
      renderProfileAnnotation: render,
    },
    zoteroPref: paths,
    attachmentImport: attachments,
    excerptImages: createExcerptPreparation({
      app,
      paths,
      resolver: {
        operation: () => ({
          resolve,
          [Symbol.asyncDispose]: async () => {},
        }),
      },
    }),
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
  const reports: ExcerptSummary[] = [];
  const cleanup = stack.move();
  return {
    app,
    vaultRoot,
    client,
    importer,
    resolve,
    render,
    reports,
    setOutcome: (next: ExcerptOutcome) => {
      outcome = next;
    },
    import: async (targetFile?: TFile) =>
      importer.importNote(getNoteByKey(client, "NTES2345", { libraryID: 1 })!, {
        client,
        settings,
        targetFile,
        reportExcerpts: (summary) => reports.push(summary),
      }),
    note: () => [...files.values()].find((file) => file.path.endsWith(".md"))!,
    images: () => readdir(join(vaultRoot, "Images")),
    [Symbol.asyncDispose]: () => cleanup[Symbol.asyncDispose](),
  };
}

it("refreshes live image and ink versions while preserving frozen snapshots and old assets", async () => {
  await using f = await fixture();
  await f.import();
  const file = f.note();
  const original = await f.app.vault.read(file);
  const names = await f.images();
  expect(names).toHaveLength(3);
  expect(names).toContain("FRZN2345-snapshot.png");
  expect(original).toContain("Keep this prose.");
  for (const name of names) expect(original).toContain(`![[Images/${name}]]`);
  expect(f.render).toHaveBeenCalledTimes(2);
  await f.app.vault.create("Other.md", original);
  f.setOutcome(
    availableOutcome({
      bytes: redPng,
      format: PNG_FORMAT,
      provenance: "rendered",
      freshness: "checked",
    }),
  );
  await f.import(file);
  const updated = await f.app.vault.read(file);
  expect(updated).not.toBe(original);
  expect(await readFile(join(f.vaultRoot, "Other.md"), "utf8")).toBe(original);
  expect(await f.images()).toHaveLength(5);
  for (const name of names)
    expect(await readFile(join(f.vaultRoot, "Images", name))).toEqual(
      name === "FRZN2345-snapshot.png" ? redPng : bluePng,
    );
  f.setOutcome({ kind: "unavailable" });
  await f.import(file);
  expect(await f.app.vault.read(file)).toBe(updated);
  expect(f.reports.at(-1)).toEqual({
    zotero: 0,
    unchecked: 0,
    unavailable: 0,
    notRefreshed: 2,
  });
  expect(f.render).toHaveBeenCalledTimes(6);
});

it("reports committed excerpt outcomes when a frozen image copy fails", async () => {
  await using f = await fixture();
  f.setOutcome({ kind: "unavailable" });
  await mkdir(join(f.vaultRoot, "Images/FRZN2345-snapshot.png"), {
    recursive: true,
  });
  await expect(f.import()).rejects.toThrow();
  const content = await f.app.vault.read(f.note());
  expect(content).toContain("Keep this prose.");
  expect(content).not.toContain("zotlit-excerpt-");
  expect(f.reports).toEqual([{ zotero: 0, unchecked: 0, unavailable: 2 }]);
});

it("finishes mixed content when one live excerpt throws", async () => {
  await using f = await fixture("partial");
  await f.import();
  const content = await f.app.vault.read(f.note());
  const names = await f.images();
  expect(names).toHaveLength(2);
  for (const name of names) expect(content).toContain(`![[Images/${name}]]`);
  expect(content).toContain("Keep this prose.");
  expect(content).not.toContain("SNAP3456");
  expect(f.reports).toEqual([{ zotero: 0, unchecked: 0, unavailable: 1 }]);
  expect(f.render).toHaveBeenCalledTimes(2);
});

it.each(["disabled", "unavailable", "unused", "blank", "frozen", "missing"])(
  "preserves parser and image outcomes (%s)",
  async (mode) => {
    await using f = await fixture(mode);
    if (mode === "unavailable" || mode === "unused")
      f.setOutcome({ kind: "unavailable" });
    if (mode === "missing")
      f.client.$client.exec("delete from itemAnnotations");
    await f.import();
    const content = await f.app.vault.read(f.note());
    expect(content).toContain("Keep this prose.");
    if (mode === "disabled" || mode === "unavailable") {
      expect(content).not.toContain("zotlit-excerpt-");
      expect(content).toContain("paper.pdf");
      expect(f.reports).toEqual([{ zotero: 0, unchecked: 0, unavailable: 2 }]);
      if (mode === "disabled") expect(f.resolve).not.toHaveBeenCalled();
    } else if (mode === "unused") {
      expect(content).toContain("No image requested");
      expect(f.reports).toEqual([{ zotero: 0, unchecked: 0, unavailable: 0 }]);
    } else {
      expect(content).toContain("![[Images/SNAP2345-snapshot.png]]");
      expect(content).toContain("![[Images/SNAP3456-snapshot.png]]");
      if (mode !== "blank") expect(f.resolve).not.toHaveBeenCalled();
    }
    if (mode !== "frozen" && mode !== "missing")
      expect(f.render).toHaveBeenCalledTimes(2);
  },
);
