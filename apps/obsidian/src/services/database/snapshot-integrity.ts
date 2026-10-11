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
    const url = URL.createObjectURL(
      new Blob([workerSource], { type: "text/javascript" }),
    );
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      worker = new Worker(url, { name: "zotlit-snapshot-integrity" });
      const reply = Promise.withResolvers<unknown>();
      worker.onmessage = (event) => reply.resolve(event.data);
      worker.onerror = (event) => {
        event.preventDefault();
        reply.reject(new Error(event.message));
      };
      worker.onmessageerror = () =>
        reply.reject(new Error("Invalid database snapshot verification reply"));
      timer = setTimeout(
        () =>
          reply.reject(new Error("Database snapshot verification timed out")),
        60_000,
      );
      worker.postMessage(path);
      result = await reply.promise;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      worker?.terminate();
      URL.revokeObjectURL(url);
    }
  }
  if (result !== "ok")
    throw new Error("SQLite rejected the database read snapshot");
}
