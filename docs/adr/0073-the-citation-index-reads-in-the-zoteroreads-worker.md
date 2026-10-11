---
status: accepted
---

# The Citation Index reads in the ZoteroReads worker

Supersedes the dedicated-worker part of [ADR 0072](0072-the-citation-index-reads-in-a-dedicated-worker.md) and amends [ADR 0068](0068-the-zotero-database-runs-in-a-web-worker-behind-zoteroreads.md). The Citation Index shares the ZoteroReads worker with the Item Index from [ADR 0069](0069-the-item-search-index-runs-in-the-zoteroreads-worker.md).

ADR 0072's renderer publication decision remains: complete citation maps stay in the worker, the renderer holds requested answers, views own query-core observations, and Document Citation Text retains its captured answer while its document is open in a workspace leaf.

## Why

Each worker prepared its own read copy at every refresh. Every Read Mode makes an owned copy, including Immutable Source. Without reflink support, two workers write two full byte copies. One source needs one copy per refresh.

ADR 0072's isolation experiment removed the production page bound. The production query plan itself caused the long sparse-Library page: it scanned every `itemData` row between two itemIDs across all Libraries and fields, then filtered the rows. A small Library with Items at both ends of the range could block one statement for 64 ms.

The [#1439 probe](https://github.com/aidenlx/zotlit/issues/1439) used 100,000 Items:

| Layout | Production-bound `getCitekeyPage` | One walk across every Library, 2,000-itemID windows |
| --- | --- | --- |
| Four interleaved Libraries, all Items keyed | 420 ms total; 4.4 ms maximum page | 60 ms total; 1.9 ms maximum page |
| Small Library with Items at both ends of the itemID range | 64 ms maximum page | 1.7 ms maximum page |
| One Item in 1,000 keyed | — | 8 ms total; 0.2 ms maximum page |

[#1440](https://github.com/aidenlx/zotlit/issues/1440) measured three full walks per window size, with 15 fields per Item after adding 11 shared-value fields. The sparse layout kept Library 4's ten lowest and ten highest itemIDs. Total is the mean per walk; p50 and maximum cover all three walks, without a warm-up walk.

| Layout | Window | Windows/run | Total ms | p50 ms | Maximum ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dense | 500 | 202 | 116.29 | 0.52 | 3.65 |
| Dense | 1,000 | 101 | 119.30 | 1.08 | 3.56 |
| Dense | 2,000 | 51 | 116.55 | 2.07 | 6.89 |
| Dense | 5,000 | 21 | 108.13 | 5.22 | 7.22 |
| Sparse | 500 | 202 | 113.52 | 0.51 | 5.61 |
| Sparse | 1,000 | 101 | 111.02 | 1.04 | 3.08 |
| Sparse | 2,000 | 51 | 126.60 | 2.15 | 13.10 |
| Sparse | 5,000 | 21 | 112.84 | 5.41 | 9.46 |

The selected window is 1,000 itemIDs: the largest tested size with a maximum below 8 ms in both layouts. These measurements included other validation jobs. The smaller window preserves margin under that load.

## Decision

- **One worker, one connection, one read copy per refresh.** The Citation Index borrows the ZoteroReads connection. An older connection can remain alive while an existing Snapshot holds it.
- **Bound each statement by itemID.** `getCitekeyWindow` walks 1,000-itemID windows across every Library. Unary `+` on `fieldID` pins the itemID range plan. The regression test checks `sqlite_autoindex_itemData_1` and the absence of a temporary B-tree; removing `+` selects `itemData_fieldID` and fails the test.
- **Use the borrowed client as the freshness token.** An answer is current when `published.client === client`. A read after a connection change waits for the current rebuild. Equal rebuilds keep the published revision.
- **Return one requested answer.** `CitationLookup({ scope, citekeys, indexedKeys })` returns one revision and the requested resolutions, or `DbUnavailable`. Unavailable remains distinct from a successfully missing key.
- **Keep source ownership in ZoteroReads.** Its connection change feed drives reads. `CitationRefresh`, the citation worker role, and the renderer generation relay are removed.

## Considered Options

- **Keep a dedicated worker and share one read copy across workers.** Rejected. This adds cross-worker copy lifetime management. The bounded query removes the measured reason for a separate citation thread.
- **Keep a dedicated worker with two read copies.** Rejected. Each refresh duplicates disk use and copy I/O.

## Consequences

A ZoteroReads worker failure also stops citation answers. That failure already stops every other database read. Refresh recovers the worker and both indexes.

The citation maps share the worker heap with the Item Index. Citation answers and Item search use one database state again. The renderer continues to retain only the answers its consumers request.

## Measurements

The [#1441 baseline](https://github.com/aidenlx/zotlit/issues/1441) used two workers at `231056a4f`. The one-worker integration runs used `cd9f326d2` (merge of `codex/1439-review-fixes`). Each design had three desktop runs. Each run covered three refresh rounds over 100,000 Items. Shared Reading (Library 2) held its three base Items and only the first ten and last ten Stress Items. Values below are p99 / maximum milliseconds.

| Design | Run | Renderer gap | Item search | Search samples | Citation lookup | Lookup samples |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Two workers | 1 | 4.50 / 5.20 | 0.80 / 489.90 | 16,766 | 0.20 / 1226.80 | 31,744 |
| Two workers | 2 | 4.60 / 6.10 | 0.80 / 488.30 | 18,918 | 0.20 / 1232.50 | 33,903 |
| Two workers | 3 | 4.50 / 5.30 | 0.80 / 494.20 | 18,425 | 0.20 / 1242.50 | 37,164 |
| One worker | 1 | 4.60 / 5.10 | 0.90 / 469.00 | 11,182 | 0.90 / 632.00 | 11,179 |
| One worker | 2 | 4.60 / 8.50 | 0.80 / 594.50 | 11,270 | 0.80 / 593.20 | 11,264 |
| One worker | 3 | 4.60 / 6.20 | 0.80 / 647.10 | 11,227 | 0.80 / 660.60 | 11,225 |

All six Citation Index measurements passed the renderer limits of p99 ≤ 16 ms and maximum ≤ 32 ms. Item search still has a refresh spike; resolving it remains separate work.

CDP sampled used JavaScript heap every 25 ms. Values below are the median of three runs, in MiB (1 MiB = 1,048,576 bytes). Sum is the median of each run’s worker sum; peak sums add worker peaks that can occur at different times.

| Design | Worker | Before MiB | Peak MiB | After MiB |
| --- | --- | ---: | ---: | ---: |
| Two workers | zotlit-zotero-reads | 205.53 | 256.67 | 246.65 |
| Two workers | zotlit-citation-reads | 54.12 | 124.37 | 101.15 |
| Two workers | **Sum** | 259.65 | 381.04 | 347.80 |
| One worker | zotlit-zotero-reads | 230.45 | 304.55 | 294.40 |
| One worker | **Sum** | 230.45 | 304.55 | 294.40 |

The one-worker design reduced the median sum of sampled worker peaks; before and after values vary with garbage collection. These runs do not measure native SQLite memory or disk-copy throughput.

During earlier validation at `21ddc8ef1`, the third scheduled run and its first retry timed out during vault creation, before measurement. A further run passed after the temporary desktop helper applied `keepRendering` before setup and after reloads. The walkthrough passed all 20 cases. The end-to-end file had 30 passes, one failure, and five skips; its one-worker recovery path passed. The Annotation capability failure expected `zotero-unavailable` and received `local-api-disabled`. The same case failed on `origin/next` at `4be834035`. Focused ticket-branch retries stopped at the same vault-creation timeout.

The full final `pnpm e2e` run first stopped before collection when Paired Zotero exited with `SIGABRT` under the sandbox. Outside the sandbox, it recorded 51 passes, the same Annotation capability failure, and 128 skips. The Fresh destination flow teardown also failed with `vault-remove refused`, then the Paired Run failed with `connect ECONNREFUSED` on the Obsidian CLI socket. The 123 Paired Run cases did not execute. The final full-suite gate remains incomplete; these later teardown and connection failures were not checked on `origin/next`.

### Query during a citation rebuild

The temporary merge `9cc43ff41` combined Query at `5c0187443` with the one-worker branch. Its Query suite passed 29 cases, with zero failures and 38 skips. The Query handler ran in the ZoteroReads worker. The measurement script's older utility-process comments did not describe that code.

One vault used the same 100,000-Item sparse-Library Fixture. Each round started refresh and immediately ran `zotlit:query-measure from=items library=all filter='title.contains("stress")' limit=100`. That first query finished before the new connection was published. A calibration run measured 240.8 ms of Query work before citation revalidation began at 894.7 ms. To measure the rebuild itself, each round also ran the same command when ZoteroReads emitted `changed`.

The table records that second query. Times are milliseconds from each refresh start, which is zero. Citation intervals run from `status-changed: revalidating` to `status-changed: fresh`; `whenResolved()` also completed successfully. Each query scanned 100,000 Items. All ten queries started and ended inside the citation interval, with engine time of 239.20–260.00 ms and only 0.80–1.30 ms outside the worker. Every window stayed visible.

| Run | Refresh end | Citation interval | Query interval | Overlap ms | Slices | Slice p99 ms | Slice maximum ms |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: |
| 1 | 898.00 | 897.50–1228.10 | 898.60–1149.10 | 250.50 | 55 | 5.40 | 5.40 |
| 2 | 932.30 | 932.40–1263.50 | 933.70–1184.00 | 250.30 | 54 | 5.70 | 5.70 |
| 3 | 902.10 | 902.30–1224.20 | 903.40–1149.20 | 245.80 | 53 | 5.40 | 5.40 |
| 4 | 898.20 | 898.30–1240.70 | 899.50–1160.50 | 261.00 | 55 | 5.50 | 5.50 |
| 5 | 901.40 | 901.50–1224.10 | 902.10–1149.60 | 247.50 | 54 | 5.50 | 5.50 |
| 6 | 904.00 | 904.10–1240.00 | 904.60–1165.30 | 260.70 | 55 | 5.50 | 5.50 |
| 7 | 898.90 | 898.90–1214.60 | 899.50–1141.10 | 241.60 | 53 | 5.60 | 5.60 |
| 8 | 867.40 | 867.40–1183.20 | 868.20–1109.00 | 240.80 | 52 | 5.30 | 5.30 |
| 9 | 912.40 | 912.40–1240.10 | 913.50–1164.90 | 251.40 | 55 | 5.60 | 5.60 |
| 10 | 897.40 | 897.40–1212.30 | 898.20–1138.30 | 240.10 | 53 | 5.50 | 5.50 |

The pooled 539 engine slices had p99 **5.50 ms** and maximum **5.70 ms**, within the 16/32 ms limits. The historical two-worker Query result in ADR 0072 was 10.1 / 15.1 ms, but its unbounded-page isolation workload differs from this bounded sparse-Library workload. The #1441 baseline measured Item search and citation lookup, not ZotLit Query.

The raw slice arrays, epoch timestamps, command logs, and test reports are under `.scratch/acceptance-1443/`; the measurement summary is posted on [#1443](https://github.com/aidenlx/zotlit/issues/1443). The temporary merge branch was deleted and was never pushed.
