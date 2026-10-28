// The Local Bridge client as the page runtime's service: each request of the
// Promise client becomes an Effect, and its failure the one tagged failure
// below, which carries what the client threw.

import { Context, Data, Effect, Layer } from "effect";

import { LocalBridgeClient } from "@zotlit/workbench/bridge";
import type {
  InstalledCitationStyle,
  LocalBridgeClientOptions,
  LocalBridgeConnection,
  SaveSelectedProfileRequest,
  SaveSelectedProfileResponse,
  SelectedCitationStyleRequest,
  SelectedCitationStyleResponse,
  SelectedProfileResponse,
  TemplateDependenciesRequest,
  TemplateDependenciesResponse,
} from "@zotlit/workbench/bridge";

import type { SampleItem } from "./fields";

/**
 * A request the Local Bridge client did not answer. `cause` is what the client
 * threw: a `LocalBridgeProtocolError`, a `LocalBridgeUnavailableError`, a
 * refused schema, or the transport's own failure.
 */
export class LocalBridgeFailure extends Data.TaggedError("LocalBridgeFailure")<{
  readonly cause: unknown;
}> {}

type Request<A> = Effect.Effect<A, LocalBridgeFailure>;

export class LocalBridge extends Context.Service<
  LocalBridge,
  {
    /** What the client holds now: the connection the page shows. */
    readonly connection: Effect.Effect<LocalBridgeConnection>;
    /** Whether a kept credential and its port are still here to present. */
    readonly resumable: Effect.Effect<boolean>;
    connectFromFragment(fragment: string): Request<LocalBridgeConnection>;
    /** Null when the tab kept no grant. */
    readonly resume: Request<LocalBridgeConnection | null>;
    readonly disconnect: Request<void>;
    readonly loadSelectedItem: Request<SampleItem>;
    readonly readSelectedProfile: Request<SelectedProfileResponse>;
    saveSelectedProfile(
      request: SaveSelectedProfileRequest,
    ): Request<SaveSelectedProfileResponse>;
    readTemplateDependencies(
      request: TemplateDependenciesRequest,
    ): Request<TemplateDependenciesResponse>;
    readonly listCitationStyles: Request<readonly InstalledCitationStyle[]>;
    readSelectedCitationStyle(
      request: SelectedCitationStyleRequest,
    ): Request<SelectedCitationStyleResponse>;
  }
>()("zotlit/docs/workbench/LocalBridge") {}

/** One client for the page, restored from the tab's kept grant when it is built. */
export const layerLocalBridge = (options: LocalBridgeClientOptions) =>
  Layer.sync(LocalBridge, () => {
    const client = new LocalBridgeClient(options);
    const request = <A>(
      name: string,
      send: (signal: AbortSignal) => Promise<A>,
    ): Request<A> =>
      Effect.tryPromise({
        try: send,
        catch: (cause) => new LocalBridgeFailure({ cause }),
      }).pipe(Effect.withSpan(`LocalBridge.${name}`));
    return LocalBridge.of({
      connection: Effect.sync(() => client.connection),
      resumable: Effect.sync(() => client.resumable),
      connectFromFragment: (fragment) =>
        request("connectFromFragment", () =>
          client.connectFromFragment(fragment),
        ),
      resume: request("resume", (signal) => client.resume({ signal })),
      disconnect: request("disconnect", () => client.disconnect()),
      loadSelectedItem: request("loadSelectedItem", () =>
        client.loadSelectedItem(),
      ),
      readSelectedProfile: request("readSelectedProfile", () =>
        client.readSelectedProfile(),
      ),
      saveSelectedProfile: (body) =>
        request("saveSelectedProfile", () => client.saveSelectedProfile(body)),
      readTemplateDependencies: (body) =>
        request("readTemplateDependencies", () =>
          client.readTemplateDependencies(body),
        ),
      listCitationStyles: request("listCitationStyles", () =>
        client.listCitationStyles(),
      ),
      readSelectedCitationStyle: (body) =>
        request("readSelectedCitationStyle", () =>
          client.readSelectedCitationStyle(body),
        ),
    });
  });
