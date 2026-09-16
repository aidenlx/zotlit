# Held Reads are realized on TanStack Query Core

Amends [ADR 0054](0054-held-reads-serve-the-old-answer-until-a-fresh-read-replaces-it.md).

ADR 0054 introduced Held Reads on a hand-rolled store in the plugin. The annotation repository (aidenlx/zotlit#824) needs a second engine with the same serve-old-value rules plus a mutation cache, abort signals, and prefix invalidation, which the store lacks. Rather than grow the store into a second query library, we decided that Held Reads are realized on **`@tanstack/query-core`**, and the hand-rolled store is deleted. The Held Read stays the domain concept and the term; a Held Read is now a projection of a query's state, built by one plugin-wide query-client service that every owner receives through the container.

## Rules that differ from ADR 0054

- **A failed replacement re-arms after a cooldown.** ADR 0054 kept a failed value frozen until an unrelated invalidation. Query Core marks an errored query invalidated, so the next ask fetches again. To keep a persistent failure from re-running a read on every redraw, an ask within a short cooldown after the error serves the held value without a fetch. The rule is the same for a failed first read, which stays pending during the cooldown. An explicit invalidation ends that cooldown, because the owner is saying the inputs moved: the next ask fetches at once.
- **A superseded read still cannot publish, by cancellation.** Query Core commits an in-flight result and clears the invalidated flag, so an invalidation that lands mid-read would be lost. An owner cancels the in-flight read with revert before it invalidates. Every reader of that read asks again — the one that started it as much as the ones that joined it, because a revert answers the reader that started it with the value it reverted to, which the stale mark tells apart from a committed one.
- **Retention is time-based, not count-based.** There is no least-recently-used bound. Document Citation Text and the Citekey Resolution Snapshot are retained for the session; text keys are vault paths, removed when the file is deleted. Bibliography and citation renders expire after the default garbage-collection time because their keys change with every edit to the cited set.

## Consequences

- One `QueryClient` for the plugin, registered before every consumer, with `staleTime: Infinity`, `retry: false`, `networkMode: "always"`, and no focus or online tracking. Owners namespace their keys and set per-prefix defaults such as retention and semantic equality.
- The `changed`, `settled`, and `invalidated` contract from ADR 0054 stays, and all owners emit `settled` with the resulting Held Read or `null`. An owner emits `changed` and `invalidated` at its own invalidation sites and derives `changed` and `settled` from the query cache's success and error events filtered by its prefix.
- A Held Read is an immutable snapshot. A consumer that awaits `settled` asks again for the next snapshot instead of watching a status flip in place.
- Semantic equality is expressed as structural sharing. Render results use the default deep comparison, so an equal re-render keeps its identity and emits only `settled`.
- Surfaces do not hold query observers. Pinning a query for as long as a surface is open is possible later by observing it; until then, retention is the rule above.
