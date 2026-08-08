/**
 * WAL-fresh read sources for the live Zotero SQLite database.
 *
 * Zotero keeps `zotero.sqlite` open in WAL mode with exclusive locking while it
 * runs, so recent writes live in `zotero.sqlite-wal` until a checkpoint. To read
 * a fresh view without disturbing Zotero:
 *
 * - Clone modes (`reflink`/`copy`) copy the main DB plus its WAL into a fresh,
 *   writable temp dir and open the clone with `mode=ro`. The dir stays writable
 *   so SQLite can create the `-shm` sidecar and replay the cloned WAL, exposing
 *   committed *and* not-yet-checkpointed rows without writing the cloned main DB.
 * - `immutable` opens the source file in place with `immutable=1`. SQLite then
 *   assumes the file cannot change, skips locking, and reads the committed main
 *   DB only (it does not replay the live WAL). This is the safe fallback when
 *   cloning is unavailable.
 *
 * Fact: `node:sqlite` `DatabaseSync` does honor `file:` URI query params.
 */

import { delay } from "@std/async";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import { ZOTERO_DB_READ_TEMP_PREFIX } from "@/lib/constants";
import { isErrno } from "@/lib/errno";
import { getLogger } from "@/lib/log";
import { reflink, ReflinkUnsupportedError } from "@/lib/reflink";
import type { ZoteroReadMode } from "@/services/settings/schema";

export { reapStaleReadTemps } from "./reap-stale-read-temps";

const logger = getLogger(["database", "read-source"]);
const CLONE_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 25;

export type ConfiguredReadMode = ZoteroReadMode;
export type EffectiveReadMode = "reflink" | "copy" | "immutable";
export type ReadFallbackNotice = "reflink-unsupported";

export interface SqliteUriOptions {
  mode?: "ro";
  immutable?: true;
}

export interface PreparedRead extends AsyncDisposable {
  path: string;
  uriOptions: SqliteUriOptions;
  effectiveMode: EffectiveReadMode;
  fallbackNotice?: ReadFallbackNotice;
}

type FileFingerprint =
  | { exists: false }
  | {
      exists: true;
      dev: bigint;
      ino: bigint;
      size: bigint;
      mtimeNs: bigint;
      ctimeNs: bigint;
    };

type TempReadMode = "reflink" | "copy";

export function buildSqliteUri(
  dbPath: string,
  options: SqliteUriOptions,
): string {
  const url = pathToFileURL(dbPath);
  if (options.mode) url.searchParams.set("mode", options.mode);
  if (options.immutable) url.searchParams.set("immutable", "1");
  return url.href;
}

/**
 * `auto` and `reflink` both attempt the native reflink clone and, on a clone
 * *capability* failure, both degrade to `immutable`. They differ only in
 * loudness: `reflink` was an explicit request, so it surfaces a one-time
 * fallback notice; `auto` degrades silently. Neither falls back to full `copy` —
 * avoiding an automatic full-database duplication is preferred over forcing WAL
 * freshness on a volume that cannot reflink.
 *
 * Capability failures drive the fallback; source-access and transient I/O errors
 * propagate so the caller can report a refresh failure.
 */
export async function prepareRead(
  configuredMode: ConfiguredReadMode,
  sourcePath: string,
): Promise<PreparedRead> {
  if (configuredMode === "immutable") return immutableRead(sourcePath);
  if (configuredMode === "copy") return prepareTempRead("copy", sourcePath);

  try {
    return await prepareTempRead("reflink", sourcePath);
  } catch (error) {
    if (!(error instanceof ReflinkUnsupportedError)) throw error;
    const read = immutableRead(sourcePath);
    return configuredMode === "reflink"
      ? { ...read, fallbackNotice: "reflink-unsupported" }
      : read;
  }
}

function immutableRead(sourcePath: string): PreparedRead {
  return {
    path: sourcePath,
    uriOptions: { mode: "ro", immutable: true },
    effectiveMode: "immutable",
    async [Symbol.asyncDispose]() {},
  };
}

/**
 * Clone the source DB + WAL into a fresh temp dir, guarding against a torn
 * snapshot: fingerprint the source pair before and after copying and accept the
 * clone only when both files are unchanged across the copy. A concurrent Zotero
 * write invalidates the attempt; retry up to {@link CLONE_ATTEMPTS} times with a
 * short backoff, then throw so the service keeps its previous client.
 *
 * The clone opens with `mode=ro` (not `immutable`) so SQLite may build sidecar
 * files in the writable temp dir and replay the cloned WAL.
 */
async function prepareTempRead(
  mode: TempReadMode,
  sourcePath: string,
): Promise<PreparedRead> {
  for (let attempt = 1; attempt <= CLONE_ATTEMPTS; attempt += 1) {
    const dir = await mkdtemp(
      join(tmpdir(), `${ZOTERO_DB_READ_TEMP_PREFIX}${process.pid}-`),
    );
    try {
      const path = join(dir, basename(sourcePath));
      const walPath = `${sourcePath}-wal`;
      const before = await snapshotPair(sourcePath, walPath);

      await Promise.all([
        copySource(mode, sourcePath, path),
        before.wal.exists
          ? copySource(mode, walPath, `${path}-wal`)
          : undefined,
      ]);

      const after = await snapshotPair(sourcePath, walPath);
      if (
        fingerprintsEqual(before.main, after.main) &&
        fingerprintsEqual(before.wal, after.wal)
      ) {
        return {
          path,
          uriOptions: { mode: "ro" },
          effectiveMode: mode,
          async [Symbol.asyncDispose]() {
            try {
              await rm(dir, { recursive: true, force: true });
            } catch (error) {
              logger.warn("Failed to remove database read temp", {
                error,
                path: dir,
              });
            }
          },
        };
      }
    } catch (error) {
      await removeAttemptDir(dir);
      if (mode === "reflink" && isNativeCloneCapabilityError(error)) {
        throw new ReflinkUnsupportedError(error);
      }
      throw error;
    }

    await removeAttemptDir(dir);
    if (attempt < CLONE_ATTEMPTS) await delay(RETRY_BACKOFF_MS);
  }

  throw new Error("Zotero database changed while preparing a read snapshot");
}

async function copySource(
  mode: TempReadMode,
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  if (mode === "copy") {
    await copyFile(sourcePath, targetPath);
    return;
  }
  await reflink(sourcePath, targetPath);
}

async function snapshotPair(
  sourcePath: string,
  walPath: string,
): Promise<{ main: FileFingerprint; wal: FileFingerprint }> {
  const [main, wal] = await Promise.all([
    fingerprint(sourcePath),
    fingerprint(walPath),
  ]);
  return { main, wal };
}

async function fingerprint(path: string): Promise<FileFingerprint> {
  try {
    const s = await stat(path, { bigint: true });
    return {
      exists: true,
      dev: s.dev,
      ino: s.ino,
      size: s.size,
      mtimeNs: s.mtimeNs,
      ctimeNs: s.ctimeNs,
    };
  } catch (error) {
    if (isErrno(error, "ENOENT")) return { exists: false };
    throw error;
  }
}

function fingerprintsEqual(a: FileFingerprint, b: FileFingerprint): boolean {
  if (!a.exists || !b.exists) return a.exists === b.exists;
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}

/**
 * Distinguishes "this volume/platform cannot reflink" (drives mode fallback)
 * from genuine I/O failures (which propagate as refresh failures). Cross-device
 * (`EXDEV`) and filesystem-unsupported (`ENOTSUP`/`EOPNOTSUPP`) clone attempts,
 * plus any non-macOS/Linux platform, count as capability failures.
 */
function isNativeCloneCapabilityError(error: unknown): boolean {
  if (error instanceof ReflinkUnsupportedError) return true;
  if (process.platform !== "darwin" && process.platform !== "linux") {
    return true;
  }
  return (
    isErrno(error, "EXDEV") ||
    isErrno(error, "ENOTSUP") ||
    isErrno(error, "EOPNOTSUPP")
  );
}

async function removeAttemptDir(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch (error) {
    logger.warn("Failed to remove failed database read temp", { error, path });
  }
}
