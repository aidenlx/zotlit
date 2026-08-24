// Real-filesystem coverage for the attachment-import service seam: the
// copy-time confirmation that resolves each approved source before a byte
// moves, and the destination-containment guarantees around the write itself.

import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystemAdapter, TFolder } from "obsidian";
import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reflink } from "@/lib/reflink";

import { AttachmentImportService } from "./service";
import type { SourceOrigin } from "./source";
import { makeDeviceStorage } from "./test-utils";

/** Lets a test act in the window between the confirmation and the copy. */
const hooks = vi.hoisted(() => ({
  beforeCopy: null as (() => Promise<void>) | null,
}));

vi.mock("@/lib/copy-attachments", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/copy-attachments")>();
  return {
    ...actual,
    copyAttachments: async (
      items: Parameters<typeof actual.copyAttachments>[0],
    ) => {
      await hooks.beforeCopy?.();
      return actual.copyAttachments(items);
    },
  };
});

// Spied rather than stubbed: whether a copy reflinks is the observable
// difference between the two strategies, and the real call still runs.
vi.mock("@/lib/reflink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reflink")>();
  return { ...actual, reflink: vi.fn(actual.reflink) };
});

// The refusal record is the support signal for a user who cannot reproduce the
// problem, so its fields — and what they leave out — are asserted here.
const logRecords: { level: string; message: string; fields: unknown }[] = [];
vi.mock("@/lib/log", () => ({
  getLogger: () => ({
    debug: (message: string, fields: unknown) =>
      logRecords.push({ level: "debug", message, fields }),
    info: (message: string, fields: unknown) =>
      logRecords.push({ level: "info", message, fields }),
    warn: (message: string, fields: unknown) =>
      logRecords.push({ level: "warn", message, fields }),
    error: (message: string, fields: unknown) =>
      logRecords.push({ level: "error", message, fields }),
  }),
}));

let dir: string;
let vaultDir: string;
let attachmentsDir: string;
let dataDir: string;
let storageDir: string;
/** Zotero's base attachment directory, outside its data directory. */
let baseDir: string;
/** A folder the user approved on this device, outside Zotero's control. */
let approvedDir: string;

function makeFolder(path: string): TFolder {
  const folder = new TFolder();
  folder.path = path;
  return folder;
}

// The real `obsidian` types declare a zero-arg constructor; the runtime mock
// (`__mocks__/obsidian.ts`) adds an optional `basePath` so tests can point
// `getFullPath` at a real temporary directory.
const Adapter = FileSystemAdapter as unknown as new (
  basePath: string,
) => FileSystemAdapter;

function makeApp(basePath: string): App {
  const root = makeFolder("/");
  const attachments = makeFolder("Attachments");
  return {
    // Obsidian's vault-scoped localStorage, where the approved folders live.
    ...makeDeviceStorage(),
    vault: {
      adapter: new Adapter(basePath),
      getRoot: () => root,
      getAbstractFileByPath: (path: string) =>
        path === "Attachments" ? attachments : null,
      createFolder: async () => attachments,
    },
    fileManager: {
      generateMarkdownLink: (file: { name: string }) => `[[${file.name}]]`,
    },
  } as unknown as App;
}

function makeSettings(value: {
  "attachment.import": boolean;
  "attachment.folder-path": string | null;
}) {
  return { loaded: Promise.resolve(value), subscribe: () => () => undefined };
}

async function makeService(): Promise<AttachmentImportService> {
  const service = new AttachmentImportService({
    app: makeApp(vaultDir),
    settings: makeSettings({
      "attachment.import": true,
      "attachment.folder-path": "Attachments",
    }) as any,
    zoteroPref: {
      dataDir,
      baseAttachmentPath: baseDir,
      on: () => () => undefined,
    },
  });
  await service.ready;
  return service;
}

/** Queue one copy of `source` and settle the batch. */
async function importSource(
  service: AttachmentImportService,
  source: string,
  opts?: { origin?: SourceOrigin; vaultName?: string },
) {
  const batch = await service.prepare("Notes/A.md");
  batch.resolveLink({
    source: batch.decide(source, opts?.origin ?? "storage"),
    vaultName: opts?.vaultName ?? "IMG-image.png",
  })();
  return batch.flush();
}

beforeEach(async () => {
  vi.clearAllMocks();
  hooks.beforeCopy = null;
  logRecords.length = 0;
  dir = await realpath(
    await mkdtemp(join(tmpdir(), "zotlit-attachment-import-security-")),
  );
  vaultDir = join(dir, "vault");
  attachmentsDir = join(vaultDir, "Attachments");
  dataDir = join(dir, "zotero");
  storageDir = join(dataDir, "storage");
  baseDir = join(dir, "linked");
  approvedDir = join(dir, "approved");
  await mkdir(attachmentsDir, { recursive: true });
  await mkdir(storageDir, { recursive: true });
  await mkdir(baseDir);
  await mkdir(approvedDir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("AttachmentImportService copy-time confirmation", () => {
  it("refuses a symbolic link inside a trusted root that points outside it", async () => {
    const outside = join(dir, "outside.txt");
    await writeFile(outside, "secret");
    const source = join(storageDir, "escape.png");
    await symlink(outside, source);

    const result = await importSource(await makeService(), source);

    expect(result).toMatchObject({ copied: 0, refused: 1 });
    await expect(readdir(attachmentsDir)).resolves.toEqual([]);
  });

  it("logs a refusal with its origin and reason, and without the location", async () => {
    const outside = join(dir, "outside.txt");
    await writeFile(outside, "secret");
    const source = join(storageDir, "escape.png");
    await symlink(outside, source);

    await importSource(await makeService(), source);

    const refusal = logRecords.find(
      (record) => record.message === "Refused attachment source",
    );
    expect(refusal).toMatchObject({
      level: "warn",
      fields: { origin: "storage", reason: "escaped-root" },
    });
    expect(JSON.stringify(refusal)).not.toContain(source);
    expect(JSON.stringify(refusal)).not.toContain(outside);
  });

  it("refuses a symbolic link inside an approved folder that points outside it", async () => {
    const outside = join(dir, "outside.txt");
    await writeFile(outside, "secret");
    const source = join(approvedDir, "escape.pdf");
    await symlink(outside, source);
    const service = await makeService();
    await service.approveFolder(approvedDir);

    const result = await importSource(service, source, {
      origin: "linked-absolute",
      vaultName: "escape.pdf",
    });

    expect(result).toMatchObject({ copied: 0, refused: 1 });
    await expect(readdir(attachmentsDir)).resolves.toEqual([]);
  });

  it("refuses a source that is a directory rather than a regular file", async () => {
    const source = join(storageDir, "IMG12345");
    await mkdir(source);

    const result = await importSource(await makeService(), source);

    expect(result).toMatchObject({ copied: 0, refused: 1 });
    await expect(readdir(attachmentsDir)).resolves.toEqual([]);
  });

  it("counts a source that is gone as missing rather than refused", async () => {
    const result = await importSource(
      await makeService(),
      join(storageDir, "never-written.png"),
    );

    expect(result).toMatchObject({ copied: 0, missing: 1, refused: 0 });
  });

  it("copies a source the confirmation accepts", async () => {
    const source = join(storageDir, "image.png");
    await writeFile(source, "image");

    const result = await importSource(await makeService(), source);

    expect(result).toMatchObject({ copied: 1, refused: 0 });
    await expect(
      readFile(join(attachmentsDir, "IMG-image.png"), "utf8"),
    ).resolves.toBe("image");
  });
});

describe("AttachmentImportService copy strategy by origin", () => {
  it("writes the bytes confirmed for a linked file, not those of a source swapped afterwards", async () => {
    const source = join(baseDir, "paper.pdf");
    await writeFile(source, "confirmed");
    hooks.beforeCopy = async () => {
      await rm(source);
      await writeFile(source, "substituted");
    };

    const result = await importSource(await makeService(), source, {
      origin: "linked-base",
      vaultName: "paper.pdf",
    });

    expect(result).toMatchObject({ copied: 1, missing: 0, refused: 0 });
    await expect(
      readFile(join(attachmentsDir, "paper.pdf"), "utf8"),
    ).resolves.toBe("confirmed");
  });

  it("reads a linked file through its descriptor rather than cloning its path", async () => {
    const source = join(baseDir, "paper.pdf");
    await writeFile(source, "linked");

    const result = await importSource(await makeService(), source, {
      origin: "linked-base",
      vaultName: "paper.pdf",
    });

    expect(result).toMatchObject({ copied: 1 });
    expect(reflink).not.toHaveBeenCalled();
    await expect(
      readFile(join(attachmentsDir, "paper.pdf"), "utf8"),
    ).resolves.toBe("linked");
  });

  it("still reflinks a Zotero-managed source, from its confirmed canonical path", async () => {
    const source = join(storageDir, "image.png");
    await writeFile(source, "image");

    await expect(
      importSource(await makeService(), source),
    ).resolves.toMatchObject({ copied: 1 });

    expect(reflink).toHaveBeenCalledExactlyOnceWith(
      source,
      expect.stringContaining(".zotlit-tmp"),
    );
  });

  it("counts a Zotero-managed source removed after confirmation as missing, without aborting the batch", async () => {
    const removed = join(storageDir, "removed.png");
    const kept = join(storageDir, "kept.png");
    await writeFile(removed, "image");
    await writeFile(kept, "image");
    hooks.beforeCopy = () => rm(removed);

    const service = await makeService();
    const batch = await service.prepare("Notes/A.md");
    for (const [path, vaultName] of [
      [removed, "removed.png"],
      [kept, "kept.png"],
    ] as const) {
      batch.resolveLink({ source: batch.decide(path, "storage"), vaultName })();
    }

    await expect(batch.flush()).resolves.toMatchObject({
      copied: 1,
      missing: 1,
      refused: 0,
    });
    await expect(readdir(attachmentsDir)).resolves.toEqual(["kept.png"]);
  });
});

describe("AttachmentImportService destination protection", () => {
  it("rejects an existing symbolic link at the destination without writing through it", async () => {
    const source = join(storageDir, "image.png");
    await writeFile(source, "image");

    const outsideTarget = join(dir, "outside.txt");
    await writeFile(outsideTarget, "untouched");

    const dest = join(attachmentsDir, "IMG-image.png");
    await symlink(outsideTarget, dest);

    await expect(importSource(await makeService(), source)).rejects.toThrow();

    // The symlink's target is never opened for writing...
    expect(await readFile(outsideTarget, "utf8")).toBe("untouched");
    // ...and the symlink itself is left in place, not followed.
    expect((await lstat(dest)).isSymbolicLink()).toBe(true);
  });

  it("leaves no temporary file behind after an interrupted copy", async () => {
    const source = join(storageDir, "image.png");
    await writeFile(source, "image");

    // A directory at the destination makes the final rename fail, after the
    // temp file has already been written.
    await mkdir(join(attachmentsDir, "IMG-image.png"));

    await expect(importSource(await makeService(), source)).rejects.toThrow();

    const entries = await readdir(attachmentsDir);
    expect(entries.filter((name) => name.endsWith(".zotlit-tmp"))).toEqual([]);
  });
});
