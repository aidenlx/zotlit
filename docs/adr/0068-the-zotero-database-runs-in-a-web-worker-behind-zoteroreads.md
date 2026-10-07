# The Zotero database runs in a Web Worker behind ZoteroReads

Amends [ADR 0050](0050-chunked-work-yields-via-messagechannel.md) for database reads. Applies [ADR 0054](0054-held-reads-serve-the-old-answer-until-a-fresh-read-replaces-it.md) and [ADR 0060](0060-held-reads-are-realized-on-tanstack-query-core.md) unchanged.

The Zotero database lives in one Web Worker. The worker owns the connection, Read Mode selection, the source fingerprint, the file watchers, the debounced single-flight refresh lane, and the Freshness Signal intake. The renderer reads the database only through **ZoteroReads**: an Effect RPC group of use-case operations such as `NoteSource`, `AnnotationSources`, `ItemsByIndexedKeys`, and `DisplayRefs`. Each operation composes the `@zotlit/db` queries inside the worker and returns a plain bundle; the renderer keeps the pure builds that need its resolvers. The renderer holds no database client type and opens no SQLite file.

Obsidian runs Web Workers with Node integration, so `node:sqlite` and `node:fs` load in the worker unchanged. The plugin build bundles the worker entry and embeds it as a string; the renderer spawns it from a blob URL on load and terminates it on unload. One worker serves every request at once: `Changes`, a held Snapshot, and an open stream each occupy a request for their whole life, so a cap on requests would let them hold back a short read or the liveness ping.

## Why

Every read used to run on Obsidian's main thread. On a 10,000-item library in Obsidian 1.14.4, the item index build cut into 50-item slices with a yield between them still stalled a frame for 50–53 ms and produced a 51–57 ms long task; one unsliced read blocked for 7.8 s. The same build on the worker keeps the longest frame gap at the idle floor (19 ms) with zero long tasks, at the same total time of about 5 s. Throughput is the same; the stall leaves the main thread.

Measured on the shipped worker adapter in Obsidian 1.14.4 (rAF gaps and `longtask` entries over the run; idle floor 19 ms):

| Work | Library | Total | Longest frame gap | Long tasks |
| --- | --- | --- | --- | --- |
| Item index build (refresh, index, citekey snapshot, and path index together) | 10,000 items | 5.0 s | 19 ms | 0 |
| Citekey snapshot | 10,000 items | 50–60 ms | 19 ms | 0 |
| Citekey snapshot | 100,000 items | 360 ms | 83 ms | 1 (95–106 ms) |
| Batch classify (update-all, before the confirmation) | 10,000 items | 0.4 s | 19 ms | 0 |
| Batch classify (update-all, before the confirmation) | 100,000 items | 3.8 s | 50 ms | 1 (58 ms) |

The in-process adapter on the main thread blocked 614 ms for the 10,000-item index and about 1.4 s for a 100,000-id classify. The long task that remains at 100,000 items is the renderer handling one large message: the citekey snapshot of a whole library, and the 100,000 item ids that classify reads and sends back. Streams of slices would remove both.

## Decision

- **Snapshot replaces the renderer lease.** A Snapshot is a stream operation: the worker borrows the connection inside the stream's scope and emits one id, and every operation that names the id reads that connection. Closing the stream ends the borrow; an idle Snapshot ends after 5 minutes. A refresh validates the new source first and then swaps it in, so a Snapshot keeps reading the old connection, which closes after its last borrower. The renderer's `acquireRead()` returns a lease bound to one Snapshot. The refresh gate no longer waits for leases.
- **Long reads stream in slices.** The item index, the attachment path index, and batch classification stream from the worker, one SQLite query per slice and 500 items per slice by default. Slicing sets cancellation granularity and message size; it is not a frame budget. Cancellation is a fiber interrupt and lands at the next slice. The `MessageChannel` yield of ADR 0050 stays for loops over the vault and the UI.
- **Held Reads serve the synchronous surfaces.** Library Scope, graph citation labels, the welcome readout, the attachment path index, and the annotation sidebar hold their last answer and refresh from the `Changes` stream.
- **Gesture-bound writes await one read.** Copy citation awaits `AnnotationSources`, renders, then calls `navigator.clipboard.writeText`; Electron's clipboard is the fallback.
- **Typed values cross the boundary.** `DbUnavailable` and `SnapshotExpired` arrive as tagged errors; `Temporal.Instant` and `ReadonlyMap` fields cross through one Schema codec.
- **A failed worker degrades the database.** A worker error event, a broken `Changes` stream, or a missed liveness ping (one every 10 s, 15 s to answer) moves the service to `degraded` with a `DbUnavailable`; the next refresh spawns a new worker.
- **Tests use the in-process adapter.** The same handler layer runs on the calling runtime behind an in-memory RPC pair over `:memory:` fixture databases. The End-to-end Run proves the real transport.

## Considered Options

- **Keep the reads on the main thread and slice them finer.** The 50-item build still stalls frames, and every consumer repeats its own chunk size, generation counter, and yield. **Rejected.**
- **One "run this query" RPC.** The renderer would compose dozens of round trips per use case, and data across them would not share one database state. **Rejected** in favor of use-case operations with Snapshots.
- **Node `worker_threads`.** A Web Worker already has Node integration in Obsidian, and the Effect platform supplies its spawner and runner. **Rejected.**

## Consequences

- Every database read is asynchronous. Reads that need one database state share a Snapshot.
- The worker logs to its own console sink; it does not follow the plugin's log level.
- A worker that crashes leaves its read clone in the system temp folder until Obsidian restarts, because the sweep skips clones of the running process.
