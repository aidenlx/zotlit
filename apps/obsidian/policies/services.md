# Services

The `zotlit-services` lint rules cover the mechanical part of the service architecture. The reviewer checks the rest:

- **Effect shape.** An Effect service's tag shape is Effect-native: its methods return `Effect`s, a generator method through `Effect.fn` (`CODING_STANDARDS.md` → Effect), and state others watch is a `changes` Stream. Its layer is a `layer<Name>` export beside the tag (`layerUseLedger`), or a `layer<Name>(deps)` function when it takes plain inputs (`layerLogOutput(plugin)`).
- **Plain adapter.** Callers outside Effect — legacy services and views — use a plain adapter in `<service>/plain.ts` (`plainUseLedger`): values, Promises, and a `subscribe` that returns its unsubscribe. `build.ts` makes it once from the plugin's runtime and injects it through `useValue`; consumers type their deps as a `Pick` of the adapter.
- **Conversion scope.** A legacy service changes to Effect only in a change made for that conversion. The legacy list in `oxlint.config.ts` is the conversion backlog: the change takes the file off it, injects the service through `useValue`, and drops `ready` from its consumers' `Pick` deps and awaits.
- **Leaves first.** Convert a service once its dependencies are in the Layer graph. A legacy dependency enters the graph through `serviceLayer` when an Effect service first needs it, rather than through the container. `QueryClients` is bridged ahead of any Effect consumer, by decision, so it is the one bridge no Effect service uses yet.
