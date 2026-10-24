// What counts as a stale database read clone, next to the code that makes one.

import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ZOTERO_DB_READ_TEMP_PREFIX } from "@/lib/constants";
import { Cause, Effect } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log-category";
import { isErrno } from "@/lib/errno";
import type { ReapTempsOptions } from "@/lib/temp-sweep";

const logDebug = (message: string, annotations: Record<string, unknown>) =>
  Effect.logDebug(message).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("temp-sweep"),
  );

const logWarning = (
  message: string,
  error: unknown,
  annotations: Record<string, unknown>,
) =>
  Effect.logWarning(message, Cause.fail(error)).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("temp-sweep"),
  );

/**
 * Remove clone temp dirs left behind by crashed runs. Each dir is tagged with
 * its owner PID by `prepareRead`, and its owner disposes it at the end of the
 * read, so a dir tagged with a dead PID is the residue of a crash. Dirs
 * owned by this process or by any still-live process are kept, so a
 * concurrently-running Obsidian never has its active clones reaped.
 */
export const reapReadClonesEffect = Effect.fnUntraced(function* ({
  signal,
  parent = tmpdir(),
}: ReapTempsOptions = {}) {
  yield* sweep({
    directory: parent,
    kind: "database read clone",
    signal,
    isResidue: (name) => {
      const pid = parseTempPid(name);
      return pid !== null && pid !== process.pid && !isPidLive(pid);
    },
  });
});

/** Run the launch sweep through the existing Promise-shaped lifecycle call. */
export function reapReadClones(options: ReapTempsOptions = {}): Promise<void> {
  return Effect.runPromise(reapReadClonesEffect(options));
}

/**
 * Remove the clone temp dirs a database worker left behind, once that worker
 * is gone. A dir carries its worker's owner tag after the PID (see
 * `prepareRead`), and every worker of this process shares the PID, so the tag
 * alone tells a dead worker's residue from the clone a live worker reads.
 * Dirs without that tag are kept for {@link reapReadClonesEffect} at the next launch.
 */
export const reapWorkerClones = Effect.fnUntraced(function* ({
  owner,
  parents,
}: {
  /** The tag the gone worker named its clones with. */
  owner: string;
  /** Every directory that worker may have placed a clone in. */
  parents: readonly string[];
}) {
  yield* Effect.all(
    parents.map((directory) =>
      sweep({
        directory,
        kind: "database read clone",
        isResidue: (name) => parseTempOwner(name) === owner,
      }),
    ),
    { concurrency: "unbounded" },
  );
});

function sweep({
  directory,
  kind,
  isResidue,
  signal,
}: {
  directory: string;
  kind: string;
  isResidue: (name: string, path: string) => boolean;
  signal?: AbortSignal;
}) {
  return Effect.gen(function* () {
    if (!(yield* canContinue(signal))) return;
    const result = yield* Effect.result(fsCall(() => readdir(directory)));
    if (result._tag === "Failure") {
      if (signal?.aborted || isErrno(result.failure, "ENOENT")) return;
      yield* logWarning(
        "Failed to sweep a ZotLit temp directory",
        result.failure,
        {
          directory,
          kind,
        },
      );
      return;
    }

    for (const name of result.success) {
      if (!(yield* canContinue(signal))) return;
      const path = join(directory, name);
      if (!isResidue(name, path)) continue;
      yield* remove(path, kind);
    }
  });
}

function canContinue(signal: AbortSignal | undefined) {
  return Effect.result(
    Effect.try({
      // boundary: AbortSignal is the API callers use to cancel a launch sweep.
      try: () => {
        signal?.throwIfAborted();
      },
      catch: (error) => error,
    }),
  ).pipe(Effect.map((result) => result._tag === "Success"));
}

function remove(path: string, kind: string) {
  return Effect.result(
    fsCall(() => rm(path, { recursive: true, force: true })),
  ).pipe(
    Effect.flatMap((result) =>
      result._tag === "Success"
        ? logDebug("Reaped a stale ZotLit temp entry", { path, kind })
        : logWarning(
            "Failed to reap a stale ZotLit temp entry",
            result.failure,
            {
              path,
              kind,
            },
          ),
    ),
  );
}

function fsCall<A>(run: () => Promise<A>): Effect.Effect<A, unknown> {
  // boundary: node:fs/promises is Promise-based; wrap each call once.
  return Effect.tryPromise({ try: run, catch: (error) => error });
}

/** The owner tag after the PID, or `null` for a dir that carries none. */
function parseTempOwner(entry: string): string | null {
  if (parseTempPid(entry) === null) return null;
  const rest = entry.slice(ZOTERO_DB_READ_TEMP_PREFIX.length);
  const tagged = rest.slice(rest.indexOf("-") + 1);
  const end = tagged.indexOf("-");
  return end > 0 ? tagged.slice(0, end) : null;
}

function parseTempPid(entry: string): number | null {
  if (!entry.startsWith(ZOTERO_DB_READ_TEMP_PREFIX)) return null;
  const rest = entry.slice(ZOTERO_DB_READ_TEMP_PREFIX.length);
  const end = rest.indexOf("-");
  if (end <= 0) return null;
  const pid = Number(rest.slice(0, end));
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function isPidLive(pid: number): boolean {
  // boundary: process.kill is synchronous and the sweep predicate is synchronous.
  return Effect.runSync(
    Effect.try({
      try: () => {
        process.kill(pid, 0);
      },
      catch: (error) => error,
    }).pipe(
      Effect.match({
        onSuccess: () => true,
        // EPERM means the PID exists but is owned by another user — still live.
        onFailure: (error) => isErrno(error, "EPERM"),
      }),
    ),
  );
}
