// PROTOTYPE (proto/view-reactivity) — throwaway. The one seam a view crosses
// into Effect; stands in for a production `lib/view-atoms.ts`.
//
// Interface for a view author:
//   - read a service:   useAtomValue(someServiceAtom)
//   - run a command:    useAtomSet(someCommandAtom)
//   - mount a root:     <ViewRegistry registry={…}>…</ViewRegistry>
// Atoms are defined once, statically, next to the service they read, over
// `viewRuntime`. The plugin owns one registry for its lifetime; every view
// root shares it, so a service Stream runs once however many leaves read it.
import { RegistryContext, scheduleTask } from "@effect/atom-react";
import { Effect, Layer, Option } from "effect";
import type { ManagedRuntime, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createElement } from "react";
import type { ReactNode } from "react";

import type { LabServices } from "./source";

/**
 * The plugin's services as a Layer; each registry seeds it. Kept alive: an
 * idle node would be dropped and its seed lost, and the next read would fall
 * back to the failing default.
 */
const servicesLayer: Atom.Atom<Layer.Layer<LabServices>> = Atom.keepAlive(
  Atom.make(() =>
    Layer.effectContext(
      Effect.die("view atom read on a registry without plugin services"),
    ),
  ),
);

/** Runs every view atom on the plugin's services; no second service graph. */
export const viewRuntime = Atom.runtime((get) => get(servicesLayer));

/**
 * A service's state as a plain value. State Streams (SubscriptionRef
 * `changes`) replay the current value, so `fallback` shows only until the
 * first element arrives.
 */
export function held<A>(
  stream: Stream.Stream<A, never, LabServices>,
  fallback: A,
): Atom.Atom<A> {
  return Atom.map(viewRuntime.atom(stream), (result) =>
    Option.getOrElse(AsyncResult.value(result), () => fallback),
  );
}

/**
 * The plugin-lifetime registry. `defaultIdleTTL` keeps a node alive across
 * Preact's after-paint subscribe, which otherwise drops and rebuilds every
 * Stream atom on mount.
 */
export function makeViewRegistry(
  runtime: Pick<ManagedRuntime.ManagedRuntime<LabServices, never>, "runSync">,
): AtomRegistry.AtomRegistry {
  const context = runtime.runSync(Effect.context<LabServices>());
  return AtomRegistry.make({
    initialValues: [[servicesLayer, Layer.succeedContext(context)]],
    scheduleTask,
    defaultIdleTTL: 400,
  });
}

/** The registry type, so Obsidian adapter files need no Effect import. */
export type ViewRegistryHandle = AtomRegistry.AtomRegistry;

export function ViewRegistry(props: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly children?: ReactNode;
}) {
  return createElement(
    RegistryContext.Provider,
    { value: props.registry },
    props.children,
  );
}
