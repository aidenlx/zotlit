// Command ownership at the Promise boundary shared with @zotlit/workbench.
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import { layerUnreadViewServices } from "@/lib/__fixtures__/view-atoms";
import { AbortError } from "@/lib/abort-error";
import { makeViewRegistry } from "@/lib/view-atoms";
import { waitFor } from "@/views/template-data-explorer/__fixtures__";

import { makeWorkbenchCommand } from "./command";

// #1819: concurrent reads must stop at close, before the registry's idle expiry.
it.effect.each(["leaf", "plugin"] as const)(
  "cancels every concurrent read when its %s closes",
  (owner) =>
    Effect.gen(function* () {
      const context = yield* Layer.build(
        Layer.mergeAll(layerUnreadViewServices, layerHost()),
      );
      const registry = yield* Effect.acquireRelease(
        Effect.sync(() => makeViewRegistry(context)),
        (value) => Effect.sync(() => value.dispose()),
      );
      const complete = new Map<string, () => void>();
      const cancelled: string[] = [];
      const released: string[] = [];
      const command = makeWorkbenchCommand(
        registry,
        (key: string) =>
          Effect.scoped(
            Effect.gen(function* () {
              yield* Effect.acquireRelease(Effect.void, () =>
                Effect.sync(() => released.push(key)),
              );
              return yield* Effect.callback<string>((resume) => {
                complete.set(key, () => resume(Effect.succeed(key)));
                return Effect.sync(() => cancelled.push(key));
              });
            }),
          ),
        { concurrent: true },
      );
      const first = command.run("first").catch((error: unknown) => error);
      const second = command.run("second").catch((error: unknown) => error);
      yield* Effect.promise(() => waitFor(() => expect(complete.size).toBe(2)));
      if (owner === "leaf") command[Symbol.dispose]();
      else registry.dispose();
      complete.get("first")!();
      complete.get("second")!();
      const results = yield* Effect.promise(() => Promise.all([first, second]));
      expect(results[0]).toBeInstanceOf(AbortError);
      expect(results[1]).toBeInstanceOf(AbortError);
      expect(cancelled.sort()).toEqual(["first", "second"]);
      expect(released.sort()).toEqual(["first", "second"]);
    }),
);

it.effect.each([false, true])(
  "preserves request replacement with concurrent=%s",
  (concurrent) =>
    Effect.gen(function* () {
      const context = yield* Layer.build(
        Layer.mergeAll(layerUnreadViewServices, layerHost()),
      );
      const registry = yield* Effect.acquireRelease(
        Effect.sync(() => makeViewRegistry(context)),
        (value) => Effect.sync(() => value.dispose()),
      );
      const complete = new Map<string, () => void>();
      const command = makeWorkbenchCommand(
        registry,
        (key: string) =>
          Effect.callback<string>((resume) => {
            complete.set(key, () => resume(Effect.succeed(key)));
          }),
        { concurrent },
      );
      const first = command.run("first").catch((error: unknown) => error);
      const second = command.run("second");
      yield* Effect.promise(() => waitFor(() => expect(complete.size).toBe(2)));
      complete.get("second")!();
      expect(yield* Effect.promise(() => second)).toBe("second");
      complete.get("first")!();
      const result = yield* Effect.promise(() => first);
      expect(result).toEqual(concurrent ? "first" : expect.any(AbortError));
      command[Symbol.dispose]();
    }),
);

it.effect("rejects a concurrent command closed in the gesture's turn", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      Layer.mergeAll(layerUnreadViewServices, layerHost()),
    );
    const registry = yield* Effect.acquireRelease(
      Effect.sync(() => makeViewRegistry(context)),
      (value) => Effect.sync(() => value.dispose()),
    );
    const command = makeWorkbenchCommand(registry, () => Effect.never, {
      concurrent: true,
    });
    const result = command.run(undefined).catch((error: unknown) => error);
    command[Symbol.dispose]();
    expect(yield* Effect.promise(() => result)).toBeInstanceOf(AbortError);
  }),
);
