/**
 * WAL-fresh read sources for the live Zotero SQLite database.
 *
 * Zotero keeps `zotero.sqlite` open with exclusive locking while it runs. From
 * Zotero 10 it also runs the database in WAL mode, so recent writes live in
 * `zotero.sqlite-wal` until a checkpoint; Zotero 9 and earlier use a rollback
 * journal and write no `-wal` file at all. Every path below keys off the
 * presence of that file rather than off a version number, so both hold. To read
 * a fresh view without disturbing Zotero:
 *
 * - Clone modes (`reflink`/`copy`) copy the main DB plus its WAL into a fresh,
 *   writable snapshot dir and open the clone with `mode=ro`. The dir stays
 *   writable so SQLite can create the `-shm` sidecar and replay the cloned WAL,
 *   exposing committed *and* not-yet-checkpointed rows without writing the
 *   cloned main DB. {@link planReadParents} picks which volume holds that dir.
 * - `immutable` opens the source file in place with `immutable=1`. SQLite then
 *   assumes the file cannot change, skips locking, and reads the committed main
 *   DB only (it does not replay the live WAL). This is the safe fallback when
 *   cloning is unavailable. On Zotero 10 that costs freshness, so a non-empty
 *   WAL raises {@link ReadFallbackNotice} `wal-not-replayed`.
 *
 * A Zotero 10 data dir holds no `-shm` file to clone: Zotero sets
 * `locking_mode=EXCLUSIVE` before `journal_mode=WAL`, which keeps the WAL index
 * in heap memory. Verified against a live Zotero 10.0 data directory.
 *
 * Fact: `node:sqlite` `DatabaseSync` does honor `file:` URI query params.
 *
 * @see https://github.com/zotero/zotero/blob/10.0.0/chrome/content/zotero/xpcom/db.js#L1551
 */

import { delay } from "@std/async";
import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { ZOTERO_DB_READ_TEMP_PREFIX } from "@/lib/constants";
import { isErrno } from "@/lib/errno";
import { getLogger } from "@/lib/log";
import { reflink, ReflinkUnsupportedError } from "@/lib/reflink";
import type { ZoteroReadMode } from "@/services/settings/schema";

import { planReadParents } from "./read-parent";
import type { ReadParentPlan } from "./read-parent";

const logger = getLogger(["database", "read-source"]);
const CLONE_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 25;

export type ConfiguredReadMode = ZoteroReadMode;
export type EffectiveReadMode = "reflink" | "copy" | "immutable";
export type ReadFallbackNotice = "reflink-unsupported" | "wal-not-replayed";

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

/** Identity of the live source pair at one instant. See {@link snapshotSource}. */
export interface SourceFingerprint {
  path: string;
  main: FileFingerprint;
  wal: FileFingerprint;
}

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
 * *capability* failure, both degrade to `immutable`. Each then reports the one
 * notice that explains its own outcome: `reflink` was an explicit request, so it
 * names the unsupported clone unless the resulting immutable read would skip a
 * non-empty WAL. Detected stale data takes priority for every configured mode.
 * Neither falls back to full `copy` on its own — avoiding an automatic
 * full-database duplication is preferred over forcing WAL freshness on a volume
 * that cannot reflink.
 *
 * Capability failures drive the fallback; source-access and transient I/O errors
 * propagate so the caller can report a refresh failure.
 */
export async function prepareRead(
  configuredMode: ConfiguredReadMode,
  sourcePath: string,
): Promise<PreparedRead> {
  if (configuredMode === "immutable") {
    const read = immutableRead(sourcePath);
    const fallbackNotice = await staleWalNotice(sourcePath);
    return fallbackNotice ? { ...read, fallbackNotice } : read;
  }
  if (configuredMode === "copy") return prepareTempRead("copy", sourcePath);

  try {
    return await prepareTempRead("reflink", sourcePath);
  } catch (error) {
    if (!(error instanceof ReflinkUnsupportedError)) throw error;
    const read = immutableRead(sourcePath);
    const fallbackNotice = await staleWalNotice(sourcePath);
    if (fallbackNotice) return { ...read, fallbackNotice };
    if (configuredMode === "reflink")
      return { ...read, fallbackNotice: "reflink-unsupported" };
    return read;
  }
}

/**
 * `wal-not-replayed` when reading the source in place would skip rows Zotero has
 * already committed — an `immutable` read never replays the live WAL, so on
 * Zotero 10 it hides every transaction since the last checkpoint. A non-empty
 * `zotero.sqlite-wal` is exactly that condition; Zotero truncates the file on
 * idle and on clean close, so a cleanly closed Zotero raises nothing.
 *
 * Measured against a live Zotero 10.0 data directory: five items created through
 * Zotero read back as five rows from a main+WAL clone and as zero rows from an
 * `immutable` read of the same source.
 */
export async function staleWalNotice(
  sourcePath: string,
): Promise<ReadFallbackNotice | undefined> {
  const wal = await fingerprint(`${sourcePath}-wal`);
  return wal.exists && wal.size > 0n ? "wal-not-replayed" : undefined;
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
 * Place the snapshot on the volume {@link planReadParents} prefers, and where
 * that parent will not take one, fall back to the next candidate. Diversion is
 * an optimization, never a correctness dependency: a read that falls all the way
 * back to the system temp folder is exactly the read this did before placement
 * existed, and the choice is remade from scratch on every read.
 *
 * @see {@link SnapshotParentError} for which failures the fallback answers.
 */
async function prepareTempRead(
  mode: TempReadMode,
  sourcePath: string,
): Promise<PreparedRead> {
  const plan = await planParents(sourcePath);
  const lastIndex = plan.parents.length - 1;
  for (const [index, parent] of plan.parents.entries()) {
    try {
      const read = await cloneInto(parent, mode, sourcePath);
      logger.debug("Prepared a database read snapshot", {
        parent,
        reason: plan.reason,
        afterFallback: index > 0,
        mode,
      });
      return read;
    } catch (error) {
      if (index === lastIndex || !(error instanceof SnapshotParentError))
        throw error;
      logger.debug("Database read snapshot parent unusable, falling back", {
        error,
        parent,
        reason: plan.reason,
      });
    }
  }
  // Unreachable: the last candidate rethrows rather than falling through.
  throw new Error("No database read snapshot parent was available");
}

/**
 * The parent would not take the snapshot — a read-only or full volume, a
 * directory the process may not create. Those are the failures a later
 * candidate can still answer, so they are the ones the fallback acts on. Every
 * other failure — a clone the volume cannot make, a source that moved mid-copy,
 * an unreadable source — reaches every candidate alike and propagates from the
 * first.
 */
class SnapshotParentError extends Error {
  constructor(parent: string, cause: unknown) {
    super(`Cannot create a database read snapshot under ${parent}`, { cause });
    this.name = "SnapshotParentError";
  }
}

async function planParents(sourcePath: string): Promise<ReadParentPlan> {
  const [tempDevice, databaseDevice] = await Promise.all([
    deviceId(tmpdir()),
    deviceId(dirname(sourcePath)),
  ]);
  return planReadParents({
    databasePath: sourcePath,
    tempDevice,
    databaseDevice,
  });
}

/** `0n` — the plan's "unknown" — where the volume cannot be identified. */
async function deviceId(path: string): Promise<bigint> {
  try {
    return (await stat(path, { bigint: true })).dev;
  } catch (error) {
    logger.debug("Failed to read a volume id", { error, path });
    return 0n;
  }
}

/**
 * Clone the source DB + WAL into a fresh dir under `parent`, guarding against a
 * torn snapshot: fingerprint the source pair before and after copying and accept
 * the clone only when both files are unchanged across the copy. A concurrent
 * Zotero write invalidates the attempt; retry up to {@link CLONE_ATTEMPTS} times
 * with a short backoff, then throw so the service keeps its previous client.
 *
 * The clone opens with `mode=ro` (not `immutable`) so SQLite may build sidecar
 * files in the writable snapshot dir and replay the cloned WAL.
 */
async function cloneInto(
  parent: string,
  mode: TempReadMode,
  sourcePath: string,
): Promise<PreparedRead> {
  for (let attempt = 1; attempt <= CLONE_ATTEMPTS; attempt += 1) {
    const dir = await createSnapshotDir(parent);
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
      const cloneUnsupported =
        mode === "reflink" && isNativeCloneCapabilityError(error);
      logger.debug("Database read snapshot attempt failed", {
        error,
        mode,
        parent,
        cloneUnsupported,
      });
      if (cloneUnsupported) throw new ReflinkUnsupportedError(error);
      if (isParentWriteFailure(error))
        throw new SnapshotParentError(parent, error);
      throw error;
    }

    await removeAttemptDir(dir);
    if (attempt < CLONE_ATTEMPTS) await delay(RETRY_BACKOFF_MS);
  }

  throw new Error("Zotero database changed while preparing a read snapshot");
}

/**
 * Both steps are destination-only, so a failure here is the parent's and no
 * other candidate's. `mkdir` alone would miss a volume that went read-only
 * after the parent was first created, since a recursive `mkdir` over an
 * existing directory succeeds.
 *
 * @throws {@link SnapshotParentError} always, wrapping the underlying errno.
 */
async function createSnapshotDir(parent: string): Promise<string> {
  try {
    await mkdir(parent, { recursive: true });
    return await mkdtemp(
      join(parent, `${ZOTERO_DB_READ_TEMP_PREFIX}${process.pid}-`),
    );
  } catch (cause) {
    throw new SnapshotParentError(parent, cause);
  }
}

/**
 * Codes only a destination raises: reading a source never runs out of space,
 * exceeds a quota, or lands on a read-only filesystem. They mark a copy that
 * failed on the way in as the parent's failure, so a volume that fills between
 * creating the snapshot dir and writing the database falls back like one that
 * refused the dir outright.
 */
const PARENT_WRITE_ERRNOS: readonly string[] = ["ENOSPC", "EDQUOT", "EROFS"];

function isParentWriteFailure(error: unknown): boolean {
  return PARENT_WRITE_ERRNOS.some((code) => isErrno(error, code));
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

/**
 * Fingerprint the live source pair. A clone read leaves every field untouched,
 * so two equal fingerprints mean the database we would read is byte-identical to
 * the one we already hold.
 *
 * @see DatabaseService's `#sourceMoved` for the gate this feeds.
 */
export async function snapshotSource(
  sourcePath: string,
): Promise<SourceFingerprint> {
  const pair = await snapshotPair(sourcePath, `${sourcePath}-wal`);
  return { path: sourcePath, ...pair };
}

export function sourceFingerprintsEqual(
  a: SourceFingerprint,
  b: SourceFingerprint,
): boolean {
  return (
    a.path === b.path &&
    fingerprintsEqual(a.main, b.main) &&
    fingerprintsEqual(a.wal, b.wal)
  );
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
