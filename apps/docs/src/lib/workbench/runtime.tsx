// The page runtime: the web Workbench's services in one ManagedRuntime, and
// the one bridge React and CodeMirror reach them through. Nothing else in this
// directory runs the runtime.

import {
  Context,
  Effect,
  FiberSet,
  Layer,
  ManagedRuntime,
  Stream,
} from "effect";
import { FetchHttpClient } from "effect/http";
import type { HttpClient } from "effect/http";
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
import type { WorkbenchRunner } from "@zotlit/workbench/ui";

import { layerRendering } from "./rendering";
import type { Rendering } from "./rendering";
import { layerTransfer } from "./transfer";
import type { Transfer } from "./transfer";
import { layerWorkbenchConnection } from "./workbench-connection";
import type { WorkbenchConnection } from "./workbench-connection";

/** Forks the page's Effects; closing the page interrupts every one. */
class PageRunner extends Context.Service<PageRunner, WorkbenchRunner>()(
  "zotlit/docs/workbench/PageRunner",
) {}

export type PageServices =
  | LocalBridgeClient
  | WorkbenchConnection
  | Rendering
  | Transfer
  | PageRunner;

/**
 * Every service the page uses, built once per page, over the Local Bridge
 * transport and the tab storage the page reads from outside.
 */
export const layerPage: Layer.Layer<
  PageServices,
  never,
  HttpClient.HttpClient | LocalBridgeStorage
> = Layer.mergeAll(
  Layer.effect(PageRunner, FiberSet.makeRuntime()),
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

/** The one way React and CodeMirror run Effects on the page's services. */
export interface PageBridge {
  /** The host's runner: a Fiber the page's close interrupts. */
  readonly run: WorkbenchRunner;
  /** Answers a synchronous Effect, such as a service read, at once. */
  readonly runSync: <A, E>(effect: Effect.Effect<A, E, PageServices>) => A;
  /** `effect` with the page's services in hand, for a host member. */
  readonly provide: <A, E>(
    effect: Effect.Effect<A, E, PageServices>,
  ) => Effect.Effect<A, E>;
  /**
   * Calls `callback` with each element of `stream` until the returned
   * function stops it, or the page closes.
   */
  readonly subscribe: <A>(
    stream: Stream.Stream<A>,
    callback: (value: A) => void,
  ) => () => void;
}

interface PageLifetime extends PageBridge {
  /** Keeps the page open; the returned function lets it close. */
  readonly hold: () => () => void;
}

function makePageBridge(layer: Layer.Layer<PageServices>): PageLifetime {
  const runtime = ManagedRuntime.make(layer);
  let closed = false;
  let holds = 0;
  const run: WorkbenchRunner = (effect) => {
    // A closed page starts nothing: the Effect ends interrupted.
    if (closed) return Effect.runFork(Effect.interrupt);
    return runtime.runSync(PageRunner)(effect);
  };
  return {
    run,
    runSync: (effect) => runtime.runSync(effect),
    provide: (effect) =>
      Effect.flatMap(runtime.contextEffect, (context) =>
        Effect.provideContext(effect, context),
      ),
    subscribe(stream, callback) {
      const fiber = run(
        Stream.runForEach(stream, (value) =>
          Effect.sync(() => callback(value)),
        ),
      );
      return () => fiber.interruptUnsafe();
    },
    hold() {
      holds += 1;
      return () => {
        holds -= 1;
        // A StrictMode replay lets go and takes hold again in one commit, so
        // the page closes only when nothing holds it after that commit.
        queueMicrotask(() => {
          if (holds > 0 || closed) return;
          closed = true;
          void runtime.dispose();
        });
      };
    },
  };
}

const PageBridgeContext = createContext<PageBridge | null>(null);

/**
 * Builds the page runtime over `layer` for its children and disposes it when
 * they unmount.
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
  return <PageBridgeContext value={bridge}>{children}</PageBridgeContext>;
}

/** The bridge of the page runtime this component renders inside. */
export function usePageBridge(): PageBridge {
  const bridge = use(PageBridgeContext);
  if (bridge === null) throw new Error("No page runtime is mounted.");
  return bridge;
}
