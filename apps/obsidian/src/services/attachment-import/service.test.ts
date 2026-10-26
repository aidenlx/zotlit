import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Logger, References, Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
import { afterEach, beforeEach, describe, expect, vi } from "vitest";

import { MemoryDeviceStorage } from "@/lib/__fixtures__/obsidian-device-storage";
import { copyAttachments } from "@/lib/copy-attachments";

import { attachmentImportFixture } from "./__fixtures__";
import type { AttachmentImportFixtureOptions } from "./__fixtures__";

vi.mock("@/lib/copy-attachments", () => ({
  copyAttachments: vi.fn((items: readonly unknown[]) =>
    Effect.succeed({ copied: items.length, skipped: 0, missing: 0 }),
  ),
}));

/** Whether the temp file system finds a folder by a name in another letter case. */
const TEMP_FOLDS_CASE = (() => {
  const probe = mkdtempSync(join(tmpdir(), "zotlit-case-probe-"));
  try {
    mkdirSync(join(probe, "Probe"));
    return existsSync(join(probe, "probe"));
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

/** A Zotero data directory on disk; the canonical roots resolve against it. */
let dataDir: string;
let storageDir: string;
let cacheDir: string;
let baseDir: string;
let outsideDir: string;

/** Attachment Import over the temporary Zotero directory. */
function makeService(options: Partial<AttachmentImportFixtureOptions> = {}) {
  return attachmentImportFixture({
    dataDir,
    baseAttachmentPath: null,
    ...options,
  });
}

/** An attachment file inside `dir`, returned as its absolute path. */
function makeFile(dir: string, name: string) {
  return Effect.promise(async () => {
    const path = join(dir, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "bytes");
    return path;
  });
}

const NOTHING = {
  copied: 0,
  skipped: 0,
  missing: 0,
  blocked: 0,
  refused: 0,
};

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

describe("AttachmentImport", () => {
  it.effect("returns a file URI link when import is disabled", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService({ importEnabled: false });
      const batch = yield* service.prepare("Notes/A.md");
      const image = yield* makeFile(cacheDir, "library/ANNOT.png");

      expect(
        batch.resolveLink({
          source: batch.decide(image, "annotation-cache"),
          vaultName: "ANNOT.png",
        })(),
      ).toBe(`[ANNOT.png](file://${image})`);
      // Nothing is written with import off, so nothing is judged and nothing
      // is reported as skipped.
      expect(yield* batch.flush).toEqual(NOTHING);
      expect(copyAttachments).toHaveBeenCalledWith([]);
    }),
  );

  it.effect(
    "blocks an absolute linked file outside every root, links it, and counts it",
    () =>
      Effect.gen(function* () {
        const { service } = yield* makeService();
        const batch = yield* service.prepare("Notes/A.md");
        const outside = yield* makeFile(outsideDir, "elsewhere.pdf");

        expect(
          batch.resolveLink({
            source: batch.decide(outside, "linked-absolute"),
            vaultName: "elsewhere.pdf",
          })(),
        ).toBe(`[elsewhere.pdf](file://${outside})`);
        expect(yield* batch.flush).toEqual({ ...NOTHING, blocked: 1 });
        expect(copyAttachments).toHaveBeenCalledWith([]);
      }),
  );

  it.effect(
    "logs a rendered blocked source at the flush, with its origin and reason only",
    () =>
      Effect.gen(function* () {
        const { service } = yield* makeService();
        const batch = yield* service.prepare("Notes/A.md");
        const outside = yield* makeFile(outsideDir, "elsewhere.pdf");
        batch.resolveLink({
          source: batch.decide(outside, "linked-absolute"),
          vaultName: "elsewhere.pdf",
        })();
        const records: {
          message: unknown;
          annotations: Record<string, unknown>;
        }[] = [];
        const capture = Logger.make(({ message, fiber }) => {
          records.push({
            message,
            annotations: fiber.getRef(References.CurrentLogAnnotations),
          });
        });

        yield* batch.flush.pipe(Effect.provide(Logger.layer([capture])));

        const blocked = records.filter((record) =>
          JSON.stringify(record.message).includes("Blocked attachment source"),
        );
        expect(blocked).toEqual([
          expect.objectContaining({
            annotations: expect.objectContaining({
              origin: "linked-absolute",
              reason: "no-trusted-root",
            }),
          }),
        ]);
        expect(JSON.stringify(blocked)).not.toContain(outside);
      }),
  );

  it.effect(
    "imports a storage file, an annotation cache image, and a base-directory linked file",
    () =>
      Effect.gen(function* () {
        const { service } = yield* makeService({
          baseAttachmentPath: baseDir,
        });
        const batch = yield* service.prepare("Notes/A.md");
        const stored = yield* makeFile(storageDir, "IMG12345/image.png");
        const cached = yield* makeFile(cacheDir, "library/ANNOT.png");
        const linked = yield* makeFile(baseDir, "papers/paper.pdf");

        expect(
          batch.resolveLink({
            source: batch.decide(stored, "storage"),
            vaultName: "IMG-image.png",
          })(),
        ).toBe("[[Attachments/IMG-image.png]]");
        batch.resolveLink({
          source: batch.decide(cached, "annotation-cache"),
          vaultName: "ANNOT.png",
        })();
        batch.resolveLink({
          source: batch.decide(linked, "linked-base"),
          vaultName: "paper.pdf",
        })();

        expect(yield* batch.flush).toEqual({ ...NOTHING, copied: 3 });
        // The origin picks the copy strategy: a Zotero-managed source keeps its
        // reflink-able path, a linked file arrives as the descriptor confirmed
        // for it.
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
      }),
  );

  it.effect(
    "blocks a base-directory linked file when the base preference is unset",
    () =>
      Effect.gen(function* () {
        const { service } = yield* makeService({ baseAttachmentPath: null });
        const batch = yield* service.prepare("Notes/A.md");
        const linked = yield* makeFile(baseDir, "paper.pdf");

        expect(batch.decide(linked, "linked-base").approved).toBe(false);
      }),
  );

  it.effect("follows a base directory that moved between operations", () =>
    Effect.gen(function* () {
      const movedBase = join(dataDir, "moved-base");
      yield* Effect.promise(() => mkdir(movedBase));
      const { service, moveZotero } = yield* makeService({
        baseAttachmentPath: baseDir,
      });
      const linked = yield* makeFile(movedBase, "paper.pdf");

      expect(
        (yield* service.prepare("Notes/A.md")).decide(linked, "linked-base")
          .approved,
      ).toBe(false);

      // No change is announced: the next operation reads the new location.
      yield* moveZotero(
        { dataDir, baseAttachmentPath: movedBase },
        { announce: false },
      );

      expect(
        (yield* service.prepare("Notes/A.md")).decide(linked, "linked-base")
          .approved,
      ).toBe(true);
    }),
  );

  it.effect(
    "rebuilds the snapshot when the resolved Zotero location changes",
    () =>
      Effect.gen(function* () {
        const movedDataDir = join(dataDir, "moved-data");
        yield* Effect.promise(() =>
          mkdir(join(movedDataDir, "storage"), { recursive: true }),
        );
        const { service, moveZotero } = yield* makeService();
        const stored = yield* makeFile(
          movedDataDir,
          "storage/IMG12345/image.png",
        );
        // The annot view holds one handle across every drag out of the active
        // note, so the rebuild has to reach a batch prepared before the pref
        // moved.
        const batch = yield* service.prepare("Notes/A.md");

        expect(batch.decide(stored, "storage").approved).toBe(false);
        const rebuilt = yield* Stream.runCollect(
          service.rootsChanges.pipe(Stream.drop(1), Stream.take(1)),
        ).pipe(Effect.forkChild({ startImmediately: true }));

        yield* moveZotero({ dataDir: movedDataDir, baseAttachmentPath: null });
        yield* Fiber.join(rebuilt);
        expect(batch.decide(stored, "storage").approved).toBe(true);
      }),
  );

  it.effect(
    "produces one summary for a batch holding both approved and blocked sources",
    () =>
      Effect.gen(function* () {
        const { service } = yield* makeService();
        const skips = yield* Stream.runCollect(
          service.skipped.pipe(Stream.take(1)),
        ).pipe(Effect.forkChild({ startImmediately: true }));
        const batch = yield* service.prepare("Notes/A.md");
        const stored = yield* makeFile(storageDir, "IMG12345/image.png");
        const outsideA = yield* makeFile(outsideDir, "a.pdf");
        const outsideB = yield* makeFile(outsideDir, "b.pdf");

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

        expect(yield* batch.flush).toEqual({
          ...NOTHING,
          copied: 1,
          blocked: 2,
        });
        yield* TestClock.adjust("1500 millis");
        expect(yield* Fiber.join(skips)).toEqual([
          { blocked: 2, refused: 0, blockedFolders: [outsideDir] },
        ]);
      }),
  );

  it.effect(
    "pools the skips of operations that settle within the idle window into one summary",
    () =>
      Effect.gen(function* () {
        const { service } = yield* makeService();
        const summaries = yield* Stream.runCollect(
          service.skipped.pipe(Stream.take(1)),
        ).pipe(Effect.forkChild({ startImmediately: true }));
        const blockOne = (name: string) =>
          Effect.gen(function* () {
            const batch = yield* service.prepare("Notes/A.md");
            const outside = yield* makeFile(outsideDir, name);
            batch.resolveLink({
              source: batch.decide(outside, "linked-absolute"),
              vaultName: name,
            })();
            yield* batch.flush;
          });

        yield* blockOne("a.pdf");
        // Each flush restarts the window, so nothing is announced yet.
        yield* TestClock.adjust("1000 millis");
        yield* blockOne("b.pdf");
        yield* TestClock.adjust("1000 millis");
        expect(summaries.pollUnsafe()).toBeUndefined();

        yield* TestClock.adjust("500 millis");
        expect(yield* Fiber.join(summaries)).toEqual([
          { blocked: 2, refused: 0, blockedFolders: [outsideDir] },
        ]);
      }),
  );

  it.effect(
    "counts and copies nothing a second time when the same batch is flushed again",
    () =>
      Effect.gen(function* () {
        const { service } = yield* makeService();
        const batch = yield* service.prepare("Notes/A.md");
        const stored = yield* makeFile(storageDir, "IMG12345/image.png");
        const outside = yield* makeFile(outsideDir, "elsewhere.pdf");

        batch.resolveLink({
          source: batch.decide(stored, "storage"),
          vaultName: "IMG-image.png",
        })();
        batch.resolveLink({
          source: batch.decide(outside, "linked-absolute"),
          vaultName: "elsewhere.pdf",
        })();

        yield* batch.flush;
        expect(yield* batch.flush).toEqual(NOTHING);
        expect(copyAttachments).toHaveBeenLastCalledWith([]);
      }),
  );

  it.effect(
    "imports through a Zotero data directory that is itself a symbolic link",
    () =>
      Effect.gen(function* () {
        const linkedDataDir = join(dataDir, "link-to-data");
        const realDataDir = join(dataDir, "real-data");
        const stored = join(realDataDir, "storage", "IMG12345", "image.png");
        yield* Effect.promise(async () => {
          await mkdir(join(realDataDir, "storage", "IMG12345"), {
            recursive: true,
          });
          await writeFile(stored, "bytes");
          await symlink(realDataDir, linkedDataDir);
        });

        const { service } = yield* makeService({ dataDir: linkedDataDir });
        const batch = yield* service.prepare("Notes/A.md");
        const declared = join(
          linkedDataDir,
          "storage",
          "IMG12345",
          "image.png",
        );

        batch.resolveLink({
          source: batch.decide(declared, "storage"),
          vaultName: "IMG-image.png",
        })();

        expect(yield* batch.flush).toMatchObject({ copied: 1 });
        // The copy reads the confirmed canonical path, not the declared one.
        expect(copyAttachments).toHaveBeenCalledWith([
          {
            source: { kind: "path", path: stored },
            dest: "/vault/Attachments/IMG-image.png",
          },
        ]);
      }),
  );

  it.effect("queues nothing until the link is rendered", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService();
      const batch = yield* service.prepare("Notes/A.md");
      const stored = yield* makeFile(storageDir, "IMG12345/image.png");

      // Resolve the link but never invoke it — the excerpt is never embedded.
      batch.resolveLink({
        source: batch.decide(stored, "storage"),
        vaultName: "IMG-image.png",
      });
      expect(yield* batch.flush).toEqual(NOTHING);
      expect(copyAttachments).toHaveBeenCalledWith([]);
    }),
  );

  it.effect(
    "creates the attachment folder lazily, only when a copy is queued",
    () =>
      Effect.gen(function* () {
        const { service, vault } = yield* makeService({
          folderPath: "NewFolder",
        });
        const batch = yield* service.prepare("Notes/A.md");
        const stored = yield* makeFile(storageDir, "IMG12345/image.png");

        // Resolving a link or flushing with nothing embedded must not create a
        // folder.
        const link = batch.resolveLink({
          source: batch.decide(stored, "storage"),
          vaultName: "IMG-image.png",
        });
        yield* batch.flush;
        expect(vault.folders.has("NewFolder")).toBe(false);

        // Render the link, then flush: now the folder is created.
        link();
        yield* batch.flush;
        expect(vault.folders.has("NewFolder")).toBe(true);
      }),
  );

  it.effect(
    "fails the flush when a file holds the attachment folder's path",
    () =>
      Effect.gen(function* () {
        const { service, vault } = yield* makeService({
          folderPath: "Taken",
        });
        vault.add("Taken");
        const batch = yield* service.prepare("Notes/A.md");
        const stored = yield* makeFile(storageDir, "IMG12345/image.png");
        batch.resolveLink({
          source: batch.decide(stored, "storage"),
          vaultName: "IMG-image.png",
        })();

        const error = yield* Effect.flip(batch.flush);

        expect(error).toMatchObject({
          _tag: "VaultFolderBlockedError",
          path: "Taken",
        });
        expect(copyAttachments).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "reduces a hostile attachment filename to a single segment inside the attachment folder",
    () =>
      Effect.gen(function* () {
        const { service } = yield* makeService();
        const batch = yield* service.prepare("Notes/A.md");
        const stored = yield* makeFile(storageDir, "IMG12345/evil.png");

        batch.resolveLink({
          source: batch.decide(stored, "storage"),
          vaultName: "../../../../etc/passwd",
        })();
        yield* batch.flush;

        expect(copyAttachments).toHaveBeenCalledTimes(1);
        const [items] = vi.mocked(copyAttachments).mock.calls[0]!;
        expect(items).toHaveLength(1);
        const { dest } = items[0]!;
        expect(dest.startsWith("/vault/Attachments/")).toBe(true);
        expect(dest.slice("/vault/Attachments/".length)).not.toContain("/");
      }),
  );

  it.effect("queues a copy once across repeated link renders", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService();
      const batch = yield* service.prepare("Notes/A.md");
      const stored = yield* makeFile(storageDir, "IMG12345/image.png");

      const link = batch.resolveLink({
        source: batch.decide(stored, "storage"),
        vaultName: "IMG-image.png",
      });
      link();
      link();
      expect(yield* batch.flush).toEqual({ ...NOTHING, copied: 1 });
      expect(copyAttachments).toHaveBeenCalledWith([
        {
          source: { kind: "path", path: stored },
          dest: "/vault/Attachments/IMG-image.png",
        },
      ]);
    }),
  );

  it.effect("drops what was queued when the batch is discarded", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService();
      const batch = yield* service.prepare("Notes/A.md");
      const stored = yield* makeFile(storageDir, "IMG12345/image.png");
      batch.resolveLink({
        source: batch.decide(stored, "storage"),
        vaultName: "IMG-image.png",
      })();

      yield* batch.discard;

      expect(yield* batch.flush).toEqual(NOTHING);
      expect(copyAttachments).toHaveBeenCalledWith([]);
    }),
  );
});

describe("AttachmentImport approved folders", () => {
  it.effect("imports an absolute linked file once its folder is approved", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService();
      const linked = yield* makeFile(outsideDir, "scan.pdf");
      expect(
        (yield* service.prepare("Notes/A.md")).decide(linked, "linked-absolute")
          .approved,
      ).toBe(false);

      yield* service.approveFolder(outsideDir);

      const batch = yield* service.prepare("Notes/A.md");
      batch.resolveLink({
        source: batch.decide(linked, "linked-absolute"),
        vaultName: "scan.pdf",
      })();
      expect(yield* batch.flush).toMatchObject({
        copied: 1,
        blocked: 0,
        refused: 0,
      });
    }),
  );

  it.effect("stops importing from a folder whose approval is taken back", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService();
      const linked = yield* makeFile(outsideDir, "scan.pdf");
      yield* service.approveFolder(outsideDir);

      yield* service.revokeFolder((yield* service.approvedFolders)[0]!);

      expect(yield* service.approvedFolders).toEqual([]);
      expect(
        (yield* service.prepare("Notes/A.md")).decide(linked, "linked-absolute")
          .approved,
      ).toBe(false);
    }),
  );

  it.effect("announces the approved folders after each change", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService();
      const changes = yield* Stream.runCollect(
        service.approvedFoldersChanges.pipe(Stream.take(3)),
      ).pipe(Effect.forkChild({ startImmediately: true }));

      yield* service.approveFolder(outsideDir);
      // Approving a folder already approved changes nothing.
      yield* service.approveFolder(outsideDir);
      yield* service.revokeFolder(outsideDir);

      expect(yield* Fiber.join(changes)).toEqual([[], [outsideDir], []]);
    }),
  );

  it.effect(
    "ends the approved folders and skip streams when the layer closes",
    () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const { service } = yield* makeService().pipe(Scope.provide(scope));
        const changes = yield* Stream.runCollect(
          service.approvedFoldersChanges,
        ).pipe(Effect.forkChild({ startImmediately: true }));
        const skips = yield* Stream.runCollect(service.skipped).pipe(
          Effect.forkChild({ startImmediately: true }),
        );

        yield* Scope.close(scope, Exit.void);

        expect(yield* Fiber.join(changes)).toEqual([[]]);
        expect(yield* Fiber.join(skips)).toEqual([]);
      }),
  );

  it.effect(
    "keeps an approval across a restart, and out of another vault",
    () =>
      Effect.gen(function* () {
        const storage = new MemoryDeviceStorage();
        const granted = yield* makeService({ storage });
        yield* granted.service.approveFolder(outsideDir);
        const linked = yield* makeFile(outsideDir, "scan.pdf");

        // The same vault on the same device, restarted: the grant is still there.
        const restarted = yield* makeService({ storage });
        expect(yield* restarted.service.approvedFolders).toEqual([outsideDir]);
        expect(
          (yield* restarted.service.prepare("Notes/A.md")).decide(
            linked,
            "linked-absolute",
          ).approved,
        ).toBe(true);

        // Another vault reads its own store, so nothing was granted there.
        const otherVault = yield* makeService({
          storage: new MemoryDeviceStorage(),
        });
        expect(yield* otherVault.service.approvedFolders).toEqual([]);
      }),
  );

  it.effect(
    "stops matching an approved folder replaced by a link to another location",
    () =>
      Effect.gen(function* () {
        const { service } = yield* makeService();
        const linked = yield* makeFile(outsideDir, "scan.pdf");
        yield* service.approveFolder(outsideDir);
        expect(
          (yield* service.prepare("Notes/A.md")).decide(
            linked,
            "linked-absolute",
          ).approved,
        ).toBe(true);

        const elsewhere = join(dataDir, "elsewhere");
        const inElsewhere = yield* makeFile(elsewhere, "scan.pdf");
        yield* Effect.promise(async () => {
          await rm(outsideDir, { recursive: true });
          await symlink(elsewhere, outsideDir);
        });

        // The grant is gone rather than moved: neither the path the user
        // approved nor the location the link now points at is a source.
        const batch = yield* service.prepare("Notes/A.md");
        expect(batch.decide(linked, "linked-absolute").approved).toBe(false);
        expect(batch.decide(inElsewhere, "linked-absolute").approved).toBe(
          false,
        );
      }),
  );

  it.effect.skipIf(!TEMP_FOLDS_CASE)(
    "keeps one record for one folder approved in two letter cases",
    () =>
      Effect.gen(function* () {
        const { service } = yield* makeService();
        const folder = join(dataDir, "CaseDir");
        yield* Effect.promise(() => mkdir(folder));

        expect(yield* service.approveFolder(folder)).toBe(folder);
        expect(yield* service.approveFolder(join(dataDir, "casedir"))).toBe(
          folder,
        );
        expect(yield* service.approvedFolders).toEqual([folder]);
      }),
  );

  it.effect("grants nothing for a folder that does not resolve", () =>
    Effect.gen(function* () {
      const { service } = yield* makeService();

      expect(yield* service.approveFolder(join(dataDir, "gone"))).toBeNull();
      expect(yield* service.approvedFolders).toEqual([]);
    }),
  );
});
