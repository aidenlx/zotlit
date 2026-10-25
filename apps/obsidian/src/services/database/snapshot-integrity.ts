import { Effect } from "effect";
import { DatabaseSync } from "node:sqlite";

import { DbUnavailable } from "@/services/zotero-reads/rpc";

// A separate SQLite handle checks the owned clone before it can serve reads.
// Node worker_threads are unavailable in Electron's Node-integrated workers.
// boundary: generated Web Worker code owns its message loop and SQLite handle.
const workerSource = `
  const { DatabaseSync } = require("node:sqlite");
  self.onmessage = ({ data: path }) => {
    using sqlite = new DatabaseSync(path, { readOnly: true, timeout: 1000 });
    const result = sqlite.prepare("PRAGMA integrity_check").get();
    self.postMessage(result?.integrity_check);
  };
`;

const timeoutFailure = () =>
  new DbUnavailable({
    message: "Database snapshot verification timed out",
  });

/** Structural check only; source equality and SQLite's WAL commit markers prove state. */
export const verifySnapshot = Effect.fnUntraced(function* (
  path: string,
): Effect.fn.Return<void, DbUnavailable> {
  const result =
    typeof Worker === "undefined"
      ? yield* verifyInProcess(path)
      : yield* verifyInWorker(path);
  if (result !== "ok")
    return yield* Effect.fail(
      new DbUnavailable({
        message: "SQLite rejected the database read snapshot",
      }),
    );
});

function verifyInProcess(path: string) {
  // boundary: node:sqlite is synchronous; run it once at the port.
  return Effect.try({
    try: () => {
      using sqlite = new DatabaseSync(path, {
        readOnly: true,
        timeout: 1_000,
      });
      return sqlite.prepare("PRAGMA integrity_check").get()?.integrity_check;
    },
    catch: (error) =>
      new DbUnavailable({
        message: error instanceof Error ? error.message : String(error),
      }),
  });
}

const verifyInWorker = Effect.fnUntraced(function* (
  path: string,
): Effect.fn.Return<unknown, DbUnavailable> {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const url = yield* Effect.acquireRelease(
        Effect.sync(() =>
          URL.createObjectURL(
            new Blob([workerSource], {
              type: "text/javascript",
            }),
          ),
        ),
        (url) => Effect.sync(() => URL.revokeObjectURL(url)),
      );
      // boundary: Electron provides Worker as a browser-style event source.
      const worker = yield* Effect.acquireRelease(
        Effect.try({
          try: () => new Worker(url, { name: "zotlit-snapshot-integrity" }),
          catch: (error) =>
            new DbUnavailable({
              message: error instanceof Error ? error.message : String(error),
            }),
        }),
        (worker) => Effect.sync(() => worker.terminate()),
      );
      return yield* receiveWorkerReply(worker, path).pipe(
        Effect.timeoutOrElse({
          duration: "60 seconds",
          orElse: () => Effect.fail(timeoutFailure()),
        }),
      );
    }),
  );
});

function receiveWorkerReply(worker: Worker, path: string) {
  const clearListeners = () => {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
  };
  // boundary: Worker replies and failures arrive through DOM event callbacks.
  return Effect.callback<unknown, DbUnavailable>((resume) => {
    worker.onmessage = (event) => resume(Effect.succeed(event.data as unknown));
    worker.onerror = (event) => {
      event.preventDefault();
      resume(
        Effect.fail(
          new DbUnavailable({
            message: event.message,
          }),
        ),
      );
    };
    worker.onmessageerror = () =>
      resume(
        Effect.fail(
          new DbUnavailable({
            message: "Invalid database snapshot verification reply",
          }),
        ),
      );
    // boundary: MessagePort.postMessage may throw synchronously.
    try {
      worker.postMessage(path);
    } catch (error) {
      resume(
        Effect.fail(
          new DbUnavailable({
            message: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
    }
    return Effect.sync(clearListeners);
  }).pipe(Effect.ensuring(Effect.sync(clearListeners)));
}
