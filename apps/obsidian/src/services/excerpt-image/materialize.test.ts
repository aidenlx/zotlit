import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, FileSystem, Layer } from "effect";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  truncate,
} from "node:fs/promises";
import { join } from "node:path";
import { FileSystemAdapter } from "obsidian";
import { expect, vi } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { MemoryVault } from "@/lib/__fixtures__/obsidian-vault";
import { stubService } from "@/lib/__fixtures__/service-stub";
import { layerFileManagerFrom } from "@/lib/obsidian-file-manager";
import type {
  FileManager,
  FileManagerSource,
} from "@/lib/obsidian-file-manager";
import { layerVaultFrom } from "@/lib/obsidian-vault";
import type { Vault } from "@/lib/obsidian-vault";
import { defaults } from "@/services/settings/schema";

import { availableOutcome } from "./__fixtures__/outcome";
import { redPng as png, bluePng, corruptPng } from "./__fixtures__/png";
import { chromiumLosslessWebp, sizedWebp } from "./__fixtures__/webp";
import { PNG_FORMAT, WEBP_FORMAT } from "./format";
import type { ExcerptImage } from "./format";
import {
  excerptAssetIdentities,
  isOwnedExcerptAssetPath,
  makePublicationGate,
  materializeExcerpt,
  retainExcerpt,
} from "./materialize";
import type { MaterializedExcerpt } from "./materialize";
import type { ExcerptOutcome, ExcerptRequest } from "./service";
import { usableExcerptWebp } from "./webp";

const pngImage: ExcerptImage = { bytes: png, format: PNG_FORMAT };
const otherImage: ExcerptImage = { bytes: bluePng, format: PNG_FORMAT };

const request: ExcerptRequest = {
  annotation: {
    key: "ANNOT001",
    parentKey: "ATTACH01",
    type: "image",
    color: null,
    text: null,
    comment: null,
    pageLabel: "1",
    sortIndex: "00000|000000|00000",
    tags: [],
    version: 1,
    lock: null,
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

/**
 * The decoder the host supplies in production. A Node test process has none of
 * its own, so a test that crosses a WebP boundary states which host it drives:
 * one whose decoder reconstructs the pixels, one that cannot, or one with no
 * decoder. The real decoder is `webp-pixels.test.ts`'s Electron trial. The
 * stub ends with the case's Scope.
 */
const stubWebpDecoder = (host: "decodes" | "fails" | "none") =>
  Effect.acquireRelease(
    Effect.sync(() => {
      vi.stubGlobal(
        "createImageBitmap",
        host === "none"
          ? undefined
          : async () => {
              if (host === "fails") throw new Error("WebP decode failed");
              return { close: () => undefined };
            },
      );
    }),
    () => Effect.sync(() => vi.unstubAllGlobals()),
  );

const read = <A>(evaluate: () => Promise<A>) =>
  Effect.promise(() => evaluate());

type Services = FileManager | FileSystem.FileSystem | Vault;

/** The Node file system with the members `decorate` gives in place of its own. */
const decoratedFileSystem = (
  decorate: (fs: FileSystem.FileSystem) => Partial<FileSystem.FileSystem>,
) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (fs) =>
      FileSystem.FileSystem.of({ ...fs, ...decorate(fs) }),
    ),
  ).pipe(Layer.provide(NodeFileSystem.layer));

/**
 * A vault on disk under a temp folder, removed with the case's Scope, over
 * `fileSystem`.
 */
const fixtureOver = (
  fileSystem: Layer.Layer<FileSystem.FileSystem> = NodeFileSystem.layer,
) =>
  Effect.gen(function* () {
    const parent = join(
      yield* read(() => getWorkspaceRoot(import.meta.dirname)),
      ".scratch/excerpt-tests",
    );
    yield* read(() => mkdir(parent, { recursive: true }));
    const root = yield* read(() => mkdtemp(`${parent}/vault-`));
    yield* Effect.addFinalizer(() =>
      read(() => rm(root, { recursive: true, force: true })),
    );
    const source = new MemoryVault();
    const reconcileInternalFile = vi.fn(async (path: string) => {
      await readFile(`${root}/${path}`);
      source.add(path);
    });
    Object.assign(source, {
      adapter: Object.assign(new FileSystemAdapter(), {
        getFullPath: (path: string) => `${root}/${path}`,
        reconcileInternalFile,
      }),
    });
    const createFolder = vi.spyOn(source, "createFolder");
    const vault = layerVaultFrom(source);
    const context = yield* Layer.build(
      Layer.mergeAll(
        vault,
        layerFileManagerFrom(
          stubService<FileManagerSource>("FileManagerSource", {}),
        ).pipe(Layer.provide(vault)),
        fileSystem,
      ),
    );
    const gate = yield* makePublicationGate;
    const provide = <A, E>(effect: Effect.Effect<A, E, Services>) =>
      Effect.provideContext(effect, context);
    const settings = {
      ...defaults,
      "attachment.import": true,
      "attachment.folder-path": "Images",
    };
    const publish = (
      outcome: ExcerptOutcome,
      options: {
        input?: ExcerptRequest;
        publishSettings?: typeof settings;
      } = {},
    ) =>
      provide(
        materializeExcerpt({
          gate,
          notePath: "Paper.md",
          settings: options.publishSettings ?? settings,
          request: options.input ?? request,
          outcome,
        }),
      );
    return {
      root,
      source,
      createFolder,
      reconcileInternalFile,
      settings,
      publish,
      save: (input = request, image = pngImage) =>
        publish(
          availableOutcome({
            ...image,
            provenance: "rendered",
            freshness: "checked",
          }),
          { input },
        ),
      retain: (input: ExcerptRequest, paths: readonly string[]) =>
        provide(retainExcerpt({ request: input, paths })),
    };
  });

/** A vault on disk under a temp folder, removed with the case's Scope. */
const fixture = fixtureOver();

const savedPath = (result: MaterializedExcerpt) => {
  if (result.kind !== "saved") throw new Error("Fixture image was not saved");
  return result.path;
};

it.effect(
  "waits for vault registration after complete bytes are published",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      f.reconcileInternalFile.mockImplementationOnce(async (path: string) => {
        expect(await readFile(join(f.root, path))).toEqual(png);
        expect(f.source.getFileByPath(path)).toBeNull();
        started.resolve();
        await release.promise;
        f.source.add(path);
      });
      const operation = yield* f
        .save()
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* read(() => started.promise);
      expect(operation.pollUnsafe()).toBeUndefined();
      release.resolve();
      expect((yield* Fiber.join(operation)).kind).toBe("saved");
    }).pipe(Effect.scoped),
);

it.effect("leaves published bytes when vault registration fails", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    f.reconcileInternalFile.mockImplementation(async () => {});
    expect(yield* f.save()).toEqual({ kind: "unavailable", reason: "write" });
    const [name] = yield* read(() => readdir(join(f.root, "Images")));
    expect(yield* read(() => readFile(join(f.root, "Images", name!)))).toEqual(
      png,
    );
  }).pipe(Effect.scoped),
);

it.effect(
  "releases an interrupted owner before a concurrent consumer adopts the same asset",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      f.reconcileInternalFile.mockImplementationOnce(async () => {
        started.resolve();
        await release.promise;
      });
      const cancelled = yield* f
        .save()
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* read(() => started.promise);
      const consumer = yield* f
        .save()
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Fiber.interrupt(cancelled);
      release.resolve();
      expect(Exit.hasInterrupts(yield* Fiber.await(cancelled))).toBe(true);
      const path = savedPath(yield* Fiber.join(consumer));
      expect(yield* read(() => readFile(join(f.root, path)))).toEqual(png);
      expect(yield* read(() => readdir(join(f.root, "Images")))).toHaveLength(
        1,
      );
      expect(f.source.getFileByPath(path)).not.toBeNull();
    }).pipe(Effect.scoped),
);

it.effect(
  "takes back the bytes of a save interrupted while it links them",
  () =>
    Effect.gen(function* () {
      const linked = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const f = yield* fixtureOver(
        decoratedFileSystem((fs) => ({
          // The link is on disk; the save is interrupted before it goes on.
          link: (from, to) =>
            fs.link(from, to).pipe(
              Effect.andThen(
                Effect.promise(() => {
                  linked.resolve();
                  return release.promise;
                }),
              ),
            ),
        })),
      );
      const save = yield* f
        .save()
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* read(() => linked.promise);
      const interrupting = yield* Fiber.interrupt(save).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      release.resolve();
      yield* Fiber.join(interrupting);
      expect(Exit.hasInterrupts(yield* Fiber.await(save))).toBe(true);
      expect(yield* read(() => readdir(join(f.root, "Images")))).toEqual([]);
    }).pipe(Effect.scoped),
);

it.effect(
  "takes back the bytes of a save whose cause holds an interrupt and a failure",
  () =>
    Effect.gen(function* () {
      const f = yield* fixtureOver(
        decoratedFileSystem((fs) => ({
          // The check of the published bytes ends in an interrupt and a defect.
          readFile: (path) =>
            path.endsWith(".png")
              ? Effect.failCause(
                  Cause.combine(
                    Cause.interrupt(),
                    Cause.die(new Error("read failed")),
                  ),
                )
              : fs.readFile(path),
        })),
      );
      yield* Effect.exit(f.save());
      expect(yield* read(() => readdir(join(f.root, "Images")))).toEqual([]);
    }).pipe(Effect.scoped),
);

it.effect(
  "publishes complete immutable versions and isolates source and library identity",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const results = yield* Effect.all(
        [
          f.save(),
          f.save(),
          f.save(request, otherImage),
          f.save({ ...request, libraryID: 2 }),
          f.save({ ...request, sourceScope: "/other-zotero" }),
        ],
        { concurrency: "unbounded" },
      );
      const paths = results.map(savedPath);
      expect(paths[0]).toBe(paths[1]);
      expect(new Set(paths).size).toBe(4);
      expect(yield* read(() => readdir(`${f.root}/Images`))).toHaveLength(4);
      expect(yield* read(() => readFile(`${f.root}/${paths[0]}`))).toEqual(png);
      expect(yield* read(() => readFile(`${f.root}/${paths[2]}`))).toEqual(
        bluePng,
      );
    }).pipe(Effect.scoped),
);

it.effect("refuses a corrupt occupied target without overwriting it", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const path = savedPath(yield* f.save());
    yield* read(() => writeFile(`${f.root}/${path}`, "existing-owner"));
    expect(yield* f.save()).toEqual({ kind: "unavailable", reason: "write" });
    expect(yield* read(() => readFile(`${f.root}/${path}`, "utf8"))).toBe(
      "existing-owner",
    );
    expect(yield* read(() => readdir(`${f.root}/Images`))).toHaveLength(1);
  }).pipe(Effect.scoped),
);

it.effect("creates no folder or file with attachment import disabled", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const result = yield* f.publish(
      availableOutcome({
        bytes: new Uint8Array([1]),
        format: PNG_FORMAT,
        provenance: "zotero",
        freshness: "uncertain",
      }),
      { publishSettings: { ...f.settings, "attachment.import": false } },
    );
    expect(result).toEqual({ kind: "unavailable", reason: "disabled" });
    expect(f.createFolder).not.toHaveBeenCalled();
    expect(yield* read(() => readdir(f.root))).toEqual([]);
  }).pipe(Effect.scoped),
);

it.effect("returns a destination failure before any embed can be emitted", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* read(() => writeFile(`${f.root}/Images`, "occupied"));
    expect(yield* f.save()).toEqual({ kind: "unavailable", reason: "write" });
    expect(yield* read(() => readFile(`${f.root}/Images`, "utf8"))).toBe(
      "occupied",
    );
  }).pipe(Effect.scoped),
);

it.effect(
  "publishes a lossless WebP asset under its own extension and retains it",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      // The vault read decodes what it links, so this host's decoder must work.
      yield* stubWebpDecoder("decodes");
      const bytes = Buffer.from(chromiumLosslessWebp);
      const saved = yield* f.save(request, { bytes, format: WEBP_FORMAT });
      if (saved.kind !== "saved")
        throw new Error("Fixture image was not saved");
      expect(saved.path.endsWith(".webp")).toBe(true);
      expect(saved.outcome.format).toBe(WEBP_FORMAT);
      expect(yield* read(() => readFile(`${f.root}/${saved.path}`))).toEqual(
        bytes,
      );
      expect(yield* f.retain(request, [saved.path])).toEqual({
        kind: "retained",
        path: saved.path,
      });
      expect(f.source.getFileByPath(saved.path)).not.toBeNull();
    }).pipe(Effect.scoped),
);

it.effect("keeps legacy PNG assets retainable beside a WebP asset", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    // The vault read decodes what it links, so this host's decoder must work.
    yield* stubWebpDecoder("decodes");
    const legacy = savedPath(yield* f.save(request, pngImage));
    const webp = savedPath(
      yield* f.save(request, {
        bytes: Buffer.from(chromiumLosslessWebp),
        format: WEBP_FORMAT,
      }),
    );
    expect(yield* read(() => readdir(`${f.root}/Images`))).toHaveLength(2);
    for (const path of [legacy, webp])
      expect(yield* f.retain(request, [path])).toEqual({
        kind: "retained",
        path,
      });
  }).pipe(Effect.scoped),
);

it.effect("refuses bytes that disagree with their declared format", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const malformed: ExcerptImage[] = [
      { bytes: png, format: WEBP_FORMAT },
      { bytes: Buffer.from(chromiumLosslessWebp), format: PNG_FORMAT },
      {
        bytes: Buffer.from(chromiumLosslessWebp.subarray(0, 12)),
        format: WEBP_FORMAT,
      },
    ];
    for (const image of malformed)
      expect(yield* f.save(request, image)).toEqual({
        kind: "unavailable",
        reason: "source",
      });
    expect(yield* read(() => readdir(f.root))).toEqual([]);
  }).pipe(Effect.scoped),
);

it.effect(
  "refuses a WebP whose declared geometry is past the bounds, saved or retained",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      // 44 bytes that declare 16 383 × 16 383: 1 GiB of RGBA for whoever decodes them.
      const bytes = sizedWebp(16_383, 16_383);
      expect(yield* f.save(request, { bytes, format: WEBP_FORMAT })).toEqual({
        kind: "unavailable",
        reason: "source",
      });
      yield* read(() => mkdir(`${f.root}/Images`));
      const path = `Images/zotlit-excerpt-${excerptAssetIdentities(request)[0]}-${"a".repeat(64)}.webp`;
      yield* read(() => writeFile(`${f.root}/${path}`, bytes));
      expect(yield* f.retain(request, [path])).toBeUndefined();
      expect(yield* read(() => readdir(f.root))).toEqual(["Images"]);
    }).pipe(Effect.scoped),
);

it.effect(
  "refuses a vault WebP whose pixels the host's decoder cannot reconstruct",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const [identity] = excerptAssetIdentities(request);
      // 44 bytes of complete container with no pixel data: the shared container
      // walk accepts them, which is why the vault read decodes before it links one.
      const headerOnly = sizedWebp(8, 8);
      expect(usableExcerptWebp(headerOnly)).toBe(true);
      yield* read(() => mkdir(`${f.root}/Images`));
      const damaged = `Images/zotlit-excerpt-${identity}-${"a".repeat(64)}.webp`;
      yield* read(() => writeFile(`${f.root}/${damaged}`, headerOnly));
      yield* stubWebpDecoder("fails");
      expect(yield* f.retain(request, [damaged])).toBeUndefined();
      // Pixels the same host does reconstruct are still retained.
      const decodable = `Images/zotlit-excerpt-${identity}-${"b".repeat(64)}.webp`;
      yield* read(() =>
        writeFile(`${f.root}/${decodable}`, chromiumLosslessWebp),
      );
      yield* stubWebpDecoder("decodes");
      expect(yield* f.retain(request, [decodable])).toEqual({
        kind: "retained",
        path: decodable,
      });
      expect(yield* read(() => readFile(`${f.root}/${decodable}`))).toEqual(
        Buffer.from(chromiumLosslessWebp),
      );
    }).pipe(Effect.scoped),
);

it.effect(
  "refuses a store WebP whose pixels the host's decoder cannot reconstruct",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      // A record `storedImage()` accepted: a complete container with no image data,
      // which reaches publication as available cache bytes and only the decoder
      // tells apart from the pixels its name and link claim.
      const headerOnly = sizedWebp(8, 8);
      expect(usableExcerptWebp(headerOnly)).toBe(true);
      const publish = (bytes: Uint8Array, provenance: "cache" | "rendered") =>
        f.publish(
          availableOutcome({
            bytes,
            format: WEBP_FORMAT,
            provenance,
            freshness: "checked",
          }),
        );
      yield* stubWebpDecoder("fails");
      expect(yield* publish(headerOnly, "cache")).toEqual({
        kind: "unavailable",
        reason: "source",
      });
      expect(yield* read(() => readdir(f.root))).toEqual([]);
      // Bytes this process's own encoder produced are already decoded output.
      expect((yield* publish(headerOnly, "rendered")).kind).toBe("saved");
      // Pixels the same host does reconstruct are still published.
      yield* stubWebpDecoder("decodes");
      expect((yield* publish(chromiumLosslessWebp, "cache")).kind).toBe(
        "saved",
      );
      // A host with no decoder cannot draw these pixels either, so the bytes are
      // refused rather than admitted uninspected.
      yield* stubWebpDecoder("none");
      expect(yield* publish(chromiumLosslessWebp, "cache")).toEqual({
        kind: "unavailable",
        reason: "source",
      });
    }).pipe(Effect.scoped),
);

it("owns published assets of either extension and nothing else", () => {
  const identities = excerptAssetIdentities(request);
  const identity = identities[0]!;
  const digest = "a".repeat(64);
  const name = (suffix: string) =>
    `Images/zotlit-excerpt-${identity}-${digest}.${suffix}`;
  expect(isOwnedExcerptAssetPath(name("webp"), identities)).toBe(true);
  expect(isOwnedExcerptAssetPath(name("png"), identities)).toBe(true);
  for (const foreign of [
    name("gif"),
    `Images/zotlit-excerpt-${identity}-${digest}.webp.png`,
    `Images/zotlit-excerpt-${identity}-${"a".repeat(63)}.webp`,
    `Images/zotlit-excerpt-${"b".repeat(64)}-${digest}.webp`,
  ])
    expect(isOwnedExcerptAssetPath(foreign, identities)).toBe(false);
});

it.effect(
  "keeps an asset the previous release named, and names a new one after the current identity",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const [current, previous] = excerptAssetIdentities(request);
      // The name the previous release wrote, derived here from its own identity
      // array rather than from the code under test.
      const released = createHash("sha256")
        .update(
          JSON.stringify([
            "/zotero",
            ["zotero-db", 1, "LOCAL", "SERVER", 1],
            1,
            "ATTACH01",
            "ANNOT001",
          ]),
        )
        .digest("hex");
      expect(previous).toBe(released);
      expect(current).not.toBe(previous);
      yield* read(() => mkdir(`${f.root}/Images`));
      const path = `Images/zotlit-excerpt-${released}-${"a".repeat(64)}.png`;
      yield* read(() => writeFile(`${f.root}/${path}`, png));
      expect(yield* f.retain(request, [path])).toEqual({
        kind: "retained",
        path,
      });
      expect(yield* read(() => readFile(`${f.root}/${path}`))).toEqual(png);
      const saved = savedPath(yield* f.save(request, pngImage));
      expect(saved).toContain(current);
      expect(saved).not.toContain(previous);
    }).pipe(Effect.scoped),
);

it.effect(
  "retains only a referenced version owned by the same source, Library, Attachment and Annotation",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const path = savedPath(yield* f.save(request, pngImage));
      const changed = {
        ...request,
        annotation: { ...request.annotation, color: "#ff0000", version: 2 },
      };
      expect(yield* f.retain(changed, [path])).toEqual({
        kind: "retained",
        path,
      });
      for (const input of [
        { ...request, sourceScope: "/another-zotero" },
        { ...request, libraryID: 2 },
        { ...request, attachmentKey: "OTHERATT" },
        { ...request, annotation: { ...request.annotation, key: "OTHERANN" } },
      ])
        expect(yield* f.retain(input, [path])).toBeUndefined();
      expect(yield* f.retain(request, [])).toBeUndefined();
      expect(yield* read(() => readFile(`${f.root}/${path}`))).toEqual(png);
      yield* read(() => writeFile(`${f.root}/${path}`, "corrupt"));
      expect(yield* f.retain(request, [path])).toBeUndefined();
    }).pipe(Effect.scoped),
);

it.effect(
  "requires the current source bytes to prove ownership of a referenced legacy image",
  () =>
    Effect.gen(function* () {
      const legacyRequest = {
        ...request,
        annotation: { ...request.annotation, key: "ANNT2345" },
      };
      const f = yield* fixture;
      yield* read(() => mkdir(`${f.root}/Images`));
      const path = "Images/ANNT2345.png";
      yield* read(() => writeFile(`${f.root}/${path}`, png));
      const source = `${f.root}/source.png`;
      yield* read(() => writeFile(source, png));
      expect(yield* f.retain(legacyRequest, [path])).toBeUndefined();
      expect(
        yield* f.retain({ ...legacyRequest, zoteroPngPath: source }, [path]),
      ).toEqual({ kind: "retained", path });
      yield* read(() => writeFile(source, "different-library"));
      expect(
        yield* f.retain({ ...legacyRequest, zoteroPngPath: source }, [path]),
      ).toBeUndefined();
      expect(yield* read(() => readFile(`${f.root}/${path}`))).toEqual(png);
    }).pipe(Effect.scoped),
);

it.effect(
  "rejects an oversized referenced image before reading its contents",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const path = savedPath(yield* f.save(request, pngImage));
      yield* read(() => truncate(`${f.root}/${path}`, 32 * 1024 * 1024 + 1));
      expect(yield* f.retain(request, [path])).toBeUndefined();
    }).pipe(Effect.scoped),
);

it.effect.each(["truncated", "idat", "scanline"] as const)(
  "rejects an unusable PNG (%s)",
  (kind) =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const path = savedPath(
        yield* f.save(request, {
          bytes: corruptPng(kind),
          format: PNG_FORMAT,
        }),
      );
      expect(yield* f.retain(request, [path])).toBeUndefined();
    }).pipe(Effect.scoped),
);
