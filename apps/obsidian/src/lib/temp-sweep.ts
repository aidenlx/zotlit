// Walks one temp directory and removes the entries a caller calls residue.
//
// Owns the mechanics every sweep repeats — the walk, the removal, and the
// logging — and nothing about what counts as residue. Each
// producer of temp entries keeps that rule in its own `reap-temps.ts`, next to
// the code that writes the entries the rule recognizes.
//
// The sweep is an Effect so the database reads worker, which carries no
// LogTape, runs the same walk the renderer does.
//
// A sweep never fails on the filesystem: a directory that refuses to be
// listed or emptied is a logged warning, never a failed launch. Interrupting
// the sweep stops the walk and logs nothing; the Promise calls take a signal
// that interrupts it and reject with its reason.

// The worker build resolves the specifier `effect` to the worker entry, so a
// relative import of a wrapper here would pull the renderer's LogTape bridge
// into the worker.
import { Cause, Effect } from "effect";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { withLogCategory } from "./effect-log-category";
import { isErrno, systemCallError } from "./errno";
import type { SystemCallError } from "./errno";
import { settleAtEdge } from "./signal-edge";

/** What every reap step accepts, so one startup passes the same thing to each. */
export interface ReapTempsOptions {
  /**
   * The directory the producer writes into.
   *
   * @default tmpdir()
   */
  parent?: string;
}

export interface TempSweepOptions {
  /** The directory to walk. Absent is the normal state before a first run. */
  directory: string;
  /** Names the swept entry in logs, e.g. `"database read clone"`. */
  kind: string;
  /** Whether this entry is residue no run still needs. */
  isResidue: (name: string, path: string) => Promise<boolean> | boolean;
}

/** The options of a reap step that is a Promise; the signal interrupts it. */
export interface PlainReapTempsOptions extends ReapTempsOptions {
  signal?: AbortSignal;
}

export const sweepTempDirectoryEffect = Effect.fnUntraced(function* ({
  directory,
  kind,
  isResidue,
}: TempSweepOptions) {
  const walked = yield* Effect.result(
    Effect.gen(function* () {
      const names = yield* fsCall(() => readdir(directory));
      for (const name of names) {
        const path = join(directory, name);
        if (yield* fsCall(async () => isResidue(name, path))) {
          yield* remove(path, kind);
        }
      }
    }),
  );
  if (walked._tag === "Success") return;
  if (isErrno(walked.failure, "ENOENT")) return;
  yield* Effect.logWarning(
    "Failed to sweep a ZotLit temp directory",
    Cause.fail(walked.failure),
  ).pipe(
    Effect.annotateLogs({ directory, kind }),
    withLogCategory("temp-sweep"),
  );
});

/**
 * The Promise-shaped call for lifecycle code that is not an Effect. An abort of
 * `signal` interrupts the sweep, which then rejects with the signal's reason
 * and logs nothing.
 */
export async function sweepTempDirectory(
  options: TempSweepOptions,
  signal?: AbortSignal,
): Promise<void> {
  const exit = await Effect.runPromiseExit(
    sweepTempDirectoryEffect(options),
    signal === undefined ? undefined : { signal },
  );
  settleAtEdge(exit, signal);
}

function remove(path: string, kind: string) {
  return fsCall(() => rm(path, { recursive: true, force: true })).pipe(
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

function fsCall<A>(run: () => Promise<A>): Effect.Effect<A, SystemCallError> {
  // boundary: node:fs/promises and the residue rule are Promise-based.
  return Effect.tryPromise({ try: run, catch: systemCallError });
}
