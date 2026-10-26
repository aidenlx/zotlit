// The Local Bridge for callers outside Effect: the setting tab's connection row
// and the saved Notice.
import { Stream } from "effect";

import type { EffectBridge } from "@/lib/effect-bridge";

import type { LocalBridge, WorkbenchConnection } from "./service";

export interface LocalBridgeEvents {
  /** The live connection started, ended, or was replaced by a newer one. */
  connection: (connection: WorkbenchConnection | null) => void;
  /** A connected Save wrote the Profile's document in this vault. */
  "profile-saved": (profileId: string) => void;
}

/** An event name with the callback that follows it. */
type LocalBridgeSubscription = {
  [K in keyof LocalBridgeEvents]: [event: K, callback: LocalBridgeEvents[K]];
}[keyof LocalBridgeEvents];

/** The edge handle `build.ts` binds; see {@link bindLocalBridge}. */
export interface LocalBridgeHandle {
  /** The connection standing now, without its credential; `null` while none does. */
  readonly connection: WorkbenchConnection | null;
  /** End the connection from Obsidian; the page's next request answers 401. */
  disconnect(): void;
  /** Follow `event` until the returned function stops it, or the runtime closes. */
  on(
    event: "connection",
    callback: LocalBridgeEvents["connection"],
  ): () => void;
  on(
    event: "profile-saved",
    callback: LocalBridgeEvents["profile-saved"],
  ): () => void;
}

/** The Local Bridge over `bridge`; a closed runtime answers no connection. */
export function bindLocalBridge(
  bridge: Pick<EffectBridge, "runSync" | "subscribe">,
  service: LocalBridge["Service"],
): LocalBridgeHandle {
  return {
    get connection() {
      return bridge.runSync(service.connection);
    },
    disconnect: () => bridge.runSync(service.disconnect),
    on: (...[event, callback]: LocalBridgeSubscription) =>
      event === "connection"
        ? // The current connection replays first; the event names a change.
          bridge.subscribe(Stream.drop(service.changes, 1), callback)
        : bridge.subscribe(service.saved, callback),
  };
}
