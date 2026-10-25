import { it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { expect } from "vitest";

import { buildRuntime } from "@/lib/effect-layer";

import { ServiceStartupFailed, startingAs } from "./startup-failure";

class Base extends Context.Service<Base, { readonly value: number }>()(
  "zotlit/test/Base",
) {}
class Dependent extends Context.Service<
  Dependent,
  { readonly value: number }
>()("zotlit/test/Dependent") {}

/** A layer that holds a resource until its scope closes. */
const holding = (released: string[]) =>
  Layer.effect(
    Base,
    Effect.acquireRelease(Effect.succeed(Base.of({ value: 1 })), () =>
      Effect.sync(() => released.push("Base")),
    ),
  ).pipe(startingAs("Base"));

const dying = Layer.effect(
  Dependent,
  Effect.gen(function* () {
    yield* Base;
    return yield* Effect.die(new Error("bug in acquisition"));
  }),
).pipe(startingAs("Dependent"));

// Failure modes: the failure names the wrong service or none, an outer layer
// renames it, or what started before the failure stays open.
it.effect(
  "names the service whose acquisition died and releases what started",
  () =>
    Effect.promise(async () => {
      const released: string[] = [];
      const stack = new AsyncDisposableStack();
      const runtime = buildRuntime(
        dying.pipe(Layer.provideMerge(holding(released)), startingAs("Graph")),
        stack,
      );
      const error = await runtime.context().catch((error: unknown) => error);
      expect(error).toBeInstanceOf(ServiceStartupFailed);
      expect((error as ServiceStartupFailed).service).toBe("Dependent");
      await stack.disposeAsync();
      expect(released).toEqual(["Base"]);
    }),
);

it.effect("leaves a graph that starts untouched", () =>
  Effect.promise(async () => {
    await using stack = new AsyncDisposableStack();
    const runtime = buildRuntime(holding([]), stack);
    expect(runtime.runSync(Base).value).toBe(1);
  }),
);
