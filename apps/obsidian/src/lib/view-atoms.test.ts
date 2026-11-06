import { it } from "@effect/vitest";
import { Context, Effect, Exit, Layer, Scope, Stream } from "effect";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { expect, vi } from "vitest";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import {
  layerUnreadViewServices,
  scopedViewRegistry,
} from "@/lib/__fixtures__/view-atoms";
import { CitationIndex } from "@/services/citation-index/service";

import { held, layerViewRegistry, ViewRegistry, watch } from "./view-atoms";

const layerServices = Layer.mergeAll(
  layerUnreadViewServices,
  layerHost(),
  Layer.mock(CitationIndex, {}),
);

it.effect("held shows the fallback until the service Stream has a value", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(layerServices);
    const registry = yield* scopedViewRegistry(context);
    expect(registry.get(held(Stream.never, 0))).toBe(0);
    const atom = held(Stream.concat(Stream.make(1), Stream.never), 0);
    registry.mount(atom);
    expect(registry.get(atom)).toBe(1);
  }).pipe(Effect.scoped),
);

it.effect("closing the registry layer stops the Streams its atoms read", () =>
  Effect.gen(function* () {
    let stopped = false;
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      layerViewRegistry.pipe(Layer.provide(layerServices)),
      scope,
    );
    const registry = Context.get(context, ViewRegistry);
    const atom = held(
      Stream.concat(Stream.make(1), Stream.never).pipe(
        Stream.ensuring(
          Effect.sync(() => {
            stopped = true;
          }),
        ),
      ),
      0,
    );
    registry.mount(atom);
    yield* AtomRegistry.toStream(registry, atom).pipe(
      Stream.filter((value) => value === 1),
      Stream.take(1),
      Stream.runDrain,
    );
    expect(stopped).toBe(false);
    yield* Scope.close(scope, Exit.void);
    expect(stopped).toBe(true);
  }),
);

it("watch hears each change with the value before it, in the update", () => {
  const registry = AtomRegistry.make();
  const count = Atom.make(1);
  const heard: [number, number][] = [];
  watch(registry, count, (value, previous) => heard.push([value, previous]));

  registry.set(count, 2);
  expect(heard).toEqual([[2, 1]]);
  // A set to the value it holds is no change.
  registry.set(count, 2);
  registry.set(count, 3);
  expect(heard).toEqual([
    [2, 1],
    [3, 2],
  ]);
});

it("watch hears the first change of a derived atom nothing else read", () => {
  const registry = AtomRegistry.make();
  const source = Atom.make({ page: 1, zoom: 1 });
  const page = Atom.map(source, ({ page }) => page);
  const listener = vi.fn();
  watch(registry, page, listener);

  registry.set(source, { page: 2, zoom: 1 });
  expect(listener).toHaveBeenCalledExactlyOnceWith(2, 1);
});

it("watch stays still while the atom's equality holds", () => {
  const registry = AtomRegistry.make();
  const source = Atom.make({ keys: ["A"], at: 0 });
  const keys = Atom.map(source, ({ keys }) => keys).pipe(
    Atom.withEquality(
      (a: readonly string[], b: readonly string[]) =>
        a.length === b.length && a.every((key, index) => key === b[index]),
    ),
  );
  const listener = vi.fn();
  watch(registry, keys, listener);

  // A new list with the same keys, beside a change elsewhere.
  registry.set(source, { keys: ["A"], at: 1 });
  expect(listener).not.toHaveBeenCalled();
  registry.set(source, { keys: ["A", "B"], at: 1 });
  expect(listener).toHaveBeenCalledExactlyOnceWith(["A", "B"], ["A"]);
});

it("watch calls the watchers of one atom in the order they began, until each stops", () => {
  const registry = AtomRegistry.make();
  const count = Atom.make(0);
  const order: string[] = [];
  watch(registry, count, () => order.push("first"));
  const stop = watch(registry, count, () => order.push("second"));

  registry.set(count, 1);
  stop();
  registry.set(count, 2);
  expect(order).toEqual(["first", "second", "first"]);
});

it("watch hands a listener that writes in its turn the value it wrote as the next previous", () => {
  const registry = AtomRegistry.make();
  const count = Atom.make(0);
  const heard: [number, number][] = [];
  watch(registry, count, (value, previous) => {
    heard.push([value, previous]);
    if (value === 1) registry.set(count, 2);
  });

  registry.set(count, 1);
  expect(heard).toEqual([
    [1, 0],
    [2, 1],
  ]);
});
