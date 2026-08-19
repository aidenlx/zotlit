import { execFile } from "node:child_process";
import { constants, copyFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class ReflinkUnsupportedError extends Error {
  constructor(cause?: unknown) {
    super("Native reflink is unsupported", { cause });
    this.name = "ReflinkUnsupportedError";
  }
}

export async function reflink(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  if (process.platform === "darwin") {
    await reflinkMac(sourcePath, targetPath);
    return;
  }
  if (process.platform === "linux") {
    await copyFile(
      sourcePath,
      targetPath,
      constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL,
    );
    return;
  }
  throw new ReflinkUnsupportedError();
}

/**
 * Uses `cp -c` because Node's macOS copy-file flags do not expose a dependable
 * clonefile primitive. `-n` makes the clone exclusive: `cp` fails rather than
 * replacing an existing `targetPath`, matching the `COPYFILE_EXCL` guarantee
 * the plain-copy fallback gets from Node directly.
 *
 * @see https://github.com/libuv/libuv/pull/2578
 * @see https://github.com/libuv/libuv/pull/3654
 * @see https://github.com/libuv/libuv/pull/3987
 */
async function reflinkMac(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  try {
    await execFileAsync("cp", ["-c", "-n", sourcePath, targetPath]);
  } catch (error) {
    if (isClonefileUnsupported(error)) throw new ReflinkUnsupportedError(error);
    throw error;
  }
}

/**
 * `cp` reports a clone the volume cannot make as a plain exit failure carrying a
 * numeric exit code, so the caller sees no errno to branch on. The stderr line
 * is the tell: `cp` prefixes the `clonefile` `strerror` text, unlocalized, for
 * both a cross-volume clone and a filesystem without `clonefile` at all.
 * Verified live on macOS 15 against an external volume, where a `cp -c` across
 * volumes exits 1 with `clonefile failed: Cross-device link`.
 *
 * Genuine I/O failures — a missing source, a denied permission — carry other
 * stderr and keep propagating as refresh failures.
 */
export function isClonefileUnsupported(error: unknown): boolean {
  const stderr: unknown = (error as { stderr?: unknown } | null | undefined)
    ?.stderr;
  return typeof stderr === "string" && stderr.includes("clonefile failed");
}
