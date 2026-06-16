import { type Stats } from "node:fs";
import { copyFile, stat, utimes } from "node:fs/promises";

import { isErrno } from "./errno";
import { getLogger } from "./log";
import { reflink } from "./reflink";

const logger = getLogger("attachment-import");

export interface AttachmentCopyItem {
  source: string;
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
 * is read and written directly; an absent source — whether at the initial read
 * or because it vanished mid-copy — surfaces as a Node `ENOENT` we classify as
 * `"missing"`, never a check-then-act existence probe.
 */
async function copyAttachment({
  source,
  dest,
}: AttachmentCopyItem): Promise<keyof AttachmentCopyResult> {
  try {
    const sourceStat = await stat(source);
    if (await destMatches(sourceStat, dest)) return "skipped";
    await writeCopy(source, dest);
    await utimes(dest, sourceStat.atime, sourceStat.mtime);
    return "copied";
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      logger.warn("Skipped attachment with missing source", { source, error });
      return "missing";
    }
    throw error;
  }
}

async function writeCopy(source: string, dest: string): Promise<void> {
  try {
    await reflink(source, dest);
  } catch {
    await copyFile(source, dest);
  }
}

async function destMatches(sourceStat: Stats, dest: string): Promise<boolean> {
  try {
    const destStat = await stat(dest);
    return (
      sourceStat.size === destStat.size &&
      sourceStat.mtimeMs === destStat.mtimeMs
    );
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
}
