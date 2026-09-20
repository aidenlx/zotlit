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
 * - `immutable` clones and verifies the main database only, then opens that
 *   owned snapshot with `immutable=1`. It does not replay the live WAL. On
 *   Zotero 10 that costs freshness, so a non-empty WAL records
 *   {@link ReadFallbackReason} `wal-not-replayed`.
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
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, open, rm, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
const WAL_HEADER_BYTES = 32;
const JOURNAL_HEADER_BYTES = 8;
const HOT_JOURNAL_MIN_BYTES = 512n;
const JOURNAL_MAGIC = Buffer.from([
  0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7,
]);
const HASH_BUFFER_BYTES = 64 * 1024;

export type ConfiguredReadMode = ZoteroReadMode;
export type EffectiveReadMode = "reflink" | "copy" | "immutable";
export type ReadFallbackReason = "reflink-unsupported" | "wal-not-replayed";

export interface SqliteUriOptions {
  mode?: "ro";
  immutable?: true;
}

export interface PreparedRead extends AsyncDisposable {
  path: string;
  uriOptions: SqliteUriOptions;
  effectiveMode: EffectiveReadMode;
  fallbackReason?: ReadFallbackReason;
}

export type MainIdentity =
  | { exists: false }
  | {
      exists: true;
      dev: bigint;
      ino: bigint;
      size: bigint;
      mtimeNs: bigint;
      ctimeNs: bigint;
      digest: string;
    };

export type WalGeneration =
  | { state: "absent" }
  | { state: "empty" }
  | { state: "unstable" }
  | { state: "present"; digest: string; header: Buffer; size: bigint };

type JournalGeneration =
  | { state: "absent" }
  | { state: "unstable" }
  | ({ state: "active" } & JournalIdentity)
  | ({ state: "inactive" } & JournalIdentity);

interface JournalIdentity {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  header: Buffer;
}

/** Identity of the live source pair at one instant. See {@link snapshotSource}. */
interface SourcePair {
  main: MainIdentity;
  wal: WalGeneration;
  journal: JournalGeneration;
}

export interface SourceFingerprint extends SourcePair {
  path: string;
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
 * `auto` and `reflink` attempt the native reflink clone. On a clone capability
 * failure, they acquire a verified owned main-file + WAL copy. This preserves
 * standalone startup and committed WAL rows where reflinks are unavailable,
 * without reopening the mutable source in place.
 *
 * Capability failures drive the fallback; source-access and transient I/O errors
 * propagate so the caller can report a refresh failure.
 */
export async function prepareRead(
  configuredMode: ConfiguredReadMode,
  sourcePath: string,
): Promise<PreparedRead> {
  if (configuredMode === "immutable") {
    const fallbackReason = await staleWalReason(sourcePath);
    const read = await prepareImmutableRead(sourcePath);
    return fallbackReason ? { ...read, fallbackReason } : read;
  }
  if (configuredMode === "copy") return prepareTempRead("copy", sourcePath);

  try {
    return await prepareTempRead("reflink", sourcePath);
  } catch (error) {
    if (!(error instanceof ReflinkUnsupportedError)) throw error;
    const read = await prepareTempRead("copy", sourcePath);
    return { ...read, fallbackReason: "reflink-unsupported" };
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
export async function staleWalReason(
  sourcePath: string,
): Promise<ReadFallbackReason | undefined> {
  const wal = await walGeneration(`${sourcePath}-wal`);
  return wal.state === "present" || wal.state === "unstable"
    ? "wal-not-replayed"
    : undefined;
}

async function prepareImmutableRead(sourcePath: string): Promise<PreparedRead> {
  try {
    return await prepareTempRead("reflink", sourcePath, {
      includeWal: false,
      immutable: true,
    });
  } catch (error) {
    if (!(error instanceof ReflinkUnsupportedError)) throw error;
    return prepareTempRead("copy", sourcePath, {
      includeWal: false,
      immutable: true,
    });
  }
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
  options: { includeWal?: boolean; immutable?: boolean } = {},
): Promise<PreparedRead> {
  const plan = await planParents(sourcePath);
  const lastIndex = plan.parents.length - 1;
  for (const [index, parent] of plan.parents.entries()) {
    try {
      const read = await cloneInto(sourcePath, { parent, mode, ...options });
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
  sourcePath: string,
  {
    parent,
    mode,
    includeWal = true,
    immutable = false,
  }: {
    parent: string;
    mode: TempReadMode;
    includeWal?: boolean;
    immutable?: boolean;
  },
): Promise<PreparedRead> {
  for (let attempt = 1; attempt <= CLONE_ATTEMPTS; attempt += 1) {
    const dir = await createSnapshotDir(parent);
    try {
      const path = join(dir, basename(sourcePath));
      const walPath = `${sourcePath}-wal`;
      const journalPath = `${sourcePath}-journal`;
      const before = await snapshotPair(sourcePath, {
        walPath,
        journalPath,
        includeWal,
      });
      let after: SourcePair | undefined;
      let acquired: SourcePair | undefined;
      if (journalIsSafe(before.journal)) {
        await Promise.all([
          copySource(mode, sourcePath, path),
          includeWal && before.wal.state !== "absent"
            ? copySource(mode, walPath, `${path}-wal`)
            : undefined,
        ]);
        acquired = await snapshotPair(path, {
          walPath: `${path}-wal`,
          journalPath: `${path}-journal`,
          includeWal,
        });
        after = await snapshotPair(sourcePath, {
          walPath,
          journalPath,
          includeWal,
        });
      }

      const matches =
        after !== undefined &&
        acquired !== undefined &&
        sourcePairsEqual(before, after) &&
        sourcePairContentsEqual(before, acquired);
      logger.debug("Database read snapshot fingerprint checked", {
        verdict: matches ? "unchanged" : "changed",
        beforeJournalState: before.journal.state,
        beforeWalState: before.wal.state,
        beforeWalSize: walGenerationSize(before.wal),
        acquiredWalState: acquired?.wal.state,
        acquiredWalSize: walGenerationSize(acquired?.wal),
        afterJournalState: after?.journal.state,
        afterWalState: after?.wal.state,
        afterWalSize: walGenerationSize(after?.wal),
      });
      if (matches) {
        verifySnapshot(path);
        return {
          path,
          uriOptions: immutable
            ? { mode: "ro", immutable: true }
            : { mode: "ro" },
          effectiveMode: immutable ? "immutable" : mode,
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
 * Fingerprint the complete live source pair. Equal fingerprints identify the
 * same main-file and WAL bytes, including a reused WAL tail whose header and
 * size did not change.
 *
 * @see DatabaseService's `#sourceMoved` for the gate this feeds.
 */
export async function snapshotSource(
  sourcePath: string,
): Promise<SourceFingerprint> {
  const pair = await snapshotPair(sourcePath, {
    walPath: `${sourcePath}-wal`,
    journalPath: `${sourcePath}-journal`,
  });
  return { path: sourcePath, ...pair };
}

export function sourceFingerprintsEqual(
  a: SourceFingerprint,
  b: SourceFingerprint,
): boolean {
  return a.path === b.path && sourcePairsEqual(a, b);
}

async function snapshotPair(
  sourcePath: string,
  {
    walPath,
    journalPath,
    includeWal = true,
  }: { walPath: string; journalPath: string; includeWal?: boolean },
): Promise<SourcePair> {
  const journalBefore = await journalGeneration(journalPath);
  const [main, wal] = await Promise.all([
    mainIdentity(sourcePath),
    includeWal
      ? walGeneration(walPath)
      : Promise.resolve({ state: "absent" } as const),
  ]);
  const journalAfter = await journalGeneration(journalPath);
  const journal = bracketedJournal(journalBefore, journalAfter);
  return { main, wal, journal };
}

function bracketedJournal(
  before: JournalGeneration,
  after: JournalGeneration,
): JournalGeneration {
  return journalGenerationsEqual(before, after)
    ? before
    : { state: "unstable" };
}

function sourcePairsEqual(a: SourcePair, b: SourcePair): boolean {
  return (
    mainIdentitiesEqual(a.main, b.main) &&
    walGenerationsEqual(a.wal, b.wal) &&
    journalIsSafe(a.journal) &&
    journalIsSafe(b.journal) &&
    journalGenerationsEqual(a.journal, b.journal)
  );
}

/** Equal SQLite bytes, independent of the destination files' own identities. */
function sourcePairContentsEqual(a: SourcePair, b: SourcePair): boolean {
  return (
    mainContentsEqual(a.main, b.main) &&
    walGenerationsEqual(a.wal, b.wal) &&
    journalIsSafe(a.journal) &&
    journalIsSafe(b.journal)
  );
}

async function mainIdentity(path: string): Promise<MainIdentity> {
  try {
    await using file = await open(path, "r");
    const before = await file.stat({ bigint: true });
    const digest = await fileDigest(file);
    const stats = await file.stat({ bigint: true });
    if (!sameFileState(before, stats))
      throw new Error("SQLite database changed while it was fingerprinted");
    return {
      exists: true,
      dev: stats.dev,
      ino: stats.ino,
      size: stats.size,
      mtimeNs: stats.mtimeNs,
      ctimeNs: stats.ctimeNs,
      digest,
    };
  } catch (error) {
    if (isErrno(error, "ENOENT")) return { exists: false };
    throw error;
  }
}

function mainIdentitiesEqual(a: MainIdentity, b: MainIdentity): boolean {
  if (!a.exists || !b.exists) return a.exists === b.exists;
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs &&
    a.digest === b.digest
  );
}

function mainContentsEqual(a: MainIdentity, b: MainIdentity): boolean {
  if (!a.exists || !b.exists) return a.exists === b.exists;
  return a.size === b.size && a.digest === b.digest;
}

/**
 * SQLite's checkpoint sequence, salts, and checksums occupy the 32-byte WAL
 * header. SQLite can reuse rolled-back tail frames without changing that header
 * or the file size, so the full digest identifies the bytes. Any in-motion or
 * unreadable observation is unstable and therefore fails closed at the
 * caller's comparison.
 *
 * @see https://github.com/sqlite/sqlite/blob/version-3.50.4/src/wal.c#L34-L45
 */
async function walGeneration(path: string): Promise<WalGeneration> {
  try {
    await using file = await open(path, "r");
    const before = await file.stat({ bigint: true });
    if (before.size === 0n) {
      const after = await file.stat({ bigint: true });
      return after.size === 0n ? { state: "empty" } : { state: "unstable" };
    }

    const header = Buffer.alloc(WAL_HEADER_BYTES);
    const verification = Buffer.alloc(WAL_HEADER_BYTES);
    const firstRead = await file.read(header, 0, WAL_HEADER_BYTES, 0);
    const digest = await fileDigest(file);
    const secondRead = await file.read(verification, 0, WAL_HEADER_BYTES, 0);
    const after = await file.stat({ bigint: true });
    if (
      firstRead.bytesRead === WAL_HEADER_BYTES &&
      secondRead.bytesRead === WAL_HEADER_BYTES &&
      sameFileState(before, after) &&
      header.equals(verification)
    ) {
      return { state: "present", digest, header, size: after.size };
    }
    return { state: "unstable" };
  } catch (error) {
    return isErrno(error, "ENOENT")
      ? { state: "absent" }
      : { state: "unstable" };
  }
}

function walGenerationsEqual(a: WalGeneration, b: WalGeneration): boolean {
  if (a.state !== b.state || a.state === "unstable") return false;
  if (a.state !== "present" || b.state !== "present") return true;
  return (
    a.size === b.size && a.header.equals(b.header) && a.digest === b.digest
  );
}

async function journalGeneration(path: string): Promise<JournalGeneration> {
  try {
    const pathBefore = await stat(path, { bigint: true });
    await using file = await open(path, "r");
    const before = await file.stat({ bigint: true });
    const header = Buffer.alloc(JOURNAL_HEADER_BYTES);
    const verification = Buffer.alloc(JOURNAL_HEADER_BYTES);
    const firstRead = await file.read(header, 0, JOURNAL_HEADER_BYTES, 0);
    const secondRead = await file.read(
      verification,
      0,
      JOURNAL_HEADER_BYTES,
      0,
    );
    const after = await file.stat({ bigint: true });
    const pathAfter = await stat(path, { bigint: true });
    if (
      !sameFileState(pathBefore, before) ||
      !sameFileState(before, after) ||
      !sameFileState(after, pathAfter) ||
      firstRead.bytesRead !== secondRead.bytesRead ||
      !header.equals(verification)
    ) {
      return { state: "unstable" };
    }
    const observedHeader = header.subarray(0, firstRead.bytesRead);
    return {
      state:
        after.size > HOT_JOURNAL_MIN_BYTES &&
        observedHeader.equals(JOURNAL_MAGIC)
          ? "active"
          : "inactive",
      dev: after.dev,
      ino: after.ino,
      size: after.size,
      mtimeNs: after.mtimeNs,
      ctimeNs: after.ctimeNs,
      header: observedHeader,
    };
  } catch (error) {
    return isErrno(error, "ENOENT")
      ? { state: "absent" }
      : { state: "unstable" };
  }
}

function journalIsSafe(journal: JournalGeneration): boolean {
  return journal.state === "absent" || journal.state === "inactive";
}

function journalGenerationsEqual(
  a: JournalGeneration,
  b: JournalGeneration,
): boolean {
  if (a.state !== b.state || a.state === "unstable" || b.state === "unstable")
    return false;
  if (a.state === "absent" || b.state === "absent") return true;
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs &&
    a.header.equals(b.header)
  );
}

function sameFileState(
  a: {
    dev: bigint;
    ino: bigint;
    size: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
  },
  b: {
    dev: bigint;
    ino: bigint;
    size: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
  },
): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}

async function fileDigest(file: FileHandle): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
  let position = 0;
  while (true) {
    const { bytesRead } = await file.read(
      buffer,
      0,
      HASH_BUFFER_BYTES,
      position,
    );
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

/** Structural check only; source equality and SQLite's WAL commit markers prove state. */
function verifySnapshot(path: string): void {
  using sqlite = new DatabaseSync(path, { readOnly: true, timeout: 1_000 });
  const result = sqlite.prepare("PRAGMA integrity_check").get();
  if (result?.integrity_check !== "ok")
    throw new Error("SQLite rejected the database read snapshot");
}

export function walGenerationSize(
  wal: WalGeneration | undefined,
): string | undefined {
  return wal?.state === "present" ? wal.size.toString() : undefined;
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
