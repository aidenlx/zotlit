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
import type { AnnotationSource } from "@/services/annotation-repository/service";
import type { Settings } from "@/services/settings/schema";

import { excerptKey, excerptSourceIdentity } from "./contract";
import type { ExcerptRequest } from "./contract";
import { normalizeExcerptPayload } from "./format";
import type { ExcerptImagePayload } from "./format";
import { usableExcerptPng } from "./png";
import type { ExcerptOutcome } from "./service";
import { usableExcerptWebp } from "./webp";
import { verifyWebpDecodes } from "./webp-decode";
import type { WebpDecoder } from "./webp-decode";

const logger = getLogger("excerpt-materialize");
const MAX_PREVIOUS_BYTES = 32 * 1024 * 1024;
const SHA256_HEX_LENGTH = 64;

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
  decodeWebp?: WebpDecoder;
}): Promise<Extract<MaterializedExcerpt, { kind: "retained" }> | undefined> {
  const adapter = options.app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return;
  const identities = excerptAssetIdentities(options.request);
  for (const path of options.paths) {
    const local = relative(adapter.getFullPath(""), adapter.getFullPath(path));
    if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`))
      continue;
    const name = basename(path);
    const owned = identities.some((identity) =>
      isOwnedExcerptAssetPath(path, identity),
    );
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
      const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
      if (
        extension === "png"
          ? !usableExcerptPng(bytes)
          : extension !== "webp" || !usableExcerptWebp(bytes)
      )
        continue;
      if (extension === "webp")
        await verifyWebpDecodes(bytes, options.decodeWebp);
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

/** Stable ownership remains readable from a target when the annotation's pixels change. */
export function excerptAssetIdentity(
  request: Pick<
    ExcerptRequest,
    "sourceScope" | "source" | "libraryID" | "attachmentKey"
  > & { annotation: { key: string } },
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        request.sourceScope,
        excerptSourceIdentity(request.source),
        request.libraryID,
        request.attachmentKey,
        request.annotation.key,
      ]),
    )
    .digest("hex");
}

/** Keep source-specific assets owned when a verified API/DB handoff changes. */
function excerptAssetIdentities(request: ExcerptRequest): string[] {
  const current = excerptAssetIdentity(request);
  const verified = request.verifiedDatabaseIdentity;
  if (!verified) return [current];
  let previousSource: AnnotationSource;
  if (request.source.kind === "zotero-db") {
    if (verified.serverID === null) return [current];
    previousSource = {
      kind: "zotero-local-api",
      serverID: verified.serverID,
    };
  } else {
    previousSource = {
      kind: "zotero-db",
      database: verified,
      libraryID: request.libraryID,
      libraryRevision: null,
    };
  }
  const previous = excerptAssetIdentity({
    sourceScope: request.sourceScope,
    source: previousSource,
    libraryID: request.libraryID,
    attachmentKey: request.attachmentKey,
    annotation: request.annotation,
  });
  return previous === current ? [current] : [current, previous];
}

export function isOwnedExcerptAssetPath(
  path: string,
  identity: string,
): boolean {
  const name = basename(path);
  const prefix = `zotlit-excerpt-${identity}-`;
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return (
    (extension === "png" || extension === "webp") &&
    name.startsWith(prefix) &&
    name.length === prefix.length + SHA256_HEX_LENGTH + extension.length + 1
  );
}

export async function materializeExcerpt(options: {
  app: App;
  notePath: string;
  settings: Readonly<Settings>;
  request: ExcerptRequest;
  outcome: ExcerptOutcome;
  signal?: AbortSignal;
  valid?: () => boolean;
  decodeWebp?: WebpDecoder;
}): Promise<MaterializedExcerpt> {
  const { app, request, outcome, settings } = options;
  if (!settings["attachment.import"])
    return { kind: "unavailable", reason: "disabled" };
  if (outcome.kind === "unavailable")
    return { kind: "unavailable", reason: "source" };
  const explicitFormat = outcome.format !== undefined;
  let payload: ExcerptImagePayload;
  try {
    payload = normalizeExcerptPayload(outcome);
    if (
      explicitFormat &&
      (payload.format === "webp"
        ? !usableExcerptWebp(payload.bytes)
        : !usableExcerptPng(
            Buffer.from(
              payload.bytes.buffer,
              payload.bytes.byteOffset,
              payload.bytes.byteLength,
            ),
          ))
    )
      throw new Error("Excerpt bytes do not match their declared format");
    if (payload.format === "webp")
      await verifyWebpDecodes(payload.bytes, options.decodeWebp);
  } catch (error) {
    logger.debug("Excerpt bytes failed format validation", { error });
    return { kind: "unavailable", reason: "write" };
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
      .update(payload.format)
      .update(payload.bytes)
      .digest("hex");
    const path = joinFolderPath(
      folder,
      `zotlit-excerpt-${excerptAssetIdentity(request)}-${digest}.${payload.extension}`,
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
        await file.writeFile(payload.bytes, { signal: options.signal });
        await file.sync();
        assertCurrent();
        try {
          await link(temporary, destination);
        } catch (error) {
          if (!isErrno(error, "EEXIST")) throw error;
        }
        const actual = await readFile(destination);
        if (!actual.equals(payload.bytes))
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
      return {
        kind: "saved",
        path,
        outcome: { ...outcome, ...payload },
      };
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
