import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { FileSystemAdapter, TFolder } from "obsidian";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { defaults } from "@/services/settings/schema";

import { materializeExcerpt } from "./materialize";
import type { ExcerptRequest } from "./service";

const request: ExcerptRequest = {
  annotation: {
    key: "ANNOT001",
    parentKey: "ATTACH01",
    type: "image",
    color: null,
    text: null,
    comment: null,
    pageLabel: "1",
    tags: [],
    version: 1,
    position: { kind: "pdf-rects", pageIndex: 0, rects: [[0, 0, 10, 10]] },
  },
  source: {
    kind: "zotero-db",
    database: { userID: 1, localUserKey: "LOCAL", serverID: "SERVER" },
    libraryID: 1,
    libraryRevision: 1,
  },
  sourceScope: "/zotero",
  attachmentKey: "ATTACH01",
  libraryID: 1,
  pdfPath: "/paper.pdf",
  zoteroPngPath: null,
};

async function fixture() {
  const parent = join(
    await getWorkspaceRoot(import.meta.dirname),
    "tmp/excerpt-tests",
  );
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(`${parent}/vault-`);
  const folders = new Map<string, TFolder>();
  const createFolder = vi.fn(async (path: string) => {
    await mkdir(`${root}/${path}`, { recursive: true });
    const folder = Object.assign(new TFolder(), { path });
    folders.set(path, folder);
    return folder;
  });
  const adapter = Object.assign(Object.create(FileSystemAdapter.prototype), {
    getFullPath: (path: string) => `${root}/${path}`,
  });
  const app = {
    vault: {
      adapter,
      createFolder,
      getAbstractFileByPath: (path: string) => folders.get(path) ?? null,
    },
    fileManager: {},
  } as unknown as App;
  const settings = {
    ...defaults,
    "attachment.import": true,
    "attachment.folder-path": "Images",
  };
  return {
    root,
    app,
    createFolder,
    save: (input = request, bytes = new Uint8Array([11, 22, 33])) =>
      materializeExcerpt({
        app,
        notePath: "Paper.md",
        settings,
        request: input,
        outcome: {
          kind: "available",
          bytes,
          provenance: "rendered",
          freshness: "checked",
        },
      }),
    async [Symbol.asyncDispose]() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

it("publishes complete immutable versions and isolates source and library identity", async () => {
  await using f = await fixture();
  const results = await Promise.all([
    f.save(),
    f.save(),
    f.save(request, new Uint8Array([44, 55])),
    f.save({ ...request, libraryID: 2 }),
    f.save({ ...request, sourceScope: "/other-zotero" }),
  ]);
  expect(results.every((result) => result.kind === "saved")).toBe(true);
  const paths = results.map((result) =>
    result.kind === "saved" ? result.path : "",
  );
  expect(paths[0]).toBe(paths[1]);
  expect(new Set(paths).size).toBe(4);
  const files = await readdir(`${f.root}/Images`);
  expect(files).toHaveLength(4);
  expect(await readFile(`${f.root}/${paths[0]}`)).toEqual(
    Buffer.from([11, 22, 33]),
  );
  expect(await readFile(`${f.root}/${paths[2]}`)).toEqual(
    Buffer.from([44, 55]),
  );
});

it("refuses a corrupt occupied target without overwriting it", async () => {
  await using f = await fixture();
  const saved = await f.save();
  expect(saved.kind).toBe("saved");
  if (saved.kind !== "saved") return;
  await writeFile(`${f.root}/${saved.path}`, "existing-owner");
  expect(await f.save()).toEqual({ kind: "unavailable", reason: "write" });
  expect(await readFile(`${f.root}/${saved.path}`, "utf8")).toBe(
    "existing-owner",
  );
  expect(await readdir(`${f.root}/Images`)).toHaveLength(1);
});

it("creates no folder or file with attachment import disabled", async () => {
  await using f = await fixture();
  const result = await materializeExcerpt({
    app: f.app,
    notePath: "Paper.md",
    settings: { ...defaults, "attachment.import": false },
    request,
    outcome: {
      kind: "available",
      bytes: new Uint8Array([1]),
      provenance: "zotero",
      freshness: "uncertain",
    },
  });
  expect(result).toEqual({ kind: "unavailable", reason: "disabled" });
  expect(f.createFolder).not.toHaveBeenCalled();
  expect(await readdir(f.root)).toEqual([]);
});

it("returns a destination failure before any embed can be emitted", async () => {
  await using f = await fixture();
  await writeFile(`${f.root}/Images`, "occupied");
  expect(await f.save()).toEqual({ kind: "unavailable", reason: "write" });
  expect(await readFile(`${f.root}/Images`, "utf8")).toBe("occupied");
});
