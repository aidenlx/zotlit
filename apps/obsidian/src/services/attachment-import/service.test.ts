import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystemAdapter, TFolder, type App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { copyAttachments } from "@/lib/copy-attachments";

import { AttachmentImportService, type AttachmentSkipSummary } from "./service";
import { makeDeviceStorage } from "./test-utils";

vi.mock("@/lib/copy-attachments", () => ({
  copyAttachments: vi.fn(async (items: readonly unknown[]) => ({
    copied: items.length,
    skipped: 0,
    missing: 0,
  })),
}));

/** A Zotero data directory on disk; the canonical roots resolve against it. */
let dataDir: string;
let storageDir: string;
let cacheDir: string;
let baseDir: string;
let outsideDir: string;

function makeFolder(path: string): TFolder {
  const folder = new TFolder();
  folder.path = path;
  return folder;
}

function makeApp(storage = makeDeviceStorage()): App {
  const root = makeFolder("/");
  const attachments = makeFolder("Attachments");
  return {
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
    vault: {
      adapter: new FileSystemAdapter(),
      getRoot: () => root,
      getAbstractFileByPath: (path: string) =>
        path === "Attachments" ? attachments : null,
      createFolder: vi.fn(),
    },
    fileManager: {
      getAvailablePathForAttachment: vi.fn(async () => "Attachments/file.png"),
      generateMarkdownLink: (file: { name: string }) => `[[${file.name}]]`,
    },
  } as unknown as App;
}

function makeSettings(value: {
  "attachment.import": boolean;
  "attachment.folder-path": string | null;
}) {
  return {
    loaded: Promise.resolve(value),
    subscribe: () => () => undefined,
  };
}

/**
 * A mutable stand-in for `ZoteroPrefService`, carrying the `resolved-changed`
 * event the import service rebuilds its root snapshot on.
 */
function makeZoteroPref(values: {
  dataDir: string;
  baseAttachmentPath: string | null;
}) {
  const listeners = new Set<() => void>();
  return {
    ...values,
    on(_event: "resolved-changed", cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    /** Announce that the resolved Zotero location moved. */
    emitResolvedChanged() {
      for (const cb of listeners) cb();
    },
  };
}

/** A ready service over the temporary Zotero directory. */
async function makeService(options?: {
  importEnabled?: boolean;
  folderPath?: string;
  baseAttachmentPath?: string | null;
  app?: App;
}): Promise<AttachmentImportService> {
  const service = new AttachmentImportService({
    app: options?.app ?? makeApp(),
    settings: makeSettings({
      "attachment.import": options?.importEnabled ?? true,
      "attachment.folder-path": options?.folderPath ?? "Attachments",
    }) as any,
    zoteroPref: makeZoteroPref({
      dataDir,
      baseAttachmentPath:
        options?.baseAttachmentPath === undefined
          ? null
          : options.baseAttachmentPath,
    }),
  });
  await service.ready;
  return service;
}

/** An attachment file inside `dir`, returned as its absolute path. */
async function makeFile(dir: string, name: string): Promise<string> {
  const path = join(dir, name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "bytes");
  return path;
}

beforeEach(async () => {
  vi.clearAllMocks();
  // Canonicalized up front (macOS hands out a symlinked temp dir), so a queued
  // copy's declared path and its confirmed canonical path are the same string.
  dataDir = await realpath(
    await mkdtemp(join(tmpdir(), "zotlit-attachment-import-")),
  );
  storageDir = join(dataDir, "storage");
  cacheDir = join(dataDir, "cache");
  baseDir = join(dataDir, "base");
  outsideDir = join(dataDir, "outside");
  await Promise.all(
    [storageDir, cacheDir, baseDir, outsideDir].map((dir) => mkdir(dir)),
  );
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("AttachmentImportService", () => {
  it("returns a file URI link when import is disabled", async () => {
    const service = await makeService({ importEnabled: false });
    const batch = await service.prepare("Notes/A.md");
    const image = await makeFile(cacheDir, "library/ANNOT.png");

    expect(
      batch.resolveLink({
        source: batch.decide(image, "annotation-cache"),
        vaultName: "ANNOT.png",
      })(),
    ).toBe(`[ANNOT.png](file://${image})`);
    // Nothing is written with import off, so nothing is judged and nothing is
    // reported as skipped.
    await expect(batch.flush()).resolves.toEqual({
      copied: 0,
      skipped: 0,
      missing: 0,
      blocked: 0,
      refused: 0,
    });
    expect(copyAttachments).toHaveBeenCalledWith([]);
  });

  it("blocks an absolute linked file outside every root, links it, and counts it", async () => {
    const service = await makeService();
    const batch = await service.prepare("Notes/A.md");
    const outside = await makeFile(outsideDir, "elsewhere.pdf");

    expect(
      batch.resolveLink({
        source: batch.decide(outside, "linked-absolute"),
        vaultName: "elsewhere.pdf",
      })(),
    ).toBe(`[elsewhere.pdf](file://${outside})`);
    await expect(batch.flush()).resolves.toEqual({
      copied: 0,
      skipped: 0,
      missing: 0,
      blocked: 1,
      refused: 0,
    });
    expect(copyAttachments).toHaveBeenCalledWith([]);
  });

  it("imports a storage file, an annotation cache image, and a base-directory linked file", async () => {
    const service = await makeService({ baseAttachmentPath: baseDir });
    const batch = await service.prepare("Notes/A.md");
    const stored = await makeFile(storageDir, "IMG12345/image.png");
    const cached = await makeFile(cacheDir, "library/ANNOT.png");
    const linked = await makeFile(baseDir, "papers/paper.pdf");

    expect(
      batch.resolveLink({
        source: batch.decide(stored, "storage"),
        vaultName: "IMG-image.png",
      })(),
    ).toBe("[[IMG-image.png]]");
    batch.resolveLink({
      source: batch.decide(cached, "annotation-cache"),
      vaultName: "ANNOT.png",
    })();
    batch.resolveLink({
      source: batch.decide(linked, "linked-base"),
      vaultName: "paper.pdf",
    })();

    await expect(batch.flush()).resolves.toEqual({
      copied: 3,
      skipped: 0,
      missing: 0,
      blocked: 0,
      refused: 0,
    });
    // The origin picks the copy strategy: a Zotero-managed source keeps its
    // reflink-able path, a linked file arrives as the descriptor confirmed for
    // it.
    expect(copyAttachments).toHaveBeenCalledWith([
      {
        source: { kind: "path", path: stored },
        dest: "/vault/Attachments/IMG-image.png",
      },
      {
        source: { kind: "path", path: cached },
        dest: "/vault/Attachments/ANNOT.png",
      },
      {
        source: { kind: "handle", handle: expect.anything() },
        dest: "/vault/Attachments/paper.pdf",
      },
    ]);
  });

  it("blocks a base-directory linked file when the base preference is unset", async () => {
    const service = await makeService({ baseAttachmentPath: null });
    const batch = await service.prepare("Notes/A.md");
    const linked = await makeFile(baseDir, "paper.pdf");

    expect(batch.decide(linked, "linked-base").approved).toBe(false);
  });

  it("follows a base directory that moved between operations", async () => {
    const movedBase = join(dataDir, "moved-base");
    await mkdir(movedBase);
    const zoteroPref = makeZoteroPref({
      dataDir,
      baseAttachmentPath: baseDir,
    });
    const service = new AttachmentImportService({
      app: makeApp(),
      settings: makeSettings({
        "attachment.import": true,
        "attachment.folder-path": "Attachments",
      }) as any,
      zoteroPref,
    });
    await service.ready;
    const linked = await makeFile(movedBase, "paper.pdf");

    expect(
      (await service.prepare("Notes/A.md")).decide(linked, "linked-base")
        .approved,
    ).toBe(false);

    zoteroPref.baseAttachmentPath = movedBase;

    expect(
      (await service.prepare("Notes/A.md")).decide(linked, "linked-base")
        .approved,
    ).toBe(true);
  });

  it("rebuilds the snapshot when the resolved Zotero location changes", async () => {
    const movedDataDir = join(dataDir, "moved-data");
    await mkdir(join(movedDataDir, "storage"), { recursive: true });
    const zoteroPref = makeZoteroPref({ dataDir, baseAttachmentPath: null });
    const service = new AttachmentImportService({
      app: makeApp(),
      settings: makeSettings({
        "attachment.import": true,
        "attachment.folder-path": "Attachments",
      }) as any,
      zoteroPref,
    });
    await service.ready;
    const stored = await makeFile(movedDataDir, "storage/IMG12345/image.png");
    // The annot view holds one handle across every drag out of the active note,
    // so the rebuild has to reach a batch prepared before the pref moved.
    const batch = await service.prepare("Notes/A.md");

    expect(batch.decide(stored, "storage").approved).toBe(false);

    zoteroPref.dataDir = movedDataDir;
    zoteroPref.emitResolvedChanged();
    await vi.waitFor(() =>
      expect(batch.decide(stored, "storage").approved).toBe(true),
    );
  });

  it("produces one summary for a batch holding both approved and blocked sources", async () => {
    const service = await makeService();
    const skips: AttachmentSkipSummary[] = [];
    service.on("sources-skipped", (summary) => skips.push(summary));
    const batch = await service.prepare("Notes/A.md");
    const stored = await makeFile(storageDir, "IMG12345/image.png");
    const outsideA = await makeFile(outsideDir, "a.pdf");
    const outsideB = await makeFile(outsideDir, "b.pdf");

    batch.resolveLink({
      source: batch.decide(stored, "storage"),
      vaultName: "IMG-image.png",
    })();
    for (const [index, path] of [outsideA, outsideB].entries()) {
      batch.resolveLink({
        source: batch.decide(path, "linked-absolute"),
        vaultName: `outside-${index}.pdf`,
      })();
    }

    await expect(batch.flush()).resolves.toEqual({
      copied: 1,
      skipped: 0,
      missing: 0,
      blocked: 2,
      refused: 0,
    });
    service.flushSkipSummary();
    expect(skips).toEqual([
      { blocked: 2, refused: 0, blockedFolders: [outsideDir] },
    ]);
  });

  it("counts and copies nothing a second time when the same batch is flushed again", async () => {
    const service = await makeService();
    const batch = await service.prepare("Notes/A.md");
    const stored = await makeFile(storageDir, "IMG12345/image.png");
    const outside = await makeFile(outsideDir, "elsewhere.pdf");

    batch.resolveLink({
      source: batch.decide(stored, "storage"),
      vaultName: "IMG-image.png",
    })();
    batch.resolveLink({
      source: batch.decide(outside, "linked-absolute"),
      vaultName: "elsewhere.pdf",
    })();

    await batch.flush();
    await expect(batch.flush()).resolves.toEqual({
      copied: 0,
      skipped: 0,
      missing: 0,
      blocked: 0,
      refused: 0,
    });
    expect(copyAttachments).toHaveBeenLastCalledWith([]);
  });

  it("imports through a Zotero data directory that is itself a symbolic link", async () => {
    const linkedDataDir = join(dataDir, "link-to-data");
    const realDataDir = join(dataDir, "real-data");
    await mkdir(join(realDataDir, "storage", "IMG12345"), { recursive: true });
    const stored = join(realDataDir, "storage", "IMG12345", "image.png");
    await writeFile(stored, "bytes");
    await symlink(realDataDir, linkedDataDir);

    const service = new AttachmentImportService({
      app: makeApp(),
      settings: makeSettings({
        "attachment.import": true,
        "attachment.folder-path": "Attachments",
      }) as any,
      zoteroPref: makeZoteroPref({
        dataDir: linkedDataDir,
        baseAttachmentPath: null,
      }),
    });
    await service.ready;
    const batch = await service.prepare("Notes/A.md");
    const declared = join(linkedDataDir, "storage", "IMG12345", "image.png");

    batch.resolveLink({
      source: batch.decide(declared, "storage"),
      vaultName: "IMG-image.png",
    })();

    await expect(batch.flush()).resolves.toMatchObject({ copied: 1 });
    // The copy reads the confirmed canonical path, not the declared one.
    expect(copyAttachments).toHaveBeenCalledWith([
      {
        source: { kind: "path", path: stored },
        dest: "/vault/Attachments/IMG-image.png",
      },
    ]);
  });

  it("queues nothing until the link is rendered", async () => {
    const service = await makeService();
    const batch = await service.prepare("Notes/A.md");
    const stored = await makeFile(storageDir, "IMG12345/image.png");

    // Resolve the link but never invoke it — the excerpt is never embedded.
    batch.resolveLink({
      source: batch.decide(stored, "storage"),
      vaultName: "IMG-image.png",
    });
    await expect(batch.flush()).resolves.toEqual({
      copied: 0,
      skipped: 0,
      missing: 0,
      blocked: 0,
      refused: 0,
    });
    expect(copyAttachments).toHaveBeenCalledWith([]);
  });

  it("creates the attachment folder lazily, only when a copy is queued", async () => {
    const app = makeApp();
    const service = await makeService({ app, folderPath: "NewFolder" });
    const batch = await service.prepare("Notes/A.md");
    const stored = await makeFile(storageDir, "IMG12345/image.png");

    // Resolving a link or flushing with nothing embedded must not create a folder.
    const link = batch.resolveLink({
      source: batch.decide(stored, "storage"),
      vaultName: "IMG-image.png",
    });
    await batch.flush();
    // oxlint-disable-next-line typescript/unbound-method
    expect(app.vault.createFolder).not.toHaveBeenCalled();

    // Render the link, then flush: now the folder is created, once.
    link();
    await batch.flush();
    // oxlint-disable-next-line typescript/unbound-method
    expect(app.vault.createFolder).toHaveBeenCalledExactlyOnceWith("NewFolder");
  });

  it("reduces a hostile attachment filename to a single segment inside the attachment folder", async () => {
    const service = await makeService();
    const batch = await service.prepare("Notes/A.md");
    const stored = await makeFile(storageDir, "IMG12345/evil.png");

    batch.resolveLink({
      source: batch.decide(stored, "storage"),
      vaultName: "../../../../etc/passwd",
    })();
    await batch.flush();

    expect(copyAttachments).toHaveBeenCalledTimes(1);
    const [items] = vi.mocked(copyAttachments).mock.calls[0]!;
    expect(items).toHaveLength(1);
    const { dest } = items[0]!;
    expect(dest.startsWith("/vault/Attachments/")).toBe(true);
    expect(dest.slice("/vault/Attachments/".length)).not.toContain("/");
  });

  it("queues a copy once across repeated link renders", async () => {
    const service = await makeService();
    const batch = await service.prepare("Notes/A.md");
    const stored = await makeFile(storageDir, "IMG12345/image.png");

    const link = batch.resolveLink({
      source: batch.decide(stored, "storage"),
      vaultName: "IMG-image.png",
    });
    link();
    link();
    await expect(batch.flush()).resolves.toEqual({
      copied: 1,
      skipped: 0,
      missing: 0,
      blocked: 0,
      refused: 0,
    });
    expect(copyAttachments).toHaveBeenCalledWith([
      {
        source: { kind: "path", path: stored },
        dest: "/vault/Attachments/IMG-image.png",
      },
    ]);
  });
});

describe("AttachmentImportService approved folders", () => {
  it("imports an absolute linked file once its folder is approved", async () => {
    const service = await makeService();
    const linked = await makeFile(outsideDir, "scan.pdf");
    expect(
      (await service.prepare("Notes/A.md")).decide(linked, "linked-absolute")
        .approved,
    ).toBe(false);

    await service.approveFolder(outsideDir);

    const batch = await service.prepare("Notes/A.md");
    batch.resolveLink({
      source: batch.decide(linked, "linked-absolute"),
      vaultName: "scan.pdf",
    })();
    await expect(batch.flush()).resolves.toMatchObject({
      copied: 1,
      blocked: 0,
      refused: 0,
    });
  });

  it("stops importing from a folder whose approval is taken back", async () => {
    const service = await makeService();
    const linked = await makeFile(outsideDir, "scan.pdf");
    await service.approveFolder(outsideDir);

    await service.revokeFolder(service.approvedFolders[0]!);

    expect(service.approvedFolders).toEqual([]);
    expect(
      (await service.prepare("Notes/A.md")).decide(linked, "linked-absolute")
        .approved,
    ).toBe(false);
  });

  it("keeps an approval across a restart, and out of another vault", async () => {
    const storage = makeDeviceStorage();
    const granted = await makeService({ app: makeApp(storage) });
    await granted.approveFolder(outsideDir);
    const linked = await makeFile(outsideDir, "scan.pdf");

    // The same vault on the same device, restarted: the grant is still there.
    const restarted = await makeService({ app: makeApp(storage) });
    expect(restarted.approvedFolders).toEqual([outsideDir]);
    expect(
      (await restarted.prepare("Notes/A.md")).decide(linked, "linked-absolute")
        .approved,
    ).toBe(true);

    // Another vault reads its own store, so nothing was granted there.
    const otherVault = await makeService({ app: makeApp(makeDeviceStorage()) });
    expect(otherVault.approvedFolders).toEqual([]);
  });

  it("stops matching an approved folder replaced by a link to another location", async () => {
    const service = await makeService();
    const linked = await makeFile(outsideDir, "scan.pdf");
    await service.approveFolder(outsideDir);
    expect(
      (await service.prepare("Notes/A.md")).decide(linked, "linked-absolute")
        .approved,
    ).toBe(true);

    const elsewhere = join(dataDir, "elsewhere");
    const inElsewhere = await makeFile(elsewhere, "scan.pdf");
    await rm(outsideDir, { recursive: true });
    await symlink(elsewhere, outsideDir);

    // The grant is gone rather than moved: neither the path the user approved
    // nor the location the link now points at is a source.
    const batch = await service.prepare("Notes/A.md");
    expect(batch.decide(linked, "linked-absolute").approved).toBe(false);
    expect(batch.decide(inElsewhere, "linked-absolute").approved).toBe(false);
  });

  it("grants nothing for a folder that does not resolve", async () => {
    const service = await makeService();

    await expect(
      service.approveFolder(join(dataDir, "gone")),
    ).resolves.toBeNull();
    expect(service.approvedFolders).toEqual([]);
  });
});
