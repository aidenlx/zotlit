# The item search index runs in the ZoteroReads worker

Amends [ADR 0068](0068-the-zotero-database-runs-in-a-web-worker-behind-zoteroreads.md): the item search index joins the database in the Web Worker, and two operations leave the ZoteroReads contract.

The search behind the Citation Suggester, the quick switcher, and every Item picker is answered by one ZoteroReads operation, `SearchItems`. The renderer sends the local ids of the Libraries in Library Scope, the query, and a limit, and receives ranked Items with title highlight ranges. The worker owns the **Item Index**: it builds the MiniSearch index from its own connection, keeps it fresh from its own change feed, serves the last complete index while a rebuild runs, and hydrates the hits before it answers. Chinese word segmentation runs in the worker through a ZotLit-managed **Chinese Segmenter**, the pinned `jieba-wasm` binary, installed with the user's consent on the same device-wide store as the Pandoc Engine.

## Why

After ADR 0068 the worker streamed `IndexItems` slices to the renderer, and the renderer built the index and ran every search on the main thread. The frame gap during a build was at the idle floor, but the index memory, the build CPU, and every keystroke's search stayed on the thread that paints the editor; at 100,000 items the index lived in the renderer heap for the session. Renderer CPU profiles on a sibling branch tied long frame gaps during large exports to garbage collection, with a live lookup index among the retained heap; a yield cannot split a collector pause, so the retained memory has to leave the renderer. Chinese titles depended on a function borrowed at runtime from the third-party `cm-chs-patch` plugin, which cannot cross to a worker.

Four interface shapes were compared on depth, locality, and seam placement before this one was chosen: one lean-hit operation with renderer-side hydration; explicit index handles with build-progress streams; one hydrated operation; and the same operation with the index as a worker-side service. The last two combined are this decision. The lean variant costs a second round trip per keystroke; the handle variant adds four operations whose extra entry points have no caller today.

## Decision

- **One operation.** `SearchItems` takes `libraryIDs` in canonical order, `query`, and `limit`, and answers hydrated `Item` rows with highlight ranges in rank order. No score crosses the wire. No Snapshot field: the index and the hydration read the connection the index was built on. `IndexItems` and `IndexSignature` leave the contract; the renderer index was their only caller.
- **The index is an Effect-native service in `@zotlit/item-lookup`.** The package adopts Effect as its core and holds the Item Index lifecycle behind an item-source port with a `pinned` member for one build and a generation stream for source swaps; the worker's `Connection` adapter and an in-memory test adapter are its two adapters. The handler layer builds the service beside `Connection`, so both ZoteroReads adapters compose it the same way. The package imports neither Obsidian nor Effect RPC.
- **MiniSearch ranks; one rule stays on top.** Citation key, Zotero key, and year are indexed fields; the query runs with AND, prefix, fuzzy, and field boosts. Items whose citation key starts with the query come first, shortest first; ties fall to newest-first, Library rank, item id. The hand-written candidate intersection, the per-token scan over every Item, the tiers, the recency multiplier, and the exact-year bonus are removed. Query fine-tuning is out of scope; `boostDocument` is the hook for a recency boost later.
- **Index identity is the library list and the connection it was built on.** A `changed` event re-checks every held index: a swapped connection forces a rebuild, an equal per-Library signature vector skips it, a moved one rebuilds. `degraded` drops every index. A list no caller asked for since the last change is evicted at that change. Zotero reassigns local Library ids across database files, so the list alone is not an identity.
- **Stale-while-revalidate stays, inside the worker.** The first search for a list waits for its build; later searches answer from the held index while a rebuild runs. Rebuilds are single-flight with one trailing rerun. The build borrows the connection for its whole life and runs `Effect.yieldNow` after each slice, so a query or the liveness ping interleaves.
- **Cancellation is a fiber interrupt.** The renderer facade runs each search in one `FiberHandle`; a new keystroke interrupts the one before, and the RPC interrupt stops the search in the worker. An interrupted waiter leaves a running build for the next caller.
- **The renderer keeps a thin facade.** `ItemLookup.search(query, { limit })` resolves Library Scope to ids, calls `SearchItems`, attaches Library labels from the scope it asked with, prewarms on ready and on scope change, and answers empty while the database is unavailable.
- **Locale is configuration.** The UI locale reaches the worker in `ReadsConfig` with the spawn and through `Configure`, and feeds the creator-name language lookup.
- **The Chinese Segmenter is a Managed Binary.** The Pandoc Engine's consent-gated download, hash verification, content-addressed device-wide cache, status machine, and settings row generalize into one module with two instances. The build pins the `jieba-wasm` version, asset URL, and SHA-256 and cross-checks them against the installed package. The worker reads the verified bytes itself from the OPFS store once `Configure` names the installed binary (a blob-URL worker shares the renderer's origin and store; verified), and uses `cut_for_search` for indexing and queries. Install and uninstall rebuild the tokenizer and every held index. Without the binary, CJK runs segment through `Intl.Segmenter` at word granularity. ZotLit no longer reads `cm-chs-patch`.

## Considered Options

- **Keep the index in the renderer and stream slices.** The frame gap was already at the floor, but memory, build CPU, and search stayed on the main thread. **Rejected.**
- **Lean hits and renderer hydration.** One more round trip per keystroke for no caller that wants lean hits. **Rejected.**
- **Explicit index handles (`OpenIndex`, `Search`, `Reindex`, progress events).** Flexibility with no present caller; seven pickers would share one handle through the facade anyway. **Rejected.**
- **Keep the hand-written ranking layer and only restructure its scan.** Identical results, but 230 lines kept for scoring behaviour that is out of scope to tune, and the one-letter worst case fixed by a second index structure beside MiniSearch's own. **Rejected.**
- **Keep borrowing `cm-chs-patch`'s `cut`.** A function cannot cross to the worker, and search quality should not depend on another plugin. **Rejected.**
- **A timer-based yield between build slices.** `setTimeout(0)` lets requests through but the nested-timer clamp adds 38–40 % build time; `Effect.yieldNow` resumes on `setImmediate` and costs nothing. **Rejected.**
- **Ship `jieba-wasm` in the plugin bundle.** About 3.8 MB for every user. **Rejected** in favour of the Managed Binary.

## Consequences

- The worker holds state that is not a connection. A rebuild slice can delay a concurrent read by up to one slice; the slice size and yield strategy follow the measurement recorded below.
- Ranking changes: citation-key prefix hits still come first; beyond that MiniSearch's score orders results and ties fall newest-first. The recency multiplier and the exact-year bonus are gone.
- Users of `cm-chs-patch` see their Chinese titles tokenized by `Intl.Segmenter` until they install the Chinese Segmenter from ZotLit's settings.
- Index build logs move from the plugin logger to the worker's console sink (see #1349).

## Measurements

Measured in Obsidian 1.14.4 on a synthetic library with Zotero's indexes, production engine and reads, plain `postMessage` probes (idle floor 16.7–17.7 ms; details in the spec #1356 measurement ticket):

| Metric | 10,000 items, renderer index | 10,000 items, worker index | 100,000 items, renderer index | 100,000 items, worker index |
| --- | --- | --- | --- | --- |
| Index build | 0.33 s, max gap 16.8 ms, 0 long tasks | 0.37 s (yield per 500), max gap 16.8 ms, 0 long tasks | 3.8 s, max gap 17.7 ms, 0 long tasks | 4.5 s (yield per 500), max gap 17.7 ms, 0 long tasks |
| Typical query, end to end | 4–12 ms | 4–12 ms | 7–16 ms | 7–20 ms |
| One-letter query | 12 ms | 12 ms | 180 ms, one 174 ms long task | 170 ms, renderer free |
| Query during a rebuild | 11 ms median | 6–17 ms median by slice size | 18 ms median, 71 ms max | 13 ms median, 28 ms p95 (yield per 500) |
| First keystroke, cold | 0.4 s | 0.4 s | 4.0–4.6 s | 3.8–4.7 s |
| Index heap | +11 MB renderer | +10 MB worker, released on drop | +104 MB renderer | +97 MB worker, released on drop |

The build frame gap was already at the idle floor before this change, because the renderer slices cost 8–13 ms each. The gains are the index heap leaving the renderer, the worst-case query leaving the main thread, and one owner for the lifecycle. SQL hydration of 50 hits (about 4.5 ms, one statement per key) dominates a typical query in both variants.

Inside a real `RpcServer` worker, `Effect.yieldNow` after each slice of 250–500 items gives a 5.5 ms median wait for a concurrent request and adds no build time. A worker-drained `Stream.mapEffect` without it does not yield; `scheduler.yield()` and no yield make a query wait for the whole build; `setTimeout(0)` works but adds 38–40 % build time. A single read of 100,000 ids overflows the call stack in the query builder, so the build reads in slices.
