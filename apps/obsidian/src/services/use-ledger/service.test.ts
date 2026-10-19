import type { App } from "obsidian";
import { expect, it } from "vitest";

import { UseLedger } from "./service";

// Failure modes: the cap drops a recently used Item, an update consumes a
// second slot, or reloading restores entries already dropped by the cap.
it("keeps the 300 most recently used Items across reloads", async () => {
  let stored: unknown;
  const app = {
    loadLocalStorage: () => stored,
    saveLocalStorage: (_key: string, value: unknown) => {
      stored = structuredClone(value);
    },
    workspace: {
      onLayoutReady: () => {},
      on: () => ({ e: { offref: () => {} } }),
    },
    metadataCache: { on: () => ({ e: { offref: () => {} } }) },
  } as unknown as App;
  let epoch = 1;
  const ledger = new UseLedger({
    app,
    now: () => Temporal.Instant.fromEpochMilliseconds(epoch++),
  });
  await ledger.ready;
  for (let item = 0; item < 300; item++)
    ledger.record(
      item
        .toString(6)
        .split("")
        .map((digit) => "ABCDEF"[Number(digit)])
        .join("")
        .padStart(8, "A"),
      "opened",
    );
  ledger.record("AAAAAAAA", "opened");
  ledger.record("NEWKEYZZ", "opened");
  expect(Object.keys(ledger.current)).toHaveLength(300);
  expect(ledger.get("AAAAAAAB")).toBeUndefined();
  expect(ledger.get("AAAAAAAA")?.instant.epochMilliseconds).toBe(301);
  expect(ledger.get("NEWKEYZZ")?.instant.epochMilliseconds).toBe(302);
  await ledger[Symbol.asyncDispose]();
  await using reloaded = new UseLedger({ app });
  await reloaded.ready;
  expect(Object.keys(reloaded.current)).toHaveLength(300);
  expect(reloaded.get("AAAAAAAB")).toBeUndefined();
  expect(reloaded.get("AAAAAAAA")?.instant.epochMilliseconds).toBe(301);
});
