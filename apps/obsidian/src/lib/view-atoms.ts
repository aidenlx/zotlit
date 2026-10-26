// The seam where a view reads Effect services: atoms over the plugin's
// services, held in one registry for the plugin's lifetime.
//
// What a view author uses:
//   - read a service:   useAtomValue(someServiceAtom)
//   - run a command:    useAtomSet(someCommandAtom)
//   - mount a root:     <ViewRegistryProvider registry={…}>…</ViewRegistryProvider>
// Service atoms are defined once, statically, next to the service they read
// (`services/<name>/atoms.ts`), over `viewRuntime`. Every view root shares the
// registry, so a service Stream runs once however many leaves read it, and it
// stops once no leaf reads it.
import { RegistryContext, scheduleTask } from "@effect/atom-react";
import { Context, Effect, Layer, Option } from "effect";
import type { Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createElement } from "react";
import type { ReactNode } from "react";

import type { MetadataCache } from "@/lib/obsidian-metadata-cache";
import type { Vault } from "@/lib/obsidian-vault";
import type { Workspace } from "@/lib/obsidian-workspace";
import type { CitationIndex } from "@/services/citation-index/service";

/**
 * The services a view atom may read. The registry holds the plugin's whole
 * context; this union is the part view atoms are typed against. Add a service
 * here when a view atom first reads it.
 */
export type ViewServices = CitationIndex | MetadataCache | Vault | Workspace;

/**
 * The plugin's services as a Layer; each registry seeds it. Kept alive: an
 * idle node would be dropped with its seed, and the next read would fall back
 * to the failing default.
 */
const servicesLayer: Atom.Atom<Layer.Layer<ViewServices>> = Atom.keepAlive(
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
  stream: Stream.Stream<A, never, ViewServices>,
  fallback: A,
): Atom.Atom<A> {
  return Atom.map(viewRuntime.atom(stream), (result) =>
    Option.getOrElse(AsyncResult.value(result), () => fallback),
  );
}

/**
 * How long a node with no reader stays before its work stops. Preact runs a
 * subscription after paint, later than the registry's removal of a node read
 * during render; without this delay every mount drops and restarts the
 * node's Stream.
 */
const IDLE_TTL_MILLIS = 400;

/** A registry seeded with `context`; a test passes its own services. */
export function makeViewRegistry(
  context: Context.Context<ViewServices>,
  { idleTTL = IDLE_TTL_MILLIS }: { readonly idleTTL?: number } = {},
): AtomRegistry.AtomRegistry {
  return AtomRegistry.make({
    initialValues: [[servicesLayer, Layer.succeedContext(context)]],
    scheduleTask,
    defaultIdleTTL: idleTTL,
  });
}

/** The plugin's view registry. */
export class ViewRegistry extends Context.Service<
  ViewRegistry,
  AtomRegistry.AtomRegistry
>()("zotlit/obsidian/ViewRegistry") {}

/**
 * The registry for the plugin's lifetime. Obsidian closes every view before
 * `onunload`, so no view is mounted when this layer disposes the registry;
 * it sits above the services, so it closes before the services it reads.
 */
export const layerViewRegistry: Layer.Layer<ViewRegistry, never, ViewServices> =
  Layer.effect(
    ViewRegistry,
    Effect.acquireRelease(
      Effect.map(Effect.context<ViewServices>(), (context) =>
        makeViewRegistry(context),
      ),
      (registry) => Effect.sync(() => registry.dispose()),
    ),
  );

/** The registry type, so an Obsidian adapter file needs no Effect import. */
export type ViewRegistryHandle = AtomRegistry.AtomRegistry;

/** Gives a React root the plugin's registry. */
export function ViewRegistryProvider(props: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly children?: ReactNode;
}) {
  return createElement(
    RegistryContext.Provider,
    { value: props.registry },
    props.children,
  );
}
