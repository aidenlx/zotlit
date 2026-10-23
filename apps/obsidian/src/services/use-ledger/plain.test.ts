import { expect, it } from "vitest";

import { buildUseLedger, fakeApp } from "./__fixtures__";
import type { Ledger } from "./service";

// Failure modes: a subscriber is told of the ledger it already had, or misses
// a Use recorded after it subscribed.
it("tells a subscriber of each Use recorded after it subscribes", async () => {
  await using stack = new AsyncDisposableStack();
  const ledger = buildUseLedger(fakeApp({ load: () => undefined }), stack);
  ledger.record("AAAAAAAA", "opened");
  const received: Ledger[] = [];
  const { promise, resolve } = Promise.withResolvers<void>();
  stack.defer(
    ledger.subscribe((next) => {
      received.push(next);
      if ("AAAAAAAB" in next) resolve();
    }),
  );

  ledger.record("AAAAAAAB", "opened");
  await promise;

  expect(received.map((next) => Object.keys(next).sort())).toEqual([
    ["AAAAAAAA", "AAAAAAAB"],
  ]);
});
