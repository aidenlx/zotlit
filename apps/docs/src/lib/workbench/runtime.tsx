// The page runtime: the web Workbench's services in one atom runtime, kept in
// the page's one atom registry, and the bridge React and CodeMirror reach them
// through. Every read, render, and command of the page runs on it; closing the
// page disposes the registry, which interrupts them and closes the services.

import { RegistryContext } from "@effect/atom-react";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import type { HttpClient } from "effect/http";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createContext, use, useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  BRIDGE_VERSION,
  layerLocalBridgeClient,
  layerTabStorage,
} from "@zotlit/workbench/bridge";
import type {
  LocalBridgeClient,
  LocalBridgeStorage,
} from "@zotlit/workbench/bridge";
import { SAMPLE_ITEMS } from "@zotlit/workbench/render";

import { layerRendering } from "./rendering";
import type { Rendering } from "./rendering";
import { layerTransfer } from "./transfer";
import type { Transfer } from "./transfer";
import {
  layerWorkbenchConnection,
  WorkbenchConnection,
} from "./workbench-connection";

export type PageServices =
  | LocalBridgeClient
  | WorkbenchConnection
  | Rendering
  | Transfer;

/**
 * Every service the page uses, built once per page, over the Local Bridge
 * transport and the tab storage the page reads from outside.
 */
export const layerPage: Layer.Layer<
  PageServices,
  never,
  HttpClient.HttpClient | LocalBridgeStorage
> = Layer.mergeAll(
  layerRendering,
  layerTransfer,
  layerWorkbenchConnection,
).pipe(
  Layer.provideMerge(
    layerLocalBridgeClient({
      bridgeVersion: BRIDGE_VERSION,
      templateDataContractVersion: SAMPLE_ITEMS[0]!.contractVersion,
    }),
  ),
);

/** The page in a browser: `fetch` to the Local Bridge, the tab's session storage. */
const layerBrowserPage = layerPage.pipe(
  Layer.provide([FetchHttpClient.layer, layerTabStorage]),
);

/** The page's runtime, which every read, render, and command runs on. */
export type PageAtomRuntime = Atom.AtomRuntime<PageServices, never>;

/** The one way React and CodeMirror reach the page's services. */
export interface PageBridge {
  /** The registry every atom of the page lives in. */
  readonly registry: AtomRegistry.AtomRegistry;
  readonly runtime: PageAtomRuntime;
  /** Answers a synchronous Effect, such as a service read, at once. */
  readonly runSync: <A, E>(effect: Effect.Effect<A, E, PageServices>) => A;
  /** `effect` with the page's services in hand, for a host member. */
  readonly provide: <A, E>(
    effect: Effect.Effect<A, E, PageServices>,
  ) => Effect.Effect<A, E>;
}

interface PageLifetime extends PageBridge {
  /** Keeps the page open; the returned function lets it close. */
  readonly hold: () => () => void;
}

function makePageBridge(layer: Layer.Layer<PageServices>): PageLifetime {
  const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
  const runtime: PageAtomRuntime = Atom.runtime(layer);
  // The services are built on first use and live as long as the registry, so
  // a page a StrictMode replay makes and drops builds nothing.
  let built = false;
  const services = () => {
    if (!built) {
      built = true;
      registry.mount(runtime);
    }
    return AsyncResult.getOrThrow(registry.get(runtime));
  };
  // The page's lifetime, not a mount's, owns the launch: a StrictMode replay
  // neither stops it nor starts another.
  const launch = runtime.atom(
    WorkbenchConnection.use((connection) => connection.start),
  );
  let closed = false;
  let holds = 0;
  return {
    registry,
    runtime,
    runSync: (effect) => Effect.runSyncWith(services())(effect),
    provide: (effect) =>
      Effect.suspend(() => Effect.provideContext(effect, services())),
    hold() {
      holds += 1;
      if (holds === 1 && !closed) registry.mount(launch);
      return () => {
        holds -= 1;
        // A StrictMode replay lets go and takes hold again in one commit, so
        // the page closes only when nothing holds it after that commit.
        queueMicrotask(() => {
          if (holds > 0 || closed) return;
          closed = true;
          registry.dispose();
        });
      };
    },
  };
}

const PageBridgeContext = createContext<PageBridge | null>(null);

/**
 * Builds the page runtime over `layer` for its children and disposes it when
 * they unmount. The atom hooks below it read the page's registry.
 */
export function PageRuntime({
  layer,
  children,
}: {
  /** The page's services; tests hand a layer over fakes. */
  layer?: Layer.Layer<PageServices>;
  children: ReactNode;
}) {
  const [bridge] = useState(() => makePageBridge(layer ?? layerBrowserPage));
  useEffect(() => bridge.hold(), [bridge]);
  return (
    <PageBridgeContext value={bridge}>
      <RegistryContext.Provider value={bridge.registry}>
        {children}
      </RegistryContext.Provider>
    </PageBridgeContext>
  );
}

/** The bridge of the page runtime this component renders inside. */
export function usePageBridge(): PageBridge {
  const bridge = use(PageBridgeContext);
  if (bridge === null) throw new Error("No page runtime is mounted.");
  return bridge;
}
