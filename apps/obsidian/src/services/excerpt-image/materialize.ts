// Writes immutable excerpt assets and verifies their bytes before exposing a link.
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { FileSystemAdapter } from "obsidian";
import type { App } from "obsidian";

import {
  joinFolderPath,
  resolveAttachmentFolderPath,
} from "@/lib/ensure-folder";
import { isErrno } from "@/lib/errno";
import { getLogger } from "@/lib/log";
import type { Settings } from "@/services/settings/schema";

import { excerptKey, excerptSourceIdentity } from "./service";
import type { ExcerptOutcome, ExcerptRequest } from "./service";

const logger = getLogger("excerpt-materialize");
export type MaterializedExcerpt =
  | {
      kind: "saved";
      path: string;
      outcome: Extract<ExcerptOutcome, { kind: "available" }>;
    }
  | { kind: "unavailable"; reason: "disabled" | "source" | "write" };

/** Stable ownership remains readable from a target when the annotation's pixels change. */
export function excerptAssetIdentity(request: ExcerptRequest): string {
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
