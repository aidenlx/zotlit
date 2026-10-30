---
status: superseded in part by ADR-0073
---

# The Citation Index reads in a dedicated worker

> **Superseded in part by [ADR 0073](0073-the-citation-index-reads-in-the-zoteroreads-worker.md).** The Citation Index reads in the ZoteroReads worker; the renderer publication decision remains.

Amends [ADR 0068](0068-the-zotero-database-runs-in-a-web-worker-behind-zoteroreads.md) and [ADR 0060](0060-held-reads-are-realized-on-tanstack-query-core.md). [ADR 0069](0069-the-item-search-index-runs-in-the-zoteroreads-worker.md) keeps the Item Index in the interactive ZoteroReads worker.

The Citation Index uses one dedicated worker for citation-key reads, lookup map construction, semantic comparison, and lookup execution. A synchronous SQLite statement in this worker can delay its own work, but interactive ZoteroReads operations execute on a separate thread. The Item Index, attachment path index, and batch classification retain their current owners. Both workers use the existing transport, read-source implementation, Snapshot leases, liveness checks, recovery, log forwarding, and bounded close. The citation role starts no Item Index, loads no segmenter, and registers no file watcher.

Each rebuild pins one connection in the citation worker. It reads the local Libraries and every Library's citation keys from that connection. The worker applies saved Library Scope through stable selectors to those Library rows, in canonical Library order, and keeps every local Library for exact Indexed Key reverse lookup. The dedicated connection uses the configured source and Read Mode with the existing fallback rules. It can observe a later committed database state than the interactive worker; transaction equality across workers is not required.

ZoteroReads owns file watching, source change detection, and Freshness Signal intake. The renderer subscribes before citation-worker startup and follows successful source changes, explicit refresh requests, and source or Read Mode changes. One citation refresh lane in the citation worker opens the source before a rebuild; a burst shares that lane and a change during the lane causes a trailing run. Each signal advances a generation and invalidates a running citation read. The Citation Index checks that generation again before publication. A result from the previous source cannot replace the current answer, including when local Library IDs are reused. Scope-only changes rebuild membership through stable selectors.

A failed same-source read keeps the existing Held Read behavior. Failure is an unavailable read, not an empty successful snapshot. Citation-worker failure affects citation resolution alone. A later refresh retries it with current configuration. Plugin unload ends subscriptions, active requests, Snapshot leases, worker transport, log ports, and read-clone ownership through their scopes. The production bounded page scan remains in place.

The cost is one additional worker and one read-only connection, plus a prepared read clone in clone or copy mode. A held Snapshot can retain an older connection during refresh. The 100,000-Item isolation experiment and resource measurements belong to the acceptance evidence for #1432; this decision does not infer native SQLite memory from JavaScript heap measurements.

## Measurement

The 100,000-Item experiment temporarily removed the page upper bound and kept the small group Libraries that produce long scans. Six direct page reads exceeded 32 ms in each final run. CPU profiles then proved that query-reader work in `zotlit-zotero-reads` ran during `getCitekeyPage` work in `zotlit-citation-reads`.

| Measure | Shared worker | Dedicated worker | Limit |
| --- | ---: | ---: | ---: |
| Query slice p99 | 11.5 ms | 10.1 ms | 16 ms |
| Query slice maximum | 84.1 ms | 15.1 ms | 32 ms |
| Cancel maximum | 9.8 ms | 4.7 ms | 50 ms |
| Serving connections | 1 | 2 | recorded |
| Dedicated citation-worker heap, before / sampled peak / after | — | 17.8 / 19.2 / 17.7 MiB | recorded |

The split adds one active read-only connection. The dedicated worker's JavaScript heap cost was about 18 MiB in this run. Renderer working-set samples include both workers, SQLite/native memory, and shared renderer state, so they do not isolate the native connection cost.

The dedicated run kept renderer-gap p99 at 5.4 ms, but three gaps exceeded 32 ms and the maximum was 70.9 ms. That run did not capture a renderer profile. Its measurement record, run instructions, and local evidence locations are recorded on [#1432](https://github.com/aidenlx/zotlit/issues/1432).

## Renderer publication

Follow-up [#1434](https://github.com/aidenlx/zotlit/issues/1434) profiled repeated refreshes with the production page bound. Snapshot map construction took 25.7–27.5 ms, followed by 8.8–11.0 ms of semantic comparison on the renderer, producing a 37.7 ms timer gap. Both operations were synchronous. The same 48 queries without a refresh stayed below the 32 ms limit. This identifies the repeated stall; the individual historical 70.9 ms event has no renderer profile.

The citation worker owns the complete maps. A caller submits the Citation Keys and Indexed Keys needed for one operation and receives their answers from one published resolution revision. The renderer holds these requested answers. Full-library rows and maps stay in the worker. Equal rebuilds retain the resolution revision; publication requires no renderer comparison of full maps.

Each document operation collects its input keys before the batch read and uses that answer for grouping, ambiguity, and reverse spelling. Editor and graph render hooks remain synchronous by reading a view-owned answer delivered asynchronously. A view replaces its requested key set when its input changes and releases it on disposal. The Citation Lookup realizes a view-owned answer as a query-core observation keyed by its request, the pinning [ADR 0060](0060-held-reads-are-realized-on-tanstack-query-core.md) left for later: the earlier answer stays on screen while a changed request is read, and an unobserved request expires after five minutes. Document Citation Text holds the lookup answer its document captured, so it is retained only while that document is open in a workspace leaf; the renderer keeps no answer for a document that is no longer shown. Request and source generations prevent late replies from updating a newer view. An unavailable answer stays distinct from a successfully missing key.

Fresh reads wait for a successful current rebuild. Views retain their previous complete answers during refresh or failure. The worker retains the published maps and one unpublished candidate, with cancellation checks during construction and comparison. Callers receive ordinary data rather than remote snapshot leases, so their lifetime does not retain historical full maps.

The final worker-owned implementation was profiled with 100,000 Items, the production page bound, 48 interactive queries, and three citation refreshes. All queries completed. Continuous renderer timer gaps had p99 4.2 ms and maximum 7.8 ms, down from the parent build's 37.7 ms maximum; query-window gaps had maximum 5.9 ms. No renderer long tasks were recorded. CPU samples placed full-map construction (`#replace`) and semantic comparison (`#sameAs`) in `zotlit-citation-reads`, with no samples of either operation in the renderer. The desktop regression also passed, with p99 5.1 ms and maximum 7.3 ms. These measurements cover this workload; the original unprofiled 70.9 ms event remains unclassified.
