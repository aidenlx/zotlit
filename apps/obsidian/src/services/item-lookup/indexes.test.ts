import { EventEmitter } from "node:events";
import { expect, it } from "vitest";

import { createLanguageLookup } from "@zotlit/db";

import { LookupIndexes } from "./indexes";

// The transport can die before readiness or after a request was sent. Both
// waiters must reject, and disposal must still finish after the exit.
it.each(["startup", "request"] as const)(
  "rejects a process exit during %s",
  async (phase) => {
    const sent = Promise.withResolvers<void>();
    const worker = Object.assign(new EventEmitter(), {
      postMessage(_message: string) {
        sent.resolve();
      },
      terminate: async () => {},
    });
    await using indexes = new LookupIndexes(worker);
    const rejected = expect(
      indexes.createBuilder({
        libraries: [1],
        locale: "en",
        languageLookup: createLanguageLookup("en"),
        tokenizer: { intl: new Intl.Segmenter("en", { granularity: "word" }) },
      }),
    ).rejects.toThrow("Item Lookup process exited (1)");
    if (phase === "request") {
      worker.emit("message", JSON.stringify({ type: "ready" }));
      await sent.promise;
    }
    worker.emit("exit", 1);
    await rejected;
  },
);
