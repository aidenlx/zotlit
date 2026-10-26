// Real-filesystem coverage for the attachment-import service seam: the
// copy-time confirmation that resolves each approved source before a byte
// moves, and the destination-containment guarantees around the write itself.
import { it } from "@effect/vitest";
import { Effect, Logger, References } from "effect";
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
import { afterEach, beforeEach, describe, expect, vi } from "vitest";

import { reflink } from "@/lib/reflink";

import { attachmentImportFixture } from "./__fixtures__";
import type { AttachmentImport } from "./service";
import type { SourceOrigin } from "./source";

/** Lets a test act in the window between the confirmation and the copy. */
const hooks = vi.hoisted(() => ({
  beforeCopy: null as (() => Promise<void>) | null,
}));

vi.mock("@/lib/copy-attachments", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/copy-attachments")>();
  return {
    ...actual,
    copyAttachments: (items: Parameters<typeof actual.copyAttachments>[0]) =>
      Effect.promise(async () => hooks.beforeCopy?.()).pipe(
        Effect.andThen(actual.copyAttachments(items)),
      ),
  };
});

// Spied rather than stubbed: whether a copy reflinks is the observable
// difference between the two strategies, and the real call still runs.
vi.mock("@/lib/reflink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reflink")>();
  return { ...actual, reflink: vi.fn(actual.reflink) };
});

let dir: string;
let vaultDir: string;
let attachmentsDir: string;
let dataDir: string;
let storageDir: string;
/** Zotero's base attachment directory, outside its data directory. */
let baseDir: string;
/** A folder the user approved on this device, outside Zotero's control. */
let approvedDir: string;

function makeService() {
  return attachmentImportFixture({
    dataDir,
    baseAttachmentPath: baseDir,
    basePath: vaultDir,
  }).pipe(Effect.map(({ service }) => service));
}

/** Queue one copy of `source` and settle the batch. */
const importSource = Effect.fnUntraced(function* (
  service: AttachmentImport["Service"],
  source: string,
  opts?: { origin?: SourceOrigin; vaultName?: string },
) {
  const batch = yield* service.prepare("Notes/A.md");
  batch.resolveLink({
    source: batch.decide(source, opts?.origin ?? "storage"),
    vaultName: opts?.vaultName ?? "IMG-image.png",
  })();
  return yield* batch.flush;
});

const fsStep = <A>(step: () => Promise<A>) => Effect.promise(() => step());

beforeEach(async () => {
  vi.clearAllMocks();
  hooks.beforeCopy = null;
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

describe("AttachmentImport copy-time confirmation", () => {
  it.effect(
    "refuses a symbolic link inside a trusted root that points outside it",
    () =>
      Effect.gen(function* () {
        const outside = join(dir, "outside.txt");
        const source = join(storageDir, "escape.png");
        yield* fsStep(async () => {
          await writeFile(outside, "secret");
          await symlink(outside, source);
        });

        const result = yield* importSource(yield* makeService(), source);

        expect(result).toMatchObject({ copied: 0, refused: 1 });
        expect(yield* fsStep(() => readdir(attachmentsDir))).toEqual([]);
      }),
  );

  // The refusal record is the support signal for a user who cannot reproduce
  // the problem, so its fields — and what they leave out — are asserted here.
  it.effect(
    "logs a refusal with its origin and reason, and without the location",
    () =>
      Effect.gen(function* () {
        const outside = join(dir, "outside.txt");
        const source = join(storageDir, "escape.png");
        yield* fsStep(async () => {
          await writeFile(outside, "secret");
          await symlink(outside, source);
        });
        const records: {
          level: string;
          message: unknown;
          annotations: Record<string, unknown>;
        }[] = [];
        const capture = Logger.make(({ logLevel, message, fiber }) => {
          records.push({
            level: logLevel,
            message,
            annotations: fiber.getRef(References.CurrentLogAnnotations),
          });
        });

        yield* importSource(yield* makeService(), source).pipe(
          Effect.provide(Logger.layer([capture])),
        );

        const refusal = records.find((record) =>
          JSON.stringify(record.message).includes("Refused attachment source"),
        );
        expect(refusal).toMatchObject({
          level: "Warn",
          annotations: { origin: "storage", reason: "escaped-root" },
        });
        expect(JSON.stringify(refusal)).not.toContain(source);
        expect(JSON.stringify(refusal)).not.toContain(outside);
      }),
  );

  it.effect(
    "refuses a symbolic link inside an approved folder that points outside it",
    () =>
      Effect.gen(function* () {
        const outside = join(dir, "outside.txt");
        const source = join(approvedDir, "escape.pdf");
        yield* fsStep(async () => {
          await writeFile(outside, "secret");
          await symlink(outside, source);
        });
        const service = yield* makeService();
        yield* service.approveFolder(approvedDir);

        const result = yield* importSource(service, source, {
          origin: "linked-absolute",
          vaultName: "escape.pdf",
        });

        expect(result).toMatchObject({ copied: 0, refused: 1 });
        expect(yield* fsStep(() => readdir(attachmentsDir))).toEqual([]);
      }),
  );

  it.effect(
    "refuses a source that is a directory rather than a regular file",
    () =>
      Effect.gen(function* () {
        const source = join(storageDir, "IMG12345");
        yield* fsStep(() => mkdir(source));

        const result = yield* importSource(yield* makeService(), source);

        expect(result).toMatchObject({ copied: 0, refused: 1 });
        expect(yield* fsStep(() => readdir(attachmentsDir))).toEqual([]);
      }),
  );

  it.effect("counts a source that is gone as missing rather than refused", () =>
    Effect.gen(function* () {
      const result = yield* importSource(
        yield* makeService(),
        join(storageDir, "never-written.png"),
      );

      expect(result).toMatchObject({ copied: 0, missing: 1, refused: 0 });
    }),
  );

  it.effect(
    "counts a source under a file where a folder belongs as missing",
    () =>
      Effect.gen(function* () {
        yield* fsStep(() => writeFile(join(storageDir, "IMG12345"), "file"));

        const result = yield* importSource(
          yield* makeService(),
          join(storageDir, "IMG12345", "image.png"),
        );

        expect(result).toMatchObject({ copied: 0, missing: 1, refused: 0 });
      }),
  );

  it.effect("refuses a source whose links form a cycle", () =>
    Effect.gen(function* () {
      const source = join(storageDir, "loop.png");
      yield* fsStep(() => symlink(source, source));

      const result = yield* importSource(yield* makeService(), source);

      expect(result).toMatchObject({ copied: 0, missing: 0, refused: 1 });
    }),
  );

  it.effect("copies a source the confirmation accepts", () =>
    Effect.gen(function* () {
      const source = join(storageDir, "image.png");
      yield* fsStep(() => writeFile(source, "image"));

      const result = yield* importSource(yield* makeService(), source);

      expect(result).toMatchObject({ copied: 1, refused: 0 });
      expect(
        yield* fsStep(() =>
          readFile(join(attachmentsDir, "IMG-image.png"), "utf8"),
        ),
      ).toBe("image");
    }),
  );
});

describe("AttachmentImport copy strategy by origin", () => {
  it.effect(
    "writes the bytes confirmed for a linked file, not those of a source swapped afterwards",
    () =>
      Effect.gen(function* () {
        const source = join(baseDir, "paper.pdf");
        yield* fsStep(() => writeFile(source, "confirmed"));
        hooks.beforeCopy = async () => {
          await rm(source);
          await writeFile(source, "substituted");
        };

        const result = yield* importSource(yield* makeService(), source, {
          origin: "linked-base",
          vaultName: "paper.pdf",
        });

        expect(result).toMatchObject({ copied: 1, missing: 0, refused: 0 });
        expect(
          yield* fsStep(() =>
            readFile(join(attachmentsDir, "paper.pdf"), "utf8"),
          ),
        ).toBe("confirmed");
      }),
  );

  it.effect(
    "reads a linked file through its descriptor rather than cloning its path",
    () =>
      Effect.gen(function* () {
        const source = join(baseDir, "paper.pdf");
        yield* fsStep(() => writeFile(source, "linked"));

        const result = yield* importSource(yield* makeService(), source, {
          origin: "linked-base",
          vaultName: "paper.pdf",
        });

        expect(result).toMatchObject({ copied: 1 });
        expect(reflink).not.toHaveBeenCalled();
        expect(
          yield* fsStep(() =>
            readFile(join(attachmentsDir, "paper.pdf"), "utf8"),
          ),
        ).toBe("linked");
      }),
  );

  it.effect(
    "still reflinks a Zotero-managed source, from its confirmed canonical path",
    () =>
      Effect.gen(function* () {
        const source = join(storageDir, "image.png");
        yield* fsStep(() => writeFile(source, "image"));

        expect(yield* importSource(yield* makeService(), source)).toMatchObject(
          { copied: 1 },
        );

        expect(reflink).toHaveBeenCalledExactlyOnceWith(
          source,
          expect.stringContaining(".zotlit-tmp"),
        );
      }),
  );

  it.effect(
    "counts a Zotero-managed source removed after confirmation as missing, without aborting the batch",
    () =>
      Effect.gen(function* () {
        const removed = join(storageDir, "removed.png");
        const kept = join(storageDir, "kept.png");
        yield* fsStep(async () => {
          await writeFile(removed, "image");
          await writeFile(kept, "image");
        });
        hooks.beforeCopy = () => rm(removed);

        const service = yield* makeService();
        const batch = yield* service.prepare("Notes/A.md");
        for (const [path, vaultName] of [
          [removed, "removed.png"],
          [kept, "kept.png"],
        ] as const) {
          batch.resolveLink({
            source: batch.decide(path, "storage"),
            vaultName,
          })();
        }

        expect(yield* batch.flush).toMatchObject({
          copied: 1,
          missing: 1,
          refused: 0,
        });
        expect(yield* fsStep(() => readdir(attachmentsDir))).toEqual([
          "kept.png",
        ]);
      }),
  );
});

describe("AttachmentImport destination protection", () => {
  it.effect(
    "rejects an existing symbolic link at the destination without writing through it",
    () =>
      Effect.gen(function* () {
        const source = join(storageDir, "image.png");
        const outsideTarget = join(dir, "outside.txt");
        const dest = join(attachmentsDir, "IMG-image.png");
        yield* fsStep(async () => {
          await writeFile(source, "image");
          await writeFile(outsideTarget, "untouched");
          await symlink(outsideTarget, dest);
        });

        const error = yield* Effect.flip(
          importSource(yield* makeService(), source),
        );

        expect(error._tag).toBe("AttachmentCopyError");
        // The symlink's target is never opened for writing...
        expect(yield* fsStep(() => readFile(outsideTarget, "utf8"))).toBe(
          "untouched",
        );
        // ...and the symlink itself is left in place, not followed.
        expect((yield* fsStep(() => lstat(dest))).isSymbolicLink()).toBe(true);
      }),
  );

  it.effect("leaves no temporary file behind after an interrupted copy", () =>
    Effect.gen(function* () {
      const source = join(storageDir, "image.png");
      yield* fsStep(async () => {
        await writeFile(source, "image");
        // A directory at the destination makes the final rename fail, after
        // the temp file has already been written.
        await mkdir(join(attachmentsDir, "IMG-image.png"));
      });

      const error = yield* Effect.flip(
        importSource(yield* makeService(), source),
      );

      expect(error._tag).toBe("AttachmentCopyError");
      const entries = yield* fsStep(() => readdir(attachmentsDir));
      expect(entries.filter((name) => name.endsWith(".zotlit-tmp"))).toEqual(
        [],
      );
    }),
  );
});
