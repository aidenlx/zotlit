import { it } from "@effect/vitest";
import { Context, Effect, Exit, Scope } from "effect";
import { Component } from "obsidian";
import { expect } from "vitest";

import { componentScope } from "@/lib/effect-scope";

class Probe extends Context.Service<Probe, string>()(
  "zotlit/effect-scope/Probe",
) {}

it.effect("componentScope runs its finalizers with the caller's services", () =>
  Effect.gen(function* () {
    const component = new Component();
    component.load();
    const scope = yield* componentScope(component);
    const seen: string[] = [];
    yield* Scope.addFinalizer(
      scope,
      Effect.serviceOption(Probe).pipe(
        Effect.map((probe) => (probe._tag === "Some" ? probe.value : "none")),
        Effect.flatMap((value) => Effect.sync(() => seen.push(value))),
      ),
    );
    component.unload();
    expect(seen).toEqual(["caller"]);
  }).pipe(Effect.provideService(Probe, "caller")),
);

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
