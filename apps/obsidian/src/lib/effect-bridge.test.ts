import { expect } from "vitest";

import { Cause, Effect, Exit, Ref, Schema, Scope, Stream } from "@/lib/effect";
import { it } from "@/lib/effect-vitest";

import { openTestBridge } from "./__fixtures__/effect-bridge";
import { scopedBridge } from "./effect-bridge";

class BridgeError extends Schema.TaggedError<
  BridgeError,
  { readonly brand: unique symbol }
>()("BridgeError", { message: Schema.String }) {}

it.effect("runSync returns the value of a synchronous Effect", () =>
  Effect.promise(async () => {
    await using bridge = openTestBridge();
    expect(bridge.runSync(Effect.succeed(42))).toBe(42);
  }),
);

it.effect("runPromise rejects with the Effect failure", () =>
  Effect.promise(async () => {
    await using bridge = openTestBridge();
    const error = new BridgeError({ message: "failed" });
    await expect(bridge.runPromise(Effect.fail(error))).rejects.toBe(error);
  }),
);

it.effect("runPromiseExit resolves with a failure Exit", () =>
  Effect.promise(async () => {
    await using bridge = openTestBridge();
    const error = new BridgeError({ message: "failed" });
    const exit = await bridge.runPromiseExit(Effect.fail(error));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(error);
  }),
);

it.effect("the captured context survives runtime disposal", () =>
  Effect.promise(async () => {
    await using bridge = openTestBridge();
    const value = bridge.runSync(Ref.make(1));
    await bridge[Symbol.asyncDispose]();
    expect(bridge.closed()).toBe(true);
    expect(bridge.runSync(Ref.get(value))).toBe(1);

    const received: number[] = [];
    const unsubscribe = bridge.subscribe(Stream.make(1, 2, 3), (next) =>
      received.push(next),
    );
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
    expect(received).toEqual([]);
  }),
);

it.effect("subscribe receives each stream element in order", () =>
  Effect.promise(async () => {
    await using bridge = openTestBridge();
    const received: number[] = [];
    const unsubscribe = bridge.subscribe(Stream.make(1, 2, 3), (next) =>
      received.push(next),
    );
    expect(received).toEqual([1, 2, 3]);
    unsubscribe();
  }),
);

// Failure mode: a layer's plain code keeps receiving elements, or reads as
// open, after the layer's Scope closed.
it.effect("a scoped bridge closes with its Scope", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const bridge = yield* scopedBridge.pipe(Scope.provide(scope));
    const received: number[] = [];
    bridge.subscribe(Stream.make(1, 2), (next) => received.push(next));
    expect(received).toEqual([1, 2]);
    expect(bridge.closed()).toBe(false);
    yield* Scope.close(scope, Exit.void);
    expect(bridge.closed()).toBe(true);
    bridge.subscribe(Stream.make(3), (next) => received.push(next));
    expect(received).toEqual([1, 2]);
  }),
);
