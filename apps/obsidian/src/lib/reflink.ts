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
  await execFileAsync("cp", ["-c", "-n", sourcePath, targetPath]);
}
