import { Component } from "obsidian";
import { expect } from "vitest";

import { Effect, Exit, Scope } from "@/lib/effect";
import { componentScope } from "@/lib/effect-scope";
import { it } from "@/lib/effect-vitest";

it.effect("componentScope closes when the component unloads", () =>
  Effect.gen(function* () {
    const component = new Component();
    component.load();
    const scope = yield* componentScope(component);
    let released = 0;
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => released++),
    );
    expect(released).toBe(0);
    component.unload();
    expect(released).toBe(1);
    component.load();
    component.unload();
    expect(released).toBe(1);
  }),
);

it.effect("componentScope runs its finalizers once when closed first", () =>
  Effect.gen(function* () {
    const component = new Component();
    component.load();
    const scope = yield* componentScope(component);
    let released = 0;
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => released++),
    );
    yield* Scope.close(scope, Exit.void);
    component.unload();
    expect(released).toBe(1);
  }),
);

it.effect("componentScope closes even when a finalizer fails", () =>
  Effect.gen(function* () {
    const component = new Component();
    component.load();
    const scope = yield* componentScope(component);
    let released = 0;
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => released++),
    );
    yield* Scope.addFinalizer(scope, Effect.die(new Error("boom")));
    expect(() => component.unload()).not.toThrow();
    expect(released).toBe(1);
  }),
);
