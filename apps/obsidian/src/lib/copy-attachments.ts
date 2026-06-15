import { type Stats } from "node:fs";
import { copyFile, stat, utimes } from "node:fs/promises";

import { isErrno } from "./errno";
import { reflink } from "./reflink";

export interface AttachmentCopyItem {
  source: string;
  dest: string;
}

export interface AttachmentCopyResult {
  copied: number;
  skipped: number;
}

export async function copyAttachments(
  items: readonly AttachmentCopyItem[],
): Promise<AttachmentCopyResult> {
  let copied = 0;
  let skipped = 0;

  for (const item of items) {
    const sourceStat = await stat(item.source);
    if (await destMatches(sourceStat, item.dest)) {
      skipped += 1;
      continue;
    }
    await copyAttachment(item.source, item.dest, sourceStat);
    copied += 1;
  }

  return { copied, skipped };
}

async function copyAttachment(
  source: string,
  dest: string,
  sourceStat: Stats,
): Promise<void> {
  try {
    await reflink(source, dest);
  } catch {
    await copyFile(source, dest);
  }
  await utimes(dest, sourceStat.atime, sourceStat.mtime);
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
