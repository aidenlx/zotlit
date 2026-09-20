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

import { usableExcerptPng } from "./png";
import { excerptKey, excerptSourceIdentity } from "./service";
import type { ExcerptOutcome, ExcerptRequest } from "./service";

const logger = getLogger("excerpt-materialize");
const MAX_PREVIOUS_BYTES = 32 * 1024 * 1024;

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
  const prefix = `zotlit-excerpt-${excerptAssetIdentity(options.request)}-`;
  for (const path of options.paths) {
    const local = relative(adapter.getFullPath(""), adapter.getFullPath(path));
    if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`))
      continue;
    const name = basename(path);
    const owned =
      name.startsWith(prefix) &&
      name.endsWith(".png") &&
      name.length === prefix.length + 68;
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
      if (!usableExcerptPng(bytes)) continue;
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

export async function materializeExcerpt(options: {
  app: App;
  notePath: string;
  settings: Readonly<Settings>;
  request: ExcerptRequest;
  outcome: ExcerptOutcome;
}): Promise<MaterializedExcerpt> {
  const { app, request, outcome, settings } = options;
  if (!settings["attachment.import"])
    return { kind: "unavailable", reason: "disabled" };
  if (outcome.kind === "unavailable")
    return { kind: "unavailable", reason: "source" };
  try {
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
    const path = joinFolderPath(
      folder,
      `zotlit-excerpt-${excerptAssetIdentity(request)}-${digest}.png`,
    );
    const destination = adapter.getFullPath(path);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    // Publish only complete bytes, using an exclusive hard link to preserve every existing version.
    try {
      await using file = await open(temporary, "wx");
      await file.writeFile(outcome.bytes);
      await file.sync();
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
    } finally {
      await unlink(temporary).catch((error) => {
        if (!isErrno(error, "ENOENT"))
          logger.warn("Excerpt temporary cleanup failed", { error });
      });
    }
    return { kind: "saved", path, outcome };
  } catch (error) {
    logger.debug("Excerpt materialization failed", { error });
    return { kind: "unavailable", reason: "write" };
  }
}
