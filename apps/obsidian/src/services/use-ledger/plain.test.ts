import { it } from "@effect/vitest";
import { Stream } from "effect";
import { Effect } from "effect";
import { expect } from "vitest";

import { subscribe } from "@/lib/effect-stream";

import { buildUseLedger, fakeApp } from "./__fixtures__";
import type { Ledger } from "./service";

// #1705: a throwing subscriber stays registered and sees both immediate Uses.
it.effect("keeps a throwing listener subscribed for later Uses", () =>
  Effect.gen(function* () {
    const stack = yield* Effect.acquireDisposable(
      Effect.tryPromise(async () => new AsyncDisposableStack()),
    );
    const ledger = buildUseLedger(fakeApp({ load: () => undefined }), stack);
    const received: Ledger[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    stack.defer(
      subscribe(ledger.runtime, Stream.drop(ledger.changes, 1), (next) => {
        received.push(next);
        if (received.length === 1) throw new Error("listener failed");
        if ("AAAAAAAC" in next) resolve();
      }),
    );

    ledger.record("AAAAAAAB", "opened");
    ledger.record("AAAAAAAC", "opened");
    yield* Effect.promise(() => promise);

    expect(received.map((next) => Object.keys(next).sort())).toEqual([
      ["AAAAAAAB"],
      ["AAAAAAAB", "AAAAAAAC"],
    ]);
    const last = ledger.current;
    yield* Effect.promise(() => stack.disposeAsync());
    expect(ledger.current).toBe(last);
    expect(ledger.get("AAAAAAAB")).toBe(last.AAAAAAAB);
    expect(Object.keys(ledger.uses).sort()).toEqual(["AAAAAAAB", "AAAAAAAC"]);
    ledger.record("AAAAAAAD", "opened");
    expect(ledger.current).toBe(last);
    expect(() =>
      subscribe(ledger.runtime, Stream.drop(ledger.changes, 1), () => {
        throw new Error("closed listener");
      })(),
    ).not.toThrow();
  }),
);
