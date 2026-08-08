import { randomUUID } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import type { Stats } from "node:fs";
import { copyFile, lstat, rename, rm, stat, utimes } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

import { isErrno } from "./errno";
import { getLogger } from "./log";
import { reflink } from "./reflink";

const logger = getLogger("attachment-import");

/**
 * Where one queued copy reads its bytes. The attachment import service picks
 * the branch from the source's origin.
 *
 * `path` keeps reflink available, since copy-on-write cloning operates on
 * paths; it is the confirmed canonical path of a Zotero-managed source, where
 * the window between the check and the copy is not meaningful.
 *
 * `handle` is the descriptor opened while the source was confirmed, so a
 * linked file outside Zotero's control writes the bytes that were checked even
 * if the path is swapped underneath. The caller owns the handle and closes it.
 */
export type AttachmentCopySource =
  | { kind: "path"; path: string }
  | { kind: "handle"; handle: FileHandle };

export interface AttachmentCopyItem {
  source: AttachmentCopySource;
  dest: string;
}

export interface AttachmentCopyResult {
  copied: number;
  skipped: number;
  /** Sources absent on disk (e.g. an annotation Zotero has not rendered to its cache yet). */
  missing: number;
}

/**
 * Copy each queued attachment, reflinking when possible. A missing source is
 * counted in `missing` rather than thrown, so one absent file never aborts the
 * surrounding note import.
 */
export async function copyAttachments(
  items: readonly AttachmentCopyItem[],
): Promise<AttachmentCopyResult> {
  const result: AttachmentCopyResult = { copied: 0, skipped: 0, missing: 0 };
  for (const item of items) {
    result[await copyAttachment(item)] += 1;
  }
  return result;
}

/**
 * Attempt one attachment copy and report which bucket it fell into. The source
 * is read and written directly; a path source that is absent — whether at the
 * initial read or because it vanished mid-copy — surfaces as a Node `ENOENT`
 * we classify as `"missing"`, never a check-then-act existence probe.
 */
async function copyAttachment({
  source,
  dest,
}: AttachmentCopyItem): Promise<keyof AttachmentCopyResult> {
  try {
    const sourceStat =
      source.kind === "handle"
        ? await source.handle.stat()
        : await stat(source.path);
    if (await destMatches(sourceStat, dest)) return "skipped";
    await writeCopy(source, dest, sourceStat);
    return "copied";
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      logger.warn("Skipped attachment with missing source", { dest, error });
      return "missing";
    }
    throw error;
  }
}

/**
 * Copy into a randomly named temp file next to `dest`, stamp it with the
 * source's timestamps, then rename it into place. Stamping happens before
 * the rename — never on `dest` itself — so no step after the rename touches
 * `dest` by path; a path swapped in after the rename cannot redirect a
 * metadata write through a symlink. `rename` replaces whatever directory
 * entry sits at `dest` without ever opening `dest` itself, so a reader never
 * observes a partially written file. A failed attempt removes the temp file.
 */
async function writeCopy(
  source: AttachmentCopySource,
  dest: string,
  sourceStat: Stats,
): Promise<void> {
  const tempPath = join(dirname(dest), `.${randomUUID()}.zotlit-tmp`);
  try {
    await copyIntoTemp(source, tempPath);
    await utimes(tempPath, sourceStat.atime, sourceStat.mtime);
    await rename(tempPath, dest);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

/**
 * Every branch creates `tempPath` with exclusive access: `reflink` clones onto
 * a path that must not already exist, the plain-copy fallback passes
 * `COPYFILE_EXCL`, and the descriptor stream opens with `wx`. Combined with
 * `tempPath`'s unpredictable name, no branch can be redirected onto a file an
 * attacker prepared in advance.
 *
 * A descriptor source streams rather than reflinks: cloning names its source
 * by path, which is the substitution this branch exists to rule out. That
 * costs little, because a linked file usually sits on a different filesystem
 * from the vault anyway.
 */
async function copyIntoTemp(
  source: AttachmentCopySource,
  tempPath: string,
): Promise<void> {
  if (source.kind === "handle") {
    await pipeline(
      source.handle.createReadStream({ autoClose: false, start: 0 }),
      createWriteStream(tempPath, { flags: "wx" }),
    );
    return;
  }
  try {
    await reflink(source.path, tempPath);
  } catch {
    await copyFile(source.path, tempPath, constants.COPYFILE_EXCL);
  }
}

/**
 * `lstat`, not `stat`: inspecting the directory entry itself — rather than
 * whatever it points to — is what lets an existing destination symlink be
 * rejected outright instead of silently compared against and then replaced.
 *
 * @throws When `dest` exists and is a symbolic link.
 */
async function destMatches(sourceStat: Stats, dest: string): Promise<boolean> {
  try {
    const destStat = await lstat(dest);
    if (destStat.isSymbolicLink()) {
      throw new Error(
        `Refusing to write through existing symbolic link at destination: ${dest}`,
      );
    }
    return (
      sourceStat.size === destStat.size &&
      sourceStat.mtimeMs === destStat.mtimeMs
    );
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
}
