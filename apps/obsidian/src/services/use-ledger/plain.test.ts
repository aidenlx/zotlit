import { expect } from "vitest";

import { Effect } from "@/lib/effect";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";

import { buildUseLedger, fakeApp } from "./__fixtures__";
import type { Ledger } from "./service";

// #1705: a throwing subscriber stays registered and sees both immediate Uses.
it.effect("keeps a throwing listener subscribed for later Uses", () =>
  Effect.gen(function* () {
    const stack = yield* acquireAsyncDisposable(
      async () => new AsyncDisposableStack(),
    );
    const ledger = buildUseLedger(fakeApp({ load: () => undefined }), stack);
    ledger.record("AAAAAAAA", "opened");
    const received: Ledger[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    stack.defer(
      ledger.subscribe((next) => {
        received.push(next);
        if (received.length === 1) throw new Error("listener failed");
        if ("AAAAAAAC" in next) resolve();
      }),
    );

    ledger.record("AAAAAAAB", "opened");
    ledger.record("AAAAAAAC", "opened");
    yield* Effect.promise(() => promise);

    expect(received.map((next) => Object.keys(next).sort())).toEqual([
      ["AAAAAAAA", "AAAAAAAB"],
      ["AAAAAAAA", "AAAAAAAB", "AAAAAAAC"],
    ]);
    yield* Effect.promise(() => stack.disposeAsync());
    expect(() =>
      ledger.subscribe(() => {
        throw new Error("closed listener");
      })(),
    ).not.toThrow();
  }),
);
