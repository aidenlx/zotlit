# Events

A service's events are Effect-native: Streams and state, read where they are consumed. Three `zotlit-services` lint rules (`scripts/oxlint-plugin-services.ts`) cover the mechanical part, each with a backlog list in `oxlint.config.ts`:
- `no-nanoevents` rejects a `nanoevents` import;
- `plain-adapter-streams` rejects an `on` or `subscribe` member in a `plain.ts`;
- `obsidian-events-intake` rejects `registerEvent` inside an Effect generator.

The reviewer checks:

- **State or event.** What consumers watch is a `SubscriptionRef`, exposed as a Stream with `changesUntil` from `src/lib/effect-stream.ts`. A discrete occurrence is a `PubSub` exposed as a Stream. A condition a late subscriber must still see (stopped, failed, backfilled) is state, since a PubSub event has passed by the time a late subscriber attaches.
- **Obsidian events.** A layer registers `vault`, `metadataCache` and `workspace` events, and one-shots such as `onLayoutReady`, through `obsidianEvents` from `src/lib/effect-obsidian-events.ts`: one ordered intake, one consumer fiber forked on the layer's Scope, a failure boundary per event. A `registerEvent(app.….on(…))` inside a layer bypasses that boundary.
- **Plain adapter surface.** A plain adapter exposes the service's Streams and state themselves ([Services](services.md) → Plain adapter). It has no `on(event, callback)` and no `subscribe(callback)` method.
- **Subscribing from plain code.** A view, a command, or a legacy service subscribes with `subscribe(runtime, stream, callback)` from `src/lib/effect-stream.ts`, using the plugin runtime. The helper attaches before it returns, so two immediate changes both arrive. Each callback gets its own failure boundary, and after runtime disposal the helper returns a no-op unsubscribe. A hand-written `runFork(Stream.runForEach(…))` loses those guarantees. An Effect consumer reads the Stream from the service's tag inside its layer scope.
- **Legacy emitters.** `nanoevents` stays only in services on the legacy list in `oxlint.config.ts`, until each one's conversion removes it. A new emitter, or a new `on(event, callback)` API, is Effect-native from the start. Legacy event names follow [event naming](../../../policies/event-naming.md).
