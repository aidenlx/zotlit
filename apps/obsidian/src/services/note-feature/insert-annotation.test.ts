import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { FileSystemAdapter, TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import { createClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";
import annotationTemplate from "@zotlit/templates/defaults/annotation.liquid?raw";
import { TemplateFacade } from "@zotlit/templates/facade";

import type { AnnotationRecord } from "@/services/annotation-repository/service";
import { availableOutcome } from "@/services/excerpt-image/__fixtures__/outcome";
import { redPng } from "@/services/excerpt-image/__fixtures__/png";
import { PNG_FORMAT } from "@/services/excerpt-image/format";
import { prepareSingleExcerpt } from "@/services/excerpt-image/prepare-single";
import type {
  ExcerptOutcome,
  ExcerptRequest,
} from "@/services/excerpt-image/service";
import { profileReader } from "@/services/profile/__fixtures__/reader";
import { defaults } from "@/services/settings/schema";

import type { AnnotationInsertOptions } from "./insert-annotation";
import { prepareAnnotationInsert } from "./insert-annotation";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, open: vi.fn(fs.open) };
});

const card: AnnotationRecord = {
  key: "FDRFQ7C2",
  parentKey: "RGRPDF24",
  type: "image",
  color: "#ffd400",
  comment: null,
  text: null,
  pageLabel: "3",
  tags: ["api-tag"],
  version: 9,
  position: { kind: "pdf-rects", pageIndex: 2, rects: [[1, 2, 30, 40]] },
};

async function fixture(mode: string) {
  const parent = join(
    await getWorkspaceRoot(import.meta.dirname),
    "tmp/insert-tests",
  );
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(`${parent}/vault-`);
  const client = createClient(":memory:");
  createFixtureSchema(client.$client);
  client.$client.exec(`
    insert into libraries (libraryID, type) values (1, 'user');
    insert into settings (setting,key,value) values ('localAPI','serverID','SERVER000001');
    insert into items (itemID,itemTypeID,dateAdded,dateModified,libraryID,key) values
      (1,1,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'RUGIER24'),
      (2,2,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'RGRPDF24');
    insert into itemAttachments (itemID,parentItemID,linkMode,contentType,path) values (2,1,0,'application/pdf','storage:paper.pdf');
  `);
  const settings = {
    ...defaults,
    "attachment.import": mode !== "disabled",
    "attachment.folder-path": "Images",
  };
  const registered = new Map<string, TFile>();
  const app = {
    vault: {
      adapter: Object.assign(Object.create(FileSystemAdapter.prototype), {
        getFullPath: (path: string) => join(root, path),
        reconcileInternalFile: async (path: string) => {
          if (
            await readFile(join(root, path)).then(
              () => true,
              () => false,
            )
          )
            registered.set(path, Object.assign(new TFile(), { path }));
          else registered.delete(path);
        },
      }),
      getAbstractFileByPath: () => null,
      getFileByPath: (path: string) => registered.get(path) ?? null,
      createFolder: async (path: string) => {
        await mkdir(join(root, path), { recursive: true });
        return Object.assign(new TFolder(), { path });
      },
    },
    fileManager: {
      generateMarkdownLink: (file: { path: string }) => `[[${file.path}]]`,
    },
  } as unknown as App;
  const resolver = {
    resolve: vi.fn(
      async (_request: ExcerptRequest): Promise<ExcerptOutcome> => {
        if (mode === "throw") throw new Error("renderer failed");
        if (mode === "unavailable") return { kind: "unavailable" };
        return availableOutcome({
          bytes: redPng,
          format: PNG_FORMAT,
          provenance: mode === "fallback" ? "zotero" : "rendered",
          freshness: "checked",
        });
      },
    ),
  };
  const facade = new TemplateFacade();
  const render = vi.fn((data: object) =>
    facade.render("annotation", data, {
      source: annotationTemplate,
      language: "liquid",
    }),
  );
  const ctx: Parameters<typeof prepareAnnotationInsert>[0] = {
    db: { acquireRead: async () => ({ client, [Symbol.dispose]() {} }) },
    zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
    settings: {
      current: settings,
      loaded: Promise.resolve(settings),
      update: () => settings,
    },
    profile: profileReader(settings),
    template: {
      ready: Promise.resolve(),
      loaded: true,
      renderProfileAnnotation: render,
      render: () => "",
      renderCitation: () => "",
      renderFilename: () => "",
      frontmatterFields: [],
      getLiteratureNoteTemplate: () => undefined,
    },
    noteIndex: {
      ready: Promise.resolve(),
      whenIndexed: async () => {},
      getNotesByItemKey: () => [],
      getImportedNoteByNoteKey: () => [],
    },
    singleExcerpt: (options) =>
      prepareSingleExcerpt({ ...options, app, resolver }),
  };
  let valid = true;
  const options: AnnotationInsertOptions = {
    annotation: card,
    source: { kind: "zotero-local-api", serverID: "SERVER000001" },
    sourceScope: "/zotero",
    notePath: "Target.md",
    signal: new AbortController().signal,
    valid: () => valid,
  };
  if (mode === "write-failure")
    await writeFile(join(root, "Images"), "occupied");
  return {
    root,
    app,
    ctx,
    options,
    resolver,
    render,
    invalidate: () => {
      valid = false;
    },
    async [Symbol.asyncDispose]() {
      client.$client.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

it.each([
  "success",
  "fallback",
  "disabled",
  "unavailable",
  "throw",
  "write-failure",
])("renders the API-ahead card once after preparation (%s)", async (mode) => {
  await using f = await fixture(mode);
  const result = await prepareAnnotationInsert(f.ctx, f.options);
  expect(f.render).toHaveBeenCalledTimes(1);
  if (mode === "success" || mode === "fallback") {
    const names = await readdir(join(f.root, "Images"));
    expect(names).toHaveLength(1);
    expect(result?.text).toContain(`![[Images/${names[0]}]]`);
    expect(await readFile(join(f.root, "Images", names[0]!))).toEqual(redPng);
    expect(result?.summary).toEqual({
      zotero: mode === "fallback" ? 1 : 0,
      unchecked: 0,
      unavailable: 0,
    });
  } else {
    expect(result?.text).toContain("zt-annotation=FDRFQ7C2");
    expect(result?.text).not.toContain("![[");
    expect(result?.summary.unavailable).toBe(1);
  }
  if (mode === "disabled") expect(f.resolver.resolve).not.toHaveBeenCalled();
  else expect(f.resolver.resolve.mock.calls[0]?.[0].annotation).toBe(card);
});

it("cancels between resolution and materialization", async () => {
  await using f = await fixture("success");
  f.resolver.resolve.mockImplementation(async () => {
    f.invalidate();
    return availableOutcome({
      bytes: new Uint8Array([1]),
      format: PNG_FORMAT,
      provenance: "rendered",
      freshness: "checked",
    });
  });
  expect(await prepareAnnotationInsert(f.ctx, f.options)).toBeNull();
  expect(await readdir(f.root)).toEqual([]);
  expect(f.render).not.toHaveBeenCalled();
});

it("preserves text-only insertion without resolving or writing an image", async () => {
  await using f = await fixture("success");
  f.options.annotation = {
    ...card,
    type: "highlight",
    text: "Captured text from the card",
  };
  const result = await prepareAnnotationInsert(f.ctx, f.options);
  expect(result?.text).toContain("Captured text from the card");
  expect(f.render).toHaveBeenCalledTimes(1);
  expect(f.resolver.resolve).not.toHaveBeenCalled();
  expect(await readdir(f.root)).toEqual([]);
});

it("preserves manual and automatic tags in the actual annotation template", async () => {
  await using f = await fixture("disabled");
  f.options.annotation = {
    ...card,
    tags: ["review", "imported"],
    templateMetadata: {
      dateAdded: null,
      dateModified: null,
      authorName: null,
      isExternal: null,
      tags: [
        { name: "review", type: "manual" },
        { name: "imported", type: "auto" },
      ],
    },
  };
  const facade = new TemplateFacade();
  f.render.mockImplementation((data) =>
    facade.render("annotation", data, {
      source:
        "{% for tag in zt.tags %}{{ tag.name }}={{ tag.type }};{% endfor %}",
      language: "liquid",
    }),
  );
  expect((await prepareAnnotationInsert(f.ctx, f.options))?.text).toBe(
    "review=manual;imported=auto;",
  );
});

it.each(["signal", "target"])(
  "cancels during the temporary write (%s)",
  async (mode) => {
    await using f = await fixture("success");
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const controller = new AbortController();
    f.options.signal = controller.signal;
    const fs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const file = await fs.open(...args);
      const write = file.writeFile.bind(file);
      vi.spyOn(file, "writeFile").mockImplementationOnce(
        async (...writeArgs) => {
          await write(...writeArgs);
          started.resolve();
          await release.promise;
        },
      );
      return file;
    });
    const pending = prepareAnnotationInsert(f.ctx, f.options);
    const settled = pending.catch(() => null);
    try {
      await started.promise;
      expect(
        (await readdir(join(f.root, "Images"))).every((name) =>
          name.endsWith(".tmp"),
        ),
      ).toBe(true);
      if (mode === "signal") controller.abort();
      else f.invalidate();
    } finally {
      release.resolve();
    }
    expect(await settled).toBeNull();
    expect(await readdir(join(f.root, "Images"))).toEqual([]);
    expect(f.render).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "cancels during registration and preserves pre-existing assets (%s)",
  async (existing) => {
    await using f = await fixture("success");
    if (existing) await prepareAnnotationInsert(f.ctx, f.options);
    f.render.mockClear();
    const reconcile = f.app.vault.adapter as FileSystemAdapter;
    const register = reconcile.reconcileInternalFile.bind(reconcile);
    vi.spyOn(reconcile, "reconcileInternalFile").mockImplementationOnce(
      async (path) => {
        await register(path);
        f.invalidate();
      },
    );
    expect(await prepareAnnotationInsert(f.ctx, f.options)).toBeNull();
    expect(await readdir(join(f.root, "Images"))).toHaveLength(
      existing ? 1 : 0,
    );
    expect(f.render).not.toHaveBeenCalled();
  },
);

it("reads truthful metadata and reports a missing required fact only on access", async () => {
  await using f = await fixture("disabled");
  f.render.mockImplementation((data) =>
    String((data as { dateModified: Temporal.Instant }).dateModified),
  );
  await expect(prepareAnnotationInsert(f.ctx, f.options)).rejects.toThrow(
    "Annotation source did not supply dateModified",
  );
  f.options.annotation = {
    ...card,
    templateMetadata: {
      dateAdded: "2025-01-01T00:00:00Z",
      dateModified: "2026-09-20T01:02:03Z",
      authorName: "Known author",
      isExternal: true,
    },
  };
  expect((await prepareAnnotationInsert(f.ctx, f.options))?.text).toBe(
    "2026-09-20T01:02:03Z",
  );
});
