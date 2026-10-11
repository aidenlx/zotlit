import { DatabaseSync } from "node:sqlite";

// A separate SQLite handle checks the owned clone before it can serve reads.
// Node worker_threads are unavailable in Electron's Node-integrated workers.
const workerSource = `
  const { DatabaseSync } = require("node:sqlite");
  self.onmessage = ({ data: path }) => {
    const sqlite = new DatabaseSync(path, { readOnly: true, timeout: 1000 });
    let result;
    try {
      result = sqlite.prepare("PRAGMA integrity_check").get();
    } finally {
      sqlite.close();
    }
    self.postMessage(result?.integrity_check);
  };
`;

/** Structural check only; source equality and SQLite's WAL commit markers prove state. */
export async function verifySnapshot(path: string): Promise<void> {
  let result: unknown;
  if (typeof Worker === "undefined") {
    // The in-process Node adapter has no Web Worker transport.
    using sqlite = new DatabaseSync(path, { readOnly: true, timeout: 1_000 });
    result = sqlite.prepare("PRAGMA integrity_check").get()?.integrity_check;
  } else {
    using cleanup = new DisposableStack();
    const url = cleanup.adopt(
      URL.createObjectURL(
        new Blob([workerSource], { type: "text/javascript" }),
      ),
      (url) => URL.revokeObjectURL(url),
    );
    const worker = cleanup.adopt(
      new Worker(url, { name: "zotlit-snapshot-integrity" }),
      (worker) => worker.terminate(),
    );
    const reply = Promise.withResolvers<unknown>();
    worker.onmessage = (event) => reply.resolve(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      reply.reject(new Error(event.message));
    };
    worker.onmessageerror = () =>
      reply.reject(new Error("Invalid database snapshot verification reply"));
    cleanup.adopt(
      setTimeout(
        () =>
          reply.reject(new Error("Database snapshot verification timed out")),
        60_000,
      ),
      clearTimeout,
    );
    worker.postMessage(path);
    result = await reply.promise;
  }
  if (result !== "ok")
    throw new Error("SQLite rejected the database read snapshot");
}
