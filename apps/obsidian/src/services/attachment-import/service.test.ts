import { FileSystemAdapter, TFolder, type App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { copyAttachments } from "@/lib/copy-attachments";

import { AttachmentImportService } from "./service";

vi.mock("@/lib/copy-attachments", () => ({
  copyAttachments: vi.fn(async (items: readonly unknown[]) => ({
    copied: items.length,
    skipped: 0,
  })),
}));

function makeFolder(path: string): TFolder {
  const folder = new TFolder();
  folder.path = path;
  return folder;
}

function makeApp(): App {
  const root = makeFolder("/");
  const attachments = makeFolder("Attachments");
  return {
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AttachmentImportService", () => {
  it("returns a file URI link when import is disabled", async () => {
    const service = new AttachmentImportService({
      app: makeApp(),
      settings: makeSettings({
        "attachment.import": false,
        "attachment.folder-path": "Attachments",
      }) as any,
    });

    const batch = await service.prepare("Notes/A.md");

    expect(
      batch.resolveLink({
        sourcePath: "/zotero/cache/library/ANNOT.png",
        vaultName: "ANNOT.png",
      })(),
    ).toBe("[ANNOT.png](file:///zotero/cache/library/ANNOT.png)");
    await expect(batch.flush()).resolves.toEqual({ copied: 0, skipped: 0 });
    expect(copyAttachments).toHaveBeenCalledWith([]);
  });

  it("precomputes vault links and flushes queued copies", async () => {
    const app = makeApp();
    const service = new AttachmentImportService({
      app,
      settings: makeSettings({
        "attachment.import": true,
        "attachment.folder-path": "Attachments",
      }) as any,
    });

    const batch = await service.prepare("Notes/A.md");

    expect(
      batch.resolveLink({
        sourcePath: "/zotero/storage/IMG/image.png",
        vaultName: "IMG-image.png",
      })(),
    ).toBe("[[IMG-image.png]]");
    await expect(batch.flush()).resolves.toEqual({ copied: 1, skipped: 0 });
    expect(copyAttachments).toHaveBeenCalledWith([
      {
        source: "/zotero/storage/IMG/image.png",
        dest: "/vault/Attachments/IMG-image.png",
      },
    ]);
  });

  it("queues nothing until the link is rendered", async () => {
    const service = new AttachmentImportService({
      app: makeApp(),
      settings: makeSettings({
        "attachment.import": true,
        "attachment.folder-path": "Attachments",
      }) as any,
    });

    const batch = await service.prepare("Notes/A.md");

    // Resolve the link but never invoke it — the excerpt is never embedded.
    batch.resolveLink({
      sourcePath: "/zotero/storage/IMG/image.png",
      vaultName: "IMG-image.png",
    });
    await expect(batch.flush()).resolves.toEqual({ copied: 0, skipped: 0 });
    expect(copyAttachments).toHaveBeenCalledWith([]);
  });

  it("creates the attachment folder lazily, only when a copy is queued", async () => {
    const app = makeApp();
    const service = new AttachmentImportService({
      app,
      settings: makeSettings({
        "attachment.import": true,
        "attachment.folder-path": "NewFolder",
      }) as any,
    });

    const batch = await service.prepare("Notes/A.md");
    // Resolving a link or flushing with nothing embedded must not create a folder.
    const link = batch.resolveLink({
      sourcePath: "/zotero/storage/IMG/image.png",
      vaultName: "IMG-image.png",
    });
    await batch.flush();
    expect(app.vault.createFolder).not.toHaveBeenCalled();

    // Render the link, then flush: now the folder is created, once.
    link();
    await batch.flush();
    expect(app.vault.createFolder).toHaveBeenCalledExactlyOnceWith("NewFolder");
  });

  it("queues a copy once across repeated link renders", async () => {
    const service = new AttachmentImportService({
      app: makeApp(),
      settings: makeSettings({
        "attachment.import": true,
        "attachment.folder-path": "Attachments",
      }) as any,
    });

    const batch = await service.prepare("Notes/A.md");

    const link = batch.resolveLink({
      sourcePath: "/zotero/storage/IMG/image.png",
      vaultName: "IMG-image.png",
    });
    link();
    link();
    await expect(batch.flush()).resolves.toEqual({ copied: 1, skipped: 0 });
    expect(copyAttachments).toHaveBeenCalledWith([
      {
        source: "/zotero/storage/IMG/image.png",
        dest: "/vault/Attachments/IMG-image.png",
      },
    ]);
  });
});
