# Events

A service's events are Effect-native: Streams and state. The `zotlit-services` lint rules cover the mechanical part (`oxlint.config.ts`). The reviewer checks:

- **State or event.** What consumers watch is a `SubscriptionRef`, exposed with `changesUntil` from `src/lib/effect-stream.ts`. A discrete occurrence is a `PubSub` Stream. A condition a late subscriber must still see (stopped, failed, backfilled) is state.
- **Obsidian events.** A layer takes Obsidian events, one-shots such as `onLayoutReady` included, through `obsidianEvents` from `src/lib/effect-obsidian-events.ts`, consumed on the layer's Scope.
- **Subscribing from plain code.** A view, a command, or a legacy service subscribes through `subscribe(runtime, stream, callback)` from `src/lib/effect-stream.ts`, never a hand-written `runFork(Stream.runForEach(…))`. An Effect consumer reads the Stream from the service's tag inside its layer scope.
