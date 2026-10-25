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

import { Cause, Deferred, Duration, Effect, Ref, Schedule } from "effect";
import type { Scope } from "effect";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, open, rm, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { ZOTERO_DB_READ_TEMP_PREFIX } from "@/lib/constants";
import { withLogCategory } from "@/lib/effect-log-category";
import { isErrno } from "@/lib/errno";
import { reflink, ReflinkUnsupportedError } from "@/lib/reflink";
import type { ZoteroReadMode } from "@/services/settings/schema";
import { DbUnavailable } from "@/services/zotero-reads/rpc";

import { planReadParents } from "./read-parent";
import { verifySnapshot } from "./snapshot-integrity";

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

export interface PreparedRead {
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

interface AcquiredRead {
  readonly read: PreparedRead;
  readonly release: Effect.Effect<void>;
}

const logDebug = (message: string, annotations: Record<string, unknown> = {}) =>
  Effect.logDebug(message).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("database", "read-source"),
  );

const logWarning = (
  message: string,
  error: unknown,
  annotations: Record<string, unknown> = {},
) =>
  Effect.logWarning(message, Cause.fail(error)).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("database", "read-source"),
  );

/** A failed read attempt whose destination is clean and safe to retry. */
class UnstableSnapshotError extends Error {
  constructor() {
    super("Zotero database changed while preparing a read snapshot");
    this.name = "UnstableSnapshotError";
  }
}

/** The message callers see for a failed read-source operation. */
function toDbUnavailable(cause: unknown): DbUnavailable {
  let error = cause;
  while (error instanceof Error && error.cause instanceof Error) {
    error = error.cause;
  }
  return new DbUnavailable({
    message: error instanceof Error ? error.message : String(error),
  });
}

/** Run one Node filesystem operation at the database port. */
function fsCall<A>(run: () => Promise<A>): Effect.Effect<A, unknown> {
  // boundary: node:fs/promises is Promise-based; wrap each call once.
  return Effect.tryPromise({ try: run, catch: (error) => error });
}

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
 *
 * @param owner Names the snapshot dir after the reader that holds it, so its
 *   residue can be reaped once that reader is gone while this process lives.
 * @see `reapWorkerClones` in `reap-temps.ts` for that reap.
 */
export const prepareRead = Effect.fnUntraced(function* (
  configuredMode: ConfiguredReadMode,
  sourcePath: string,
  owner?: string,
): Effect.fn.Return<PreparedRead, DbUnavailable, Scope.Scope> {
  const pending = yield* makePendingRead();
  yield* Effect.addFinalizer(() => pending.cancel);
  yield* Effect.forkDetach(
    acquireRead(configuredMode, sourcePath, owner).pipe(
      Effect.matchEffect({
        onFailure: (error) => pending.fail(error),
        onSuccess: (acquired) => pending.complete(acquired),
      }),
    ),
  );
  return yield* pending.result;
});

/**
 * Owns the gap between starting a snapshot and its caller receiving it. An
 * interrupted waiter marks the acquisition abandoned at once. A clone that
 * lands later releases its directory without bringing the wait back.
 */
const makePendingRead = Effect.fnUntraced(function* () {
  const deferred = yield* Deferred.make<PreparedRead, DbUnavailable>();
  const state = yield* Ref.make({
    canceled: false,
    release: null as Effect.Effect<void> | null,
  });
  const complete = (acquired: AcquiredRead) =>
    Effect.gen(function* () {
      const abandoned = yield* Ref.modify(state, (current) =>
        current.canceled
          ? [true, current]
          : [false, { ...current, release: acquired.release }],
      );
      if (abandoned) yield* acquired.release;
      else yield* Deferred.succeed(deferred, acquired.read);
    });
  return {
    result: Deferred.await(deferred),
    complete,
    fail: (error: unknown) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        if (!current.canceled)
          yield* Deferred.fail(deferred, toDbUnavailable(error));
      }),
    cancel: Effect.gen(function* () {
      const held = yield* Ref.modify(state, (current) => [
        current.release,
        { canceled: true, release: null },
      ]);
      if (held) yield* held;
    }),
  };
});

function acquireRead(
  configuredMode: ConfiguredReadMode,
  sourcePath: string,
  owner?: string,
): Effect.Effect<AcquiredRead, unknown> {
  return Effect.gen(function* () {
    if (configuredMode === "immutable") {
      const fallbackReason = yield* staleWalReason(sourcePath);
      const acquired = yield* prepareImmutableRead(sourcePath, owner);
      return fallbackReason
        ? {
            ...acquired,
            read: { ...acquired.read, fallbackReason },
          }
        : acquired;
    }
    if (configuredMode === "copy")
      return yield* prepareTempRead("copy", sourcePath, { owner });

    return yield* prepareTempRead("reflink", sourcePath, { owner }).pipe(
      Effect.catch((error) =>
        error instanceof ReflinkUnsupportedError
          ? prepareTempRead("copy", sourcePath, { owner }).pipe(
              Effect.map((acquired) => ({
                ...acquired,
                read: {
                  ...acquired.read,
                  fallbackReason: "reflink-unsupported" as const,
                },
              })),
            )
          : Effect.fail(error),
      ),
    );
  });
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
export const staleWalReason = Effect.fnUntraced(function* (sourcePath: string) {
  const wal = yield* walGeneration(`${sourcePath}-wal`);
  return wal.state === "present" || wal.state === "unstable"
    ? "wal-not-replayed"
    : undefined;
}, Effect.mapError(toDbUnavailable));

const prepareImmutableRead = Effect.fnUntraced(function* (
  sourcePath: string,
  owner: string | undefined,
) {
  return yield* prepareTempRead("reflink", sourcePath, {
    includeWal: false,
    immutable: true,
    owner,
  }).pipe(
    Effect.catch((error) =>
      error instanceof ReflinkUnsupportedError
        ? prepareTempRead("copy", sourcePath, {
            includeWal: false,
            immutable: true,
            owner,
          })
        : Effect.fail(error),
    ),
  );
});

/**
 * Place the snapshot on the volume {@link planReadParents} prefers, and where
 * that parent will not take one, fall back to the next candidate. Diversion is
 * an optimization, never a correctness dependency: a read that falls all the way
 * back to the system temp folder is exactly the read this did before placement
 * existed, and the choice is remade from scratch on every read.
 *
 * @see {@link SnapshotParentError} for which failures the fallback answers.
 */
const prepareTempRead = Effect.fnUntraced(function* (
  mode: TempReadMode,
  sourcePath: string,
  options: { includeWal?: boolean; immutable?: boolean; owner?: string } = {},
) {
  const plan = yield* planParents(sourcePath);
  const tryParent = (index: number): Effect.Effect<AcquiredRead, unknown> => {
    const parent = plan.parents[index];
    if (parent === undefined)
      return Effect.fail(
        new Error("No database read snapshot parent was available"),
      );
    return cloneInto(sourcePath, { parent, mode, ...options }).pipe(
      Effect.tap(() =>
        logDebug("Prepared a database read snapshot", {
          parent,
          reason: plan.reason,
          afterFallback: index > 0,
          mode,
        }),
      ),
      Effect.catch((error) =>
        index < plan.parents.length - 1 && error instanceof SnapshotParentError
          ? logDebug("Database read snapshot parent unusable, falling back", {
              error,
              parent,
              reason: plan.reason,
            }).pipe(Effect.andThen(tryParent(index + 1)))
          : Effect.fail(error),
      ),
    );
  };
  return yield* tryParent(0);
});

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

const planParents = Effect.fnUntraced(function* (sourcePath: string) {
  const [tempDevice, databaseDevice] = yield* Effect.all([
    deviceId(tmpdir()),
    deviceId(dirname(sourcePath)),
  ]);
  return planReadParents({
    databasePath: sourcePath,
    tempDevice,
    databaseDevice,
  });
});

/** `0n` — the plan's "unknown" — where the volume cannot be identified. */
const deviceId = Effect.fnUntraced(function* (path: string) {
  return yield* fsCall(() => stat(path, { bigint: true })).pipe(
    Effect.map((stats) => stats.dev),
    Effect.catch((error) =>
      logDebug("Failed to read a volume id", { error, path }).pipe(
        Effect.as(0n),
      ),
    ),
  );
});

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
const cloneInto = Effect.fnUntraced(function* (
  sourcePath: string,
  {
    parent,
    mode,
    includeWal = true,
    immutable = false,
    owner,
  }: {
    parent: string;
    mode: TempReadMode;
    includeWal?: boolean;
    immutable?: boolean;
    owner?: string;
  },
) {
  const attempt = Effect.gen(function* () {
    const dir = yield* createSnapshotDir(parent, owner);
    return yield* cloneAttempt(sourcePath, {
      dir,
      mode,
      includeWal,
      immutable,
    }).pipe(
      Effect.onError(() => removeAttemptDir(dir)),
      Effect.catch((error) =>
        Effect.gen(function* () {
          const cloneUnsupported =
            mode === "reflink" && isNativeCloneCapabilityError(error);
          yield* logDebug("Database read snapshot attempt failed", {
            error,
            mode,
            parent,
            cloneUnsupported,
          });
          if (cloneUnsupported)
            return yield* Effect.fail(new ReflinkUnsupportedError(error));
          if (isParentWriteFailure(error))
            return yield* Effect.fail(new SnapshotParentError(parent, error));
          return yield* Effect.fail(error);
        }),
      ),
    );
  });
  return yield* attempt.pipe(
    Effect.retry({
      schedule: Schedule.spaced(Duration.millis(RETRY_BACKOFF_MS)),
      times: CLONE_ATTEMPTS - 1,
      while: (error) => error instanceof UnstableSnapshotError,
    }),
    Effect.catch((error) =>
      error instanceof UnstableSnapshotError
        ? Effect.fail(
            new Error(
              "Zotero database changed while preparing a read snapshot",
            ),
          )
        : Effect.fail(error),
    ),
  );
});

const cloneAttempt = Effect.fnUntraced(function* (
  sourcePath: string,
  {
    dir,
    mode,
    includeWal,
    immutable,
  }: {
    dir: string;
    mode: TempReadMode;
    includeWal: boolean;
    immutable: boolean;
  },
) {
  const path = join(dir, basename(sourcePath));
  const walPath = `${sourcePath}-wal`;
  const journalPath = `${sourcePath}-journal`;
  const before = yield* snapshotPair(sourcePath, {
    walPath,
    journalPath,
    includeWal,
  });
  const observed = yield* Effect.gen(function* () {
    if (!journalIsSafe(before.journal)) return {};
    yield* Effect.all(
      [
        copySource(mode, sourcePath, path),
        includeWal && before.wal.state !== "absent"
          ? copySource(mode, walPath, `${path}-wal`)
          : Effect.void,
      ],
      { concurrency: "unbounded" },
    );
    const acquired = yield* snapshotPair(path, {
      walPath: `${path}-wal`,
      journalPath: `${path}-journal`,
      includeWal,
    });
    const after = yield* snapshotPair(sourcePath, {
      walPath,
      journalPath,
      includeWal,
    });
    return { acquired, after };
  });
  const matches =
    observed.after !== undefined &&
    observed.acquired !== undefined &&
    sourcePairsEqual(before, observed.after) &&
    sourcePairContentsEqual(before, observed.acquired);
  yield* logDebug("Database read snapshot fingerprint checked", {
    verdict: matches ? "unchanged" : "changed",
    beforeJournalState: before.journal.state,
    beforeWalState: before.wal.state,
    beforeWalSize: walGenerationSize(before.wal),
    acquiredWalState: observed.acquired?.wal.state,
    acquiredWalSize: walGenerationSize(observed.acquired?.wal),
    afterJournalState: observed.after?.journal.state,
    afterWalState: observed.after?.wal.state,
    afterWalSize: walGenerationSize(observed.after?.wal),
  });
  if (!matches) return yield* Effect.fail(new UnstableSnapshotError());
  yield* verifySnapshot(path);
  const uriOptions: SqliteUriOptions = immutable
    ? { mode: "ro", immutable: true }
    : { mode: "ro" };
  return {
    read: {
      path,
      uriOptions,
      effectiveMode: (immutable ? "immutable" : mode) as EffectiveReadMode,
    },
    release: removeReadDir(dir),
  };
});

/**
 * Both steps are destination-only, so a failure here is the parent's and no
 * other candidate's. `mkdir` alone would miss a volume that went read-only
 * after the parent was first created, since a recursive `mkdir` over an
 * existing directory succeeds.
 *
 * @throws {@link SnapshotParentError} always, wrapping the underlying errno.
 */
const createSnapshotDir = Effect.fnUntraced(function* (
  parent: string,
  owner: string | undefined,
) {
  return yield* fsCall(() => mkdir(parent, { recursive: true })).pipe(
    Effect.andThen(
      fsCall(() =>
        mkdtemp(
          join(
            parent,
            `${ZOTERO_DB_READ_TEMP_PREFIX}${process.pid}-${owner ? `${owner}-` : ""}`,
          ),
        ),
      ),
    ),
    Effect.mapError((cause) => new SnapshotParentError(parent, cause)),
  );
});

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

const copySource = Effect.fnUntraced(function* (
  mode: TempReadMode,
  sourcePath: string,
  targetPath: string,
) {
  if (mode === "copy")
    return yield* fsCall(() => copyFile(sourcePath, targetPath)).pipe(
      Effect.asVoid,
    );
  return yield* fsCall(() => reflink(sourcePath, targetPath));
});

/**
 * Fingerprint the complete live source pair. Equal fingerprints identify the
 * same main-file and WAL bytes, including a reused WAL tail whose header and
 * size did not change.
 *
 * @see `sourceMoved` in `layerSource` (zotero-reads/source.ts) for the gate this feeds.
 */
export const snapshotSource = Effect.fnUntraced(function* (sourcePath: string) {
  const pair = yield* snapshotPair(sourcePath, {
    walPath: `${sourcePath}-wal`,
    journalPath: `${sourcePath}-journal`,
  });
  return { path: sourcePath, ...pair };
}, Effect.mapError(toDbUnavailable));

export function sourceFingerprintsEqual(
  a: SourceFingerprint,
  b: SourceFingerprint,
): boolean {
  return a.path === b.path && sourcePairsEqual(a, b);
}

const snapshotPair = Effect.fnUntraced(function* (
  sourcePath: string,
  {
    walPath,
    journalPath,
    includeWal = true,
  }: { walPath: string; journalPath: string; includeWal?: boolean },
) {
  const journalBefore = yield* journalGeneration(journalPath);
  const [main, wal] = yield* Effect.all([
    mainIdentity(sourcePath),
    includeWal
      ? walGeneration(walPath)
      : Effect.succeed({ state: "absent" } as const),
  ]);
  const journalAfter = yield* journalGeneration(journalPath);
  const journal = bracketedJournal(journalBefore, journalAfter);
  return { main, wal, journal };
});

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

const mainIdentity = Effect.fnUntraced(function* (path: string) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const file = yield* openFile(path);
      const before = yield* fileStat(file);
      const digest = yield* fileDigest(file);
      const stats = yield* fileStat(file);
      if (!sameFileState(before, stats))
        return yield* Effect.fail(
          new Error("SQLite database changed while it was fingerprinted"),
        );
      return {
        exists: true,
        dev: stats.dev,
        ino: stats.ino,
        size: stats.size,
        mtimeNs: stats.mtimeNs,
        ctimeNs: stats.ctimeNs,
        digest,
      };
    }),
  ).pipe(
    Effect.catch((error) =>
      isErrno(error, "ENOENT")
        ? Effect.succeed({ exists: false as const })
        : Effect.fail(error),
    ),
  );
});

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
const walGeneration = Effect.fnUntraced(function* (path: string) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const file = yield* openFile(path);
      const before = yield* fileStat(file);
      if (before.size === 0n) {
        const after = yield* fileStat(file);
        return after.size === 0n
          ? { state: "empty" as const }
          : { state: "unstable" as const };
      }

      const header = Buffer.alloc(WAL_HEADER_BYTES);
      const verification = Buffer.alloc(WAL_HEADER_BYTES);
      const firstRead = yield* fileRead(file, header, 0);
      const digest = yield* fileDigest(file);
      const secondRead = yield* fileRead(file, verification, 0);
      const after = yield* fileStat(file);
      if (
        firstRead.bytesRead === WAL_HEADER_BYTES &&
        secondRead.bytesRead === WAL_HEADER_BYTES &&
        sameFileState(before, after) &&
        header.equals(verification)
      ) {
        return {
          state: "present" as const,
          digest,
          header,
          size: after.size,
        };
      }
      return { state: "unstable" as const };
    }),
  ).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        isErrno(error, "ENOENT")
          ? { state: "absent" as const }
          : { state: "unstable" as const },
      ),
    ),
  );
});

function walGenerationsEqual(a: WalGeneration, b: WalGeneration): boolean {
  if (a.state !== b.state || a.state === "unstable") return false;
  if (a.state !== "present" || b.state !== "present") return true;
  return (
    a.size === b.size && a.header.equals(b.header) && a.digest === b.digest
  );
}

const journalGeneration = Effect.fnUntraced(function* (path: string) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const pathBefore = yield* fsCall(() => stat(path, { bigint: true }));
      const file = yield* openFile(path);
      const before = yield* fileStat(file);
      const header = Buffer.alloc(JOURNAL_HEADER_BYTES);
      const verification = Buffer.alloc(JOURNAL_HEADER_BYTES);
      const firstRead = yield* fileRead(file, header, 0);
      const secondRead = yield* fileRead(file, verification, 0);
      const after = yield* fileStat(file);
      const pathAfter = yield* fsCall(() => stat(path, { bigint: true }));
      if (
        !sameFileState(pathBefore, before) ||
        !sameFileState(before, after) ||
        !sameFileState(after, pathAfter) ||
        firstRead.bytesRead !== secondRead.bytesRead ||
        !header.equals(verification)
      ) {
        return { state: "unstable" as const };
      }
      const observedHeader = header.subarray(0, firstRead.bytesRead);
      return {
        state:
          after.size > HOT_JOURNAL_MIN_BYTES &&
          observedHeader.equals(JOURNAL_MAGIC)
            ? ("active" as const)
            : ("inactive" as const),
        dev: after.dev,
        ino: after.ino,
        size: after.size,
        mtimeNs: after.mtimeNs,
        ctimeNs: after.ctimeNs,
        header: observedHeader,
      };
    }),
  ).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        isErrno(error, "ENOENT")
          ? { state: "absent" as const }
          : { state: "unstable" as const },
      ),
    ),
  );
});

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

function openFile(path: string) {
  return Effect.acquireRelease(
    fsCall(() => open(path, "r")),
    (file) =>
      fsCall(() => file.close()).pipe(
        Effect.catch((error) =>
          logWarning("Failed to close a read source file", error, { path }),
        ),
      ),
  );
}

function fileStat(file: FileHandle) {
  return fsCall(() => file.stat({ bigint: true }));
}

function fileRead(file: FileHandle, buffer: Buffer, position: number) {
  return fsCall(() => file.read(buffer, 0, buffer.byteLength, position));
}

const fileDigest = Effect.fnUntraced(function* (file: FileHandle) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
  let position = 0;
  while (true) {
    const { bytesRead } = yield* fileRead(file, buffer, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
});

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

const removeReadDir = Effect.fnUntraced(function* (path: string) {
  yield* fsCall(() => rm(path, { recursive: true, force: true })).pipe(
    Effect.catch((error) =>
      logWarning("Failed to remove database read temp", error, { path }),
    ),
  );
});

const removeAttemptDir = Effect.fnUntraced(function* (path: string) {
  yield* fsCall(() => rm(path, { recursive: true, force: true })).pipe(
    Effect.catch((error) =>
      logWarning("Failed to remove failed database read temp", error, { path }),
    ),
  );
});
