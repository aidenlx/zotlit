// Walks one temp directory and removes the entries a caller calls residue.
//
// Owns the mechanics every sweep repeats — the walk, the removal, and the
// logging — and nothing about what counts as residue. Each
// producer of temp entries keeps that rule in its own `reap-temps.ts`, next to
// the code that writes the entries the rule recognizes.
//
// The sweep is an Effect over `FileSystem`, so the database reads worker,
// which carries no LogTape, runs the same walk the renderer does. Each runtime
// provides the Node file system once.
//
// A sweep never fails on the filesystem: a directory that refuses to be
// listed, or an entry that refuses to be checked or removed, is a logged
// warning, never a failed launch. Interrupting the sweep stops the walk and
// logs nothing.

// The worker build resolves the specifier `effect` to the worker entry, so a
// relative import of a wrapper here would pull the renderer's LogTape bridge
// into the worker.
import { Cause, Clock, Duration, Effect, FileSystem, Option } from "effect";
import type { PlatformError } from "effect";
import { join } from "node:path";

import { withLogCategory } from "./effect-log-category";

/** What every reap step accepts, so one startup passes the same thing to each. */
export interface ReapTempsOptions {
  /**
   * The directory the producer writes into.
   *
   * @default tmpdir()
   */
  parent?: string;
}

export interface TempSweepOptions<R> {
  /** The directory to walk. Absent is the normal state before a first run. */
  directory: string;
  /** Names the swept entry in logs, e.g. `"database read clone"`. */
  kind: string;
  /** Whether this entry is residue no run still needs. */
  isResidue: (
    name: string,
    path: string,
  ) => Effect.Effect<boolean, PlatformError.PlatformError, R>;
}

export const sweepTempDirectory = Effect.fnUntraced(function* <R>({
  directory,
  kind,
  isResidue,
}: TempSweepOptions<R>) {
  const fs = yield* FileSystem.FileSystem;
  const names = yield* fs.readDirectory(directory).pipe(
    Effect.catchReason("PlatformError", "NotFound", () =>
      Effect.succeed<string[]>([]),
    ),
    Effect.catch((error) =>
      Effect.logWarning(
        "Failed to sweep a ZotLit temp directory",
        Cause.fail(error),
      ).pipe(
        Effect.annotateLogs({ directory, kind }),
        withLogCategory("temp-sweep"),
        Effect.as<string[]>([]),
      ),
    ),
  );
  for (const name of names) {
    const path = join(directory, name);
    yield* isResidue(name, path).pipe(
      Effect.matchEffect({
        onSuccess: (residue) =>
          residue ? remove(fs, path, kind) : Effect.void,
        onFailure: (error) =>
          Effect.logWarning(
            "Failed to check a ZotLit temp entry",
            Cause.fail(error),
          ).pipe(
            Effect.annotateLogs({ path, kind }),
            withLogCategory("temp-sweep"),
          ),
      }),
    );
  }
});

/**
 * Whether the entry at `path` was last modified more than `maxAge` before the
 * Clock's now. An entry that vanished under the walk, or that reports no
 * modification time, is not older than anything.
 */
export const isOlderThan = Effect.fnUntraced(function* (
  path: string,
  maxAge: Duration.Duration,
) {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(path).pipe(
    Effect.asSome,
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
  );
  const mtime = Option.flatMap(info, ({ mtime }) => mtime);
  if (Option.isNone(mtime)) return false;
  const now = yield* Clock.currentTimeMillis;
  return Duration.isGreaterThan(
    Duration.millis(now - mtime.value.getTime()),
    maxAge,
  );
});

function remove(fs: FileSystem.FileSystem, path: string, kind: string) {
  return fs.remove(path, { recursive: true, force: true }).pipe(
    Effect.matchEffect({
      onSuccess: () =>
        Effect.logDebug("Reaped a stale ZotLit temp entry").pipe(
          Effect.annotateLogs({ path, kind }),
          withLogCategory("temp-sweep"),
        ),
      onFailure: (error) =>
        Effect.logWarning(
          "Failed to reap a stale ZotLit temp entry",
          Cause.fail(error),
        ).pipe(
          Effect.annotateLogs({ path, kind }),
          withLogCategory("temp-sweep"),
        ),
    }),
  );
}
