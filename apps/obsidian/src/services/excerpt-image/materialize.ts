// Writes immutable excerpt assets and verifies their bytes before exposing a link.
import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import { basename, dirname, relative, isAbsolute, sep } from "node:path";
import { FileSystemAdapter } from "obsidian";
import type { App } from "obsidian";

import { parseIndexedKey } from "@zotlit/db";

import {
  joinFolderPath,
  resolveAttachmentFolderPath,
} from "@/lib/ensure-folder";
import { isErrno } from "@/lib/errno";
import { getLogger } from "@/lib/log";
import type { Settings } from "@/services/settings/schema";

import { excerptKey, excerptSourceIdentities } from "./contract";
import type { ExcerptRequest } from "./contract";
import {
  EXCERPT_IMAGE_EXTENSIONS,
  detectExcerptImageFormat,
  isExcerptImage,
  isExcerptPayload,
} from "./format";
import { usableExcerptPng } from "./png";
import type { ExcerptOutcome } from "./service";
import { usableExcerptWebpPixels } from "./webp-pixels";

const logger = getLogger("excerpt-materialize");
const MAX_PREVIOUS_BYTES = 32 * 1024 * 1024;
const SHA256_HEX_LENGTH = 64;

/**
 * A retained asset must still decode as the container its bytes claim.
 *
 * `format.ts` owns the payload check both readers share; the vault read is the
 * one place that deepens it, because these bytes came from outside this process:
 * PNG must also inflate to the scanlines its header declares (`png.ts`), and
 * WebP must also decode to the pixels its container declares (`webp-pixels.ts`).
 * That depth stays here rather than in `format.ts`, which the cache read bundles
 * without a decoder for a check that runs before every hit.
 */
async function usableRetainedAsset(bytes: Uint8Array): Promise<boolean> {
  const format = detectExcerptImageFormat(bytes);
  if (!format || !isExcerptPayload(format, bytes)) return false;
  if (format.format === "webp") return usableExcerptWebpPixels(bytes);
  return usableExcerptPng(
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  );
}

async function readPreviousImage(path: string): Promise<Buffer> {
  await using file = await open(path, "r");
  const { size } = await file.stat();
  if (size > MAX_PREVIOUS_BYTES)
    throw new Error("Previous excerpt exceeds byte limit");
  const buffer = Buffer.alloc(size + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await file.read(
      buffer,
      offset,
      buffer.length - offset,
      offset,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > size)
    throw new Error("Previous excerpt grew during verification");
  return buffer.subarray(0, offset);
}
// Hold publication ownership until cancellation cleanup or successful handoff.
const publications = new Map<string, Promise<void>>();
export type MaterializedExcerpt =
  | {
      kind: "saved";
      path: string;
      outcome: Extract<ExcerptOutcome, { kind: "available" }>;
    }
  | { kind: "retained"; path: string }
  | { kind: "unavailable"; reason: "disabled" | "source" | "write" };

/** Only referenced, vault-contained images with proven ownership can survive a failed refresh. */
export async function retainExcerpt(options: {
  app: App;
  request: ExcerptRequest;
  paths: readonly string[];
}): Promise<Extract<MaterializedExcerpt, { kind: "retained" }> | undefined> {
  const adapter = options.app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return;
  const identities = excerptAssetIdentities(options.request);
  for (const path of options.paths) {
    const local = relative(adapter.getFullPath(""), adapter.getFullPath(path));
    if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`))
      continue;
    const name = basename(path);
    const owned = isOwnedExcerptAssetPath(path, identities);
    const legacy =
      name === `${parseIndexedKey(options.request.annotation.key)?.key}.png`;
    if (!owned && !legacy) continue;
    try {
      const actualPath = await realpath(adapter.getFullPath(path));
      const actualRoot = await realpath(adapter.getFullPath(""));
      const actualRelative = relative(actualRoot, actualPath);
      if (
        isAbsolute(actualRelative) ||
        actualRelative === ".." ||
        actualRelative.startsWith(`..${sep}`)
      )
        continue;
      const bytes = await readPreviousImage(actualPath);
      if (!(await usableRetainedAsset(bytes))) continue;
      // Legacy names carry no source identity. The current source's bytes must prove ownership.
      if (
        !owned &&
        (!options.request.zoteroPngPath ||
          !bytes.equals(await readPreviousImage(options.request.zoteroPngPath)))
      )
        continue;
      return { kind: "retained", path };
    } catch (error) {
      logger.debug("Previous excerpt could not be verified", { path, error });
    }
  }
}

/**
 * Every identity form this request's existing assets may carry, the current
 * form first, which is the one that names a new asset. A vault written before
 * the shared source identity holds each asset and link under the previous form,
 * so an ownership check has to accept both.
 */
export function excerptAssetIdentities(
  request: Pick<
    ExcerptRequest,
    "sourceScope" | "source" | "libraryID" | "attachmentKey"
  > & { annotation: { key: string } },
): string[] {
  return excerptSourceIdentities(request.source).map((sourceIdentity) =>
    createHash("sha256")
      .update(
        JSON.stringify([
          request.sourceScope,
          sourceIdentity,
          request.libraryID,
          request.attachmentKey,
          request.annotation.key,
        ]),
      )
      .digest("hex"),
  );
}

export function isOwnedExcerptAssetPath(
  path: string,
  identities: readonly string[],
): boolean {
  const name = basename(path);
  return identities.some((identity) => {
    const prefix = `zotlit-excerpt-${identity}-`;
    if (!name.startsWith(prefix)) return false;
    const digest = name.slice(prefix.length);
    const dot = digest.indexOf(".");
    return (
      dot === SHA256_HEX_LENGTH &&
      EXCERPT_IMAGE_EXTENSIONS.has(digest.slice(dot + 1))
    );
  });
}

export async function materializeExcerpt(options: {
  app: App;
  notePath: string;
  settings: Readonly<Settings>;
  request: ExcerptRequest;
  outcome: ExcerptOutcome;
  signal?: AbortSignal;
  valid?: () => boolean;
}): Promise<MaterializedExcerpt> {
  const { app, request, outcome, settings } = options;
  if (!settings["attachment.import"])
    return { kind: "unavailable", reason: "disabled" };
  if (outcome.kind === "unavailable")
    return { kind: "unavailable", reason: "source" };
  // Bytes that disagree with their format must not become a vault asset whose
  // name and link claim the declared extension.
  if (!isExcerptImage(outcome)) {
    logger.debug("Excerpt payload does not match its format", {
      format: outcome.format.format,
      bytes: outcome.bytes.byteLength,
    });
    return { kind: "unavailable", reason: "source" };
  }
  const assertCurrent = () => {
    options.signal?.throwIfAborted();
    if (options.valid && !options.valid())
      throw new Error("Excerpt insertion target is no longer current");
  };
  try {
    assertCurrent();
    const folder = await resolveAttachmentFolderPath(
      app,
      settings["attachment.folder-path"],
      options.notePath,
    );
    const adapter = app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter))
      throw new Error("Excerpt import requires a filesystem vault");
    const digest = createHash("sha256")
      .update(excerptKey(request))
      .update(outcome.bytes)
      .digest("hex");
    const [identity] = excerptAssetIdentities(request);
    const path = joinFolderPath(
      folder,
      `zotlit-excerpt-${identity}-${digest}.${outcome.format.extension}`,
    );
    const destination = adapter.getFullPath(path);
    const previous = publications.get(destination);
    const gate = Promise.withResolvers<void>();
    publications.set(destination, gate.promise);
    await previous;
    try {
      assertCurrent();
      await mkdir(dirname(destination), { recursive: true });
      const temporary = `${destination}.${randomUUID()}.tmp`;
      // Publish only complete bytes, using an exclusive hard link to preserve every existing version.
      try {
        await using file = await open(temporary, "wx");
        await file.writeFile(outcome.bytes, { signal: options.signal });
        await file.sync();
        assertCurrent();
        try {
          await link(temporary, destination);
        } catch (error) {
          if (!isErrno(error, "EEXIST")) throw error;
        }
        const actual = await readFile(destination);
        if (!actual.equals(outcome.bytes))
          throw new Error(
            "Excerpt destination does not match its content identity",
          );
        assertCurrent();
      } finally {
        await unlink(temporary).catch((error) => {
          if (!isErrno(error, "ENOENT"))
            logger.warn("Excerpt temporary cleanup failed", { error });
        });
      }
      // The atomic filesystem publish precedes the vault's asynchronous watcher.
      // Register it now so the first rendered embed can resolve its TFile. A
      // later failure leaves the content-addressed asset for another caller.
      assertCurrent();
      await adapter.reconcileInternalFile(path);
      assertCurrent();
      if (!app.vault.getFileByPath(path))
        throw new Error("Published excerpt is not registered in the vault");
      return { kind: "saved", path, outcome };
    } finally {
      gate.resolve();
      if (publications.get(destination) === gate.promise)
        publications.delete(destination);
    }
  } catch (error) {
    logger.debug("Excerpt materialization failed", { error });
    return { kind: "unavailable", reason: "write" };
  }
}
