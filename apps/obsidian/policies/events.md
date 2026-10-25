# Events

A service's events are Effect-native: Streams and state. The `zotlit-services` lint rules (`scripts/oxlint-plugin-services.ts`) cover the mechanical part. The reviewer checks:

- **State or event.** What consumers watch is a `SubscriptionRef`, exposed with `SubscriptionRef.changes`, which replays the current value and ends when the service shuts the ref's `pubsub` down in its finalizer (or, for a terminal state, with `Stream.takeUntil`). A discrete occurrence is a `PubSub` Stream. A condition a late subscriber must still see (stopped, failed, backfilled) is state.
- **Obsidian events.** A layer takes Obsidian events, one-shots such as `onLayoutReady` included, through `obsidianEvents` from `src/lib/effect-obsidian-events.ts`, consumed on the layer's Scope.
- **Subscribing from plain code.** A view, a command, or a legacy service subscribes through `bridge.subscribe(stream, callback)` when it holds the container's bridge, or `subscribe(runtime, stream, callback)` from `src/lib/effect-stream.ts` when it holds a runtime, never a hand-written `runFork(Stream.runForEach(…))`. An Effect consumer reads the Stream from the service's tag inside its layer scope.
