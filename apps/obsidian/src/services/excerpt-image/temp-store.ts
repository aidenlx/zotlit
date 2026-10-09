// Files handed to local CLI callers, published atomically and aged by last use.
import { randomUUID } from "node:crypto";
import { link, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isErrno } from "@/lib/errno";
import { getLogger } from "@/lib/log";

export function excerptTempDirectory(parent = tmpdir()): string {
  return join(parent, "zotlit-excerpts");
}

/** A complete PNG appears at the content address in one link operation. */
export async function publishExcerptPng(
  fingerprint: string,
  bytes: Uint8Array,
  directory = excerptTempDirectory(),
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${fingerprint}.png`);
  await using stack = new AsyncDisposableStack();
  const staging = stack.adopt(
    join(directory, `.${fingerprint}-${randomUUID()}.part`),
    (file) =>
      rm(file, { force: true }).catch((error: unknown) => {
        getLogger("excerpt-image").warn("Cannot remove staged excerpt PNG", {
          file,
          error,
        });
      }),
  );
  await writeFile(staging, bytes, { flag: "wx" });
  try {
    await link(staging, path);
  } catch (error) {
    if (!isErrno(error, "EEXIST")) throw error;
  }
  const now = Temporal.Now.instant().epochMilliseconds / 1000;
  await utimes(path, now, now);
  return path;
}
