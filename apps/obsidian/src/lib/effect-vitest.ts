// Obsidian's @effect/vitest: each Effect test runs with the services the
// plugin's Effect entry points add, beside the test services. The effectEntry
// Vite plugin (scripts/effect-entry.ts) resolves `@effect/vitest` to it in tests.
import * as Vitest from "@effect/vitest";
import * as NativeEffect from "effect/Effect";

import { runtimeServices } from "./effect-services";

export * from "@effect/vitest";

type Body = (...args: unknown[]) => NativeEffect.Effect<unknown, unknown>;
type Test = (name: string, self: Body, timeout?: unknown) => void;
type Describe = (...args: unknown[]) => void;

const provide =
  (self: Body): Body =>
  (...args) =>
    NativeEffect.provideContext(self(...args), runtimeServices);

/** `base` with every Effect body it runs given the runtime services. */
function tester<T>(base: T): T {
  const t = base as Test & Record<string, (...args: unknown[]) => unknown>;
  const run =
    (test: Test): Test =>
    (name, self, timeout) =>
      test(name, provide(self), timeout);
  return Object.assign(run(t), {
    skip: run(t["skip"] as Test),
    only: run(t["only"] as Test),
    fails: run(t["fails"] as Test),
    skipIf: (condition: unknown) => run(t["skipIf"]!(condition) as Test),
    runIf: (condition: unknown) => run(t["runIf"]!(condition) as Test),
    each: (cases: unknown) => run(t["each"]!(cases) as Test),
    // Upstream's `prop(name, arbitraries, self, timeout)`, passed through whole.
    prop: (
      ...[name, arbitraries, self, timeout]: [string, unknown, Body, unknown?]
    ) => t["prop"]!(name, arbitraries, provide(self), timeout),
  }) as T;
}

/** A `layer(…)` describe whose `it` is wrapped too. */
function describeWith<T>(base: T): T {
  return ((...args: unknown[]) => {
    const f = args.at(-1) as (it: unknown) => void;
    (base as Describe)(...args.slice(0, -1), (it: unknown) => f(methods(it)));
  }) as T;
}

function methods<M>(base: M): M {
  return new Proxy(base as object, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (key === "effect" || key === "live") return tester(value);
      if (key === "layer")
        return (...args: unknown[]) =>
          describeWith((value as (...a: unknown[]) => unknown)(...args));
      return value;
    },
  }) as M;
}

export const it: typeof Vitest.it = methods(Vitest.it);
export const effect: typeof Vitest.effect = tester(Vitest.effect);
export const live: typeof Vitest.live = tester(Vitest.live);
export const layer: typeof Vitest.layer = (layer_, options) =>
  describeWith(Vitest.layer(layer_, options));
