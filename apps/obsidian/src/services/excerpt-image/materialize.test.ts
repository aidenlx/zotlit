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
import { FileSystemAdapter, TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { defaults } from "@/services/settings/schema";

import { availableOutcome } from "./__fixtures__/outcome";
import { redPng as png, bluePng, corruptPng } from "./__fixtures__/png";
import { chromiumLosslessWebp, sizedWebp } from "./__fixtures__/webp";
import { PNG_FORMAT, WEBP_FORMAT } from "./format";
import type { ExcerptImage } from "./format";
import {
  excerptAssetIdentities,
  isOwnedExcerptAssetPath,
  materializeExcerpt,
  retainExcerpt,
} from "./materialize";
import type { ExcerptRequest } from "./service";
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
 * one whose decoder reconstructs the pixels, or one that cannot. The real
 * decoder is `webp-pixels.test.ts`'s Electron trial.
 */
function stubWebpDecoder(host: "decodes" | "fails") {
  vi.stubGlobal("createImageBitmap", async () => {
    if (host === "fails") throw new Error("WebP decode failed");
    return { close: () => undefined };
  });
}

async function fixture() {
  const parent = join(
    await getWorkspaceRoot(import.meta.dirname),
    ".scratch/excerpt-tests",
  );
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(`${parent}/vault-`);
  const folders = new Map<string, TFolder>();
  const files = new Map<string, TFile>();
  const createFolder = vi.fn(async (path: string) => {
    await mkdir(`${root}/${path}`, { recursive: true });
    const folder = Object.assign(new TFolder(), { path });
    folders.set(path, folder);
    return folder;
  });
  const adapter = Object.assign(Object.create(FileSystemAdapter.prototype), {
    getFullPath: (path: string) => `${root}/${path}`,
    reconcileInternalFile: vi.fn(async (path: string) => {
      await readFile(`${root}/${path}`);
      files.set(path, Object.assign(new TFile(), { path }));
    }),
  });
  const app = {
    vault: {
      adapter,
      createFolder,
      getFileByPath: (path: string) => files.get(path) ?? null,
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
    adapter,
    files,
    settings,
    save: (input = request, image = pngImage, signal?: AbortSignal) =>
      materializeExcerpt({
        signal,
        app,
        notePath: "Paper.md",
        settings,
        request: input,
        outcome: availableOutcome({
          ...image,
          provenance: "rendered",
          freshness: "checked",
        }),
      }),
    async [Symbol.asyncDispose]() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

it("waits for vault registration after complete bytes are published", async () => {
  await using f = await fixture();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let completed = false;
  f.adapter.reconcileInternalFile.mockImplementation(async (path: string) => {
    expect(await readFile(join(f.root, path))).toEqual(png);
    expect(f.app.vault.getFileByPath(path)).toBeNull();
    started.resolve();
    await release.promise;
    f.files.set(path, Object.assign(new TFile(), { path }));
  });
  const operation = f.save().then((result) => {
    completed = true;
    return result;
  });
  await started.promise;
  expect(completed).toBe(false);
  release.resolve();
  expect((await operation).kind).toBe("saved");
});

it("leaves published bytes when vault registration fails", async () => {
  await using f = await fixture();
  f.adapter.reconcileInternalFile.mockImplementation(async () => {});
  expect(await f.save()).toEqual({ kind: "unavailable", reason: "write" });
  const [name] = await readdir(join(f.root, "Images"));
  expect(await readFile(join(f.root, "Images", name!))).toEqual(png);
});

it("releases a cancelled owner before a concurrent consumer adopts the same asset", async () => {
  await using f = await fixture();
  const controller = new AbortController();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  f.adapter.reconcileInternalFile.mockImplementationOnce(async () => {
    started.resolve();
    await release.promise;
  });
  const cancelled = f.save(undefined, undefined, controller.signal);
  await started.promise;
  const consumer = f.save();
  controller.abort();
  release.resolve();
  expect((await cancelled).kind).toBe("unavailable");
  const saved = await consumer;
  expect(saved.kind).toBe("saved");
  if (saved.kind !== "saved") return;
  expect(await readFile(join(f.root, saved.path))).toEqual(png);
  expect(await readdir(join(f.root, "Images"))).toHaveLength(1);
  expect(f.app.vault.getFileByPath(saved.path)).not.toBeNull();
});

it("publishes complete immutable versions and isolates source and library identity", async () => {
  await using f = await fixture();
  const results = await Promise.all([
    f.save(),
    f.save(),
    f.save(request, otherImage),
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
  expect(await readFile(`${f.root}/${paths[0]}`)).toEqual(png);
  expect(await readFile(`${f.root}/${paths[2]}`)).toEqual(bluePng);
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
    outcome: availableOutcome({
      bytes: new Uint8Array([1]),
      format: PNG_FORMAT,
      provenance: "zotero",
      freshness: "uncertain",
    }),
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

it("publishes a lossless WebP asset under its own extension and retains it", async () => {
  await using f = await fixture();
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => {
    vi.unstubAllGlobals();
  });
  // The vault read decodes what it links, so this host's decoder must work.
  stubWebpDecoder("decodes");
  const bytes = Buffer.from(chromiumLosslessWebp);
  const saved = await f.save(request, { bytes, format: WEBP_FORMAT });
  if (saved.kind !== "saved") throw new Error("Fixture image was not saved");
  expect(saved.path.endsWith(".webp")).toBe(true);
  expect(saved.outcome.format).toBe(WEBP_FORMAT);
  expect(await readFile(`${f.root}/${saved.path}`)).toEqual(bytes);
  expect(
    await retainExcerpt({ app: f.app, request, paths: [saved.path] }),
  ).toEqual({ kind: "retained", path: saved.path });
  expect(f.app.vault.getFileByPath(saved.path)).not.toBeNull();
});

it("keeps legacy PNG assets retainable beside a WebP asset", async () => {
  await using f = await fixture();
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => {
    vi.unstubAllGlobals();
  });
  // The vault read decodes what it links, so this host's decoder must work.
  stubWebpDecoder("decodes");
  const legacy = await f.save(request, pngImage);
  const webp = await f.save(request, {
    bytes: Buffer.from(chromiumLosslessWebp),
    format: WEBP_FORMAT,
  });
  if (legacy.kind !== "saved" || webp.kind !== "saved")
    throw new Error("Fixture images were not saved");
  expect(await readdir(`${f.root}/Images`)).toHaveLength(2);
  for (const path of [legacy.path, webp.path])
    expect(await retainExcerpt({ app: f.app, request, paths: [path] })).toEqual(
      { kind: "retained", path },
    );
});

it("refuses bytes that disagree with their declared format", async () => {
  await using f = await fixture();
  const malformed: ExcerptImage[] = [
    { bytes: png, format: WEBP_FORMAT },
    { bytes: Buffer.from(chromiumLosslessWebp), format: PNG_FORMAT },
    {
      bytes: Buffer.from(chromiumLosslessWebp.subarray(0, 12)),
      format: WEBP_FORMAT,
    },
  ];
  for (const image of malformed)
    expect(await f.save(request, image)).toEqual({
      kind: "unavailable",
      reason: "source",
    });
  expect(await readdir(f.root)).toEqual([]);
});

it("refuses a WebP whose declared geometry is past the bounds, saved or retained", async () => {
  await using f = await fixture();
  // 44 bytes that declare 16 383 × 16 383: 1 GiB of RGBA for whoever decodes them.
  const bytes = sizedWebp(16_383, 16_383);
  expect(await f.save(request, { bytes, format: WEBP_FORMAT })).toEqual({
    kind: "unavailable",
    reason: "source",
  });
  await mkdir(`${f.root}/Images`);
  const path = `Images/zotlit-excerpt-${excerptAssetIdentities(request)[0]}-${"a".repeat(64)}.webp`;
  await writeFile(`${f.root}/${path}`, bytes);
  expect(
    await retainExcerpt({ app: f.app, request, paths: [path] }),
  ).toBeUndefined();
  expect(await readdir(f.root)).toEqual(["Images"]);
});

it("refuses a vault WebP whose pixels the host's decoder cannot reconstruct", async () => {
  await using f = await fixture();
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => {
    vi.unstubAllGlobals();
  });
  const [identity] = excerptAssetIdentities(request);
  // 44 bytes of complete container with no pixel data: the shared container
  // walk accepts them, which is why the vault read decodes before it links one.
  const headerOnly = sizedWebp(8, 8);
  expect(usableExcerptWebp(headerOnly)).toBe(true);
  await mkdir(`${f.root}/Images`);
  const damaged = `Images/zotlit-excerpt-${identity}-${"a".repeat(64)}.webp`;
  await writeFile(`${f.root}/${damaged}`, headerOnly);
  stubWebpDecoder("fails");
  expect(
    await retainExcerpt({ app: f.app, request, paths: [damaged] }),
  ).toBeUndefined();
  // Pixels the same host does reconstruct are still retained.
  const decodable = `Images/zotlit-excerpt-${identity}-${"b".repeat(64)}.webp`;
  await writeFile(`${f.root}/${decodable}`, chromiumLosslessWebp);
  stubWebpDecoder("decodes");
  expect(
    await retainExcerpt({ app: f.app, request, paths: [decodable] }),
  ).toEqual({ kind: "retained", path: decodable });
  expect(await readFile(`${f.root}/${decodable}`)).toEqual(
    Buffer.from(chromiumLosslessWebp),
  );
});

it("refuses a store WebP whose pixels the host's decoder cannot reconstruct", async () => {
  await using f = await fixture();
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => {
    vi.unstubAllGlobals();
  });
  // A record `storedImage()` accepted: a complete container with no image data,
  // which reaches publication as available cache bytes and only the decoder
  // tells apart from the pixels its name and link claim.
  const headerOnly = sizedWebp(8, 8);
  expect(usableExcerptWebp(headerOnly)).toBe(true);
  const publish = (bytes: Uint8Array, provenance: "cache" | "rendered") =>
    materializeExcerpt({
      app: f.app,
      notePath: "Paper.md",
      settings: f.settings,
      request,
      outcome: availableOutcome({
        bytes,
        format: WEBP_FORMAT,
        provenance,
        freshness: "checked",
      }),
    });
  stubWebpDecoder("fails");
  expect(await publish(headerOnly, "cache")).toEqual({
    kind: "unavailable",
    reason: "source",
  });
  expect(await readdir(f.root)).toEqual([]);
  // Bytes this process's own encoder produced are already decoded output.
  expect((await publish(headerOnly, "rendered")).kind).toBe("saved");
  // Pixels the same host does reconstruct are still published.
  stubWebpDecoder("decodes");
  expect((await publish(chromiumLosslessWebp, "cache")).kind).toBe("saved");
  // A host with no decoder cannot draw these pixels either, so the bytes are
  // refused rather than admitted uninspected.
  vi.stubGlobal("createImageBitmap", undefined);
  expect(await publish(chromiumLosslessWebp, "cache")).toEqual({
    kind: "unavailable",
    reason: "source",
  });
});

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

it("keeps an asset the previous release named, and names a new one after the current identity", async () => {
  await using f = await fixture();
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
  await mkdir(`${f.root}/Images`);
  const path = `Images/zotlit-excerpt-${released}-${"a".repeat(64)}.png`;
  await writeFile(`${f.root}/${path}`, png);
  expect(await retainExcerpt({ app: f.app, request, paths: [path] })).toEqual({
    kind: "retained",
    path,
  });
  expect(await readFile(`${f.root}/${path}`)).toEqual(png);
  const saved = await f.save(request, pngImage);
  if (saved.kind !== "saved") throw new Error("Fixture image was not saved");
  expect(saved.path).toContain(current);
  expect(saved.path).not.toContain(previous);
});

it("retains only a referenced version owned by the same source, Library, Attachment and Annotation", async () => {
  await using f = await fixture();
  const saved = await f.save(request, pngImage);
  if (saved.kind !== "saved") throw new Error("Fixture image was not saved");
  const changed = {
    ...request,
    annotation: { ...request.annotation, color: "#ff0000", version: 2 },
  };
  expect(
    await retainExcerpt({ app: f.app, request: changed, paths: [saved.path] }),
  ).toEqual({ kind: "retained", path: saved.path });
  for (const input of [
    { ...request, sourceScope: "/another-zotero" },
    { ...request, libraryID: 2 },
    { ...request, attachmentKey: "OTHERATT" },
    { ...request, annotation: { ...request.annotation, key: "OTHERANN" } },
  ])
    expect(
      await retainExcerpt({ app: f.app, request: input, paths: [saved.path] }),
    ).toBeUndefined();
  expect(
    await retainExcerpt({ app: f.app, request, paths: [] }),
  ).toBeUndefined();
  expect(await readFile(`${f.root}/${saved.path}`)).toEqual(png);
  await writeFile(`${f.root}/${saved.path}`, "corrupt");
  expect(
    await retainExcerpt({ app: f.app, request, paths: [saved.path] }),
  ).toBeUndefined();
});

it("requires the current source bytes to prove ownership of a referenced legacy image", async () => {
  const legacyRequest = {
    ...request,
    annotation: { ...request.annotation, key: "ANNT2345" },
  };
  await using f = await fixture();
  await mkdir(`${f.root}/Images`);
  const path = "Images/ANNT2345.png";
  await writeFile(`${f.root}/${path}`, png);
  const source = `${f.root}/source.png`;
  await writeFile(source, png);
  expect(
    await retainExcerpt({ app: f.app, request: legacyRequest, paths: [path] }),
  ).toBeUndefined();
  expect(
    await retainExcerpt({
      app: f.app,
      request: { ...legacyRequest, zoteroPngPath: source },
      paths: [path],
    }),
  ).toEqual({ kind: "retained", path });
  await writeFile(source, "different-library");
  expect(
    await retainExcerpt({
      app: f.app,
      request: { ...legacyRequest, zoteroPngPath: source },
      paths: [path],
    }),
  ).toBeUndefined();
  expect(await readFile(`${f.root}/${path}`)).toEqual(png);
});

it("rejects an oversized referenced image before reading its contents", async () => {
  await using f = await fixture();
  const saved = await f.save(request, pngImage);
  if (saved.kind !== "saved") throw new Error("Fixture image was not saved");
  await truncate(`${f.root}/${saved.path}`, 32 * 1024 * 1024 + 1);
  expect(
    await retainExcerpt({ app: f.app, request, paths: [saved.path] }),
  ).toBeUndefined();
});

it.each(["truncated", "idat", "scanline"] as const)(
  "rejects an unusable PNG (%s)",
  async (kind) => {
    await using f = await fixture();
    const saved = await f.save(request, {
      bytes: corruptPng(kind),
      format: PNG_FORMAT,
    });
    if (saved.kind !== "saved") throw new Error("Fixture image was not saved");
    expect(
      await retainExcerpt({ app: f.app, request, paths: [saved.path] }),
    ).toBeUndefined();
  },
);
