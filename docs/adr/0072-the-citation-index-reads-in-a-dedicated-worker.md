---
status: accepted
---

# The Citation Index reads in a dedicated worker

Amends [ADR 0068](0068-the-zotero-database-runs-in-a-web-worker-behind-zoteroreads.md). [ADR 0069](0069-the-item-search-index-runs-in-the-zoteroreads-worker.md) keeps the Item Index in the interactive ZoteroReads worker.

The Citation Index uses one dedicated worker for its bulk citation-key read. A synchronous SQLite statement in this worker can delay its own work, but interactive ZoteroReads operations execute on a separate thread. The Item Index, attachment path index, and batch classification retain their current owners. Both workers use the existing transport, read-source implementation, Snapshot leases, liveness checks, recovery, log forwarding, and bounded close. The citation role starts no Item Index, loads no segmenter, and registers no file watcher.

Each rebuild pins one connection in the citation worker. It reads the local Libraries and every Library's citation keys from that connection. The renderer applies saved Library Scope through stable selectors to those Library rows, in canonical Library order, and keeps every local Library for exact Indexed Key reverse lookup. The dedicated connection uses the configured source and Read Mode with the existing fallback rules. It can observe a later committed database state than the interactive worker; transaction equality across workers is not required.

ZoteroReads owns file watching, source change detection, and Freshness Signal intake. The renderer subscribes before citation-worker startup and follows successful source changes, explicit refresh requests, and source or Read Mode changes. One citation refresh lane opens the source before a rebuild; a burst shares that lane and a change during the lane causes a trailing run. Each signal advances a generation and invalidates a running citation read. The Citation Index checks that generation again before publication. A result from the previous source cannot replace the current answer, including when local Library IDs are reused. Scope-only changes rebuild membership through stable selectors.

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

The dedicated run kept renderer-gap p99 at 5.4 ms, but three gaps exceeded 32 ms and the maximum was 70.9 ms. The retained worker profiles and phase timings do not identify one cause. This renderer maximum remains a failed, unclassified result. The measurement record, run instructions, and local evidence locations are recorded on [#1432](https://github.com/aidenlx/zotlit/issues/1432).
