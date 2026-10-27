import { it } from "@effect/vitest";
import { Context, Effect, Exit, Layer, Scope, Stream } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { expect } from "vitest";

import { layerHost } from "@/lib/__fixtures__/obsidian-host-app";
import {
  layerUnreadViewServices,
  scopedViewRegistry,
} from "@/lib/__fixtures__/view-atoms";
import { CitationIndex } from "@/services/citation-index/service";

import { held, layerViewRegistry, ViewRegistry } from "./view-atoms";

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
