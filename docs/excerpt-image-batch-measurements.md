# Excerpt Image batch retention measurements

This record answers the questions behind [ADR 0051](../apps/obsidian/docs/adr/0051-batches-reuse-excerpt-outcomes-with-bounded-memory.md): how much PDF work one note batch saves by retaining the outcomes its own notes already settled, what the retention costs in encoded bytes while it runs, and what the two bounds do when a corpus outgrows them. The numbers come from `apps/obsidian/src/services/excerpt-image/batch-measurements.ts`, which drives the production `ExcerptImageService` and the production `ExcerptOutcomeScope` over a synthetic corpus.

**The numbers below come from controlled doubles, not from a real PDF.** These trials run under Vitest in Node, with an injected freshness stamp, renderer, and persistent-store double. No Electron, Obsidian, or Chromium process takes part, no PDF page is parsed, and no canvas is allocated. They therefore say how many renders a batch asks the pipeline for, how many requests its retention answers, and how many bytes that retention holds — and nothing about rasterization cost or about the plugin's real IndexedDB store. The live stack those doubles stand in for is measured in [PDF annotation probes](pdf-annotation-probes.md).

## How to run it again

```sh
cd apps/obsidian
ZOTLIT_BATCH_MEASUREMENTS=1 \
ZOTLIT_BATCH_MEASUREMENTS_OUT=/tmp/batch-measurements.json \
  pnpm exec vitest run src/services/excerpt-image/batch-measurements.test.ts
```

The suite skips unless `ZOTLIT_BATCH_MEASUREMENTS=1`, so it never runs in CI; `ZOTLIT_BATCH_MEASUREMENTS_OUT` is optional and writes the record to a file. Two runs on this machine reproduced every count exactly.

## The runtime this record is against

Run date **2026-09-21**. Every number below was measured in one process.

| Component | Version |
| --- | --- |
| Node | v26.9.0 |
| Vitest | 4.1.6 |
| Machine | Apple M4 Pro, macOS 27.0 (build 26A428), arm64 |
| Obsidian / Electron / Chromium | not involved (see above) |
| Retention limits under test | `EXCERPT_OUTCOME_BYTES` 32 MiB, `EXCERPT_OUTCOME_ENTRIES` 256 |

## The corpus

24 notes × 3 excerpts = **72 requests over 12 distinct excerpts** (each excerpt is asked for six times), written one note at a time so every repeat reaches the retention rather than being merged before it. Each generated image is 3 modelled bytes, so the byte bound never binds here and the counts isolate the retention's decisions.

Four store/retention combinations run over that one corpus:

| Pass | Persistent store | Retention |
| --- | --- | --- |
| `repeated` | keeps what it is given | one for the whole batch |
| `perNote` | keeps what it is given | one per note (a separate operation) |
| `noPersistence` | refuses every write | one per note |
| `storeFailure` | refuses every write | one for the whole batch |

| Pass | Requests | Renders | Retention hits | Retention misses | Peak retained bytes |
| --- | --- | --- | --- | --- | --- |
| `repeated` | 72 | 12 | 60 | 12 | 36 |
| `perNote` | 72 | 12 | 0 | 72 | 9 |
| `noPersistence` | 72 | **72** | 0 | 72 | 9 |
| `storeFailure` | 72 | **12** | 60 | 12 | 36 |

Read against the pass that shares nothing, the batch retention **avoids 60 of 72 renders (83 %)** when the store cannot keep the bytes — the case ADR 0051 calls out, where the successful pixels exist only in memory. When the store does work, the batch retention does not change the render count: the store answers the repeats instead, which is why `repeated` and `perNote` both render 12. What the retention adds there is that it answers *before* the store does (60 hits against the store's 60 reads), and that it keeps answering after a failed write.

The 12 misses are one per distinct excerpt: the first request for each excerpt renders, and every later request in the batch is answered from the record.

## One note batch, all notes in flight

The same corpus at batch concurrency merges duplicate requests **before** they reach the retention: the service shares one admitted job between callers that ask for the same excerpt, so the repeats that overlap never become lookups at all.

| Pass | Concurrency | Requests | Renders | Retention hits | Retention misses |
| --- | --- | --- | --- | --- | --- |
| `storeFailure` | 1 | 72 | 12 | 60 | 12 |
| `concurrent` | 16 | 72 | 12 | 2 | 12 |

The render count is a property of the corpus and the retention (`12` distinct excerpts); how many of the repeats show up as retention hits depends on whether they arrive while the first request is still in flight. A batch that reuses an excerpt after another note settled it is answered by the retention; one that asks for it while it is still rendering is answered by the shared admission.

## The two bounds

Two larger corpora exercise the production limits (32 MiB, 256 entries), both against a store that keeps nothing and one batch retention. Each corpus asks for every excerpt twice, so a record that left the retention is asked for again.

| Corpus | Requests | Distinct | Entries bound | Peak retained entries | Peak retained bytes | Renders |
| --- | --- | --- | --- | --- | --- | --- |
| `entryOverflow` | 600 | 300 | 256 | 256 | 768 B | **600** |
| `byteBound` | 400 | 200 | 256 | 170 | 33 423 360 B (31.87 MiB) | **400** |

Both bounds hold: the entry bound keeps 256 of 300 records, and the byte bound keeps 33 423 360 bytes — 170 records of 196 608 bytes, just under the 32 MiB ceiling. Both evict, and the second request for an evicted excerpt renders again, which is what "eviction permits recomputation" costs: with each excerpt asked for twice and half of them evicted before the second ask, the corpus renders every request rather than only the distinct excerpts.

`peakRetainedBytes` is the retention's own accounting of encoded byte lengths, not a heap measurement: the harness reads the peak the scope tracks on every retention rather than the size a note boundary happens to catch, so a peak reached inside one note group is still counted. `peakRetained` (entries) is sampled as each note settles, so a record peak that decayed inside one note group can be missed there. Both figures are read after eviction has run, so one `retain` can momentarily hold a single entry past its ceiling without either figure saying so; eviction is part of that same synchronous step, so no consumer and no sample ever sees the state. A single image larger than the whole byte bound is never retained at all, so it cannot evict the rest of the batch; that rule is pinned by `outcome-scope.test.ts` rather than measured here.

## What this record does not say

- **No real PDF, no real renderer.** The renderer double returns a fixed payload; nothing here measures rasterization, encoding, or PDF document loads.
- **No plugin store.** The persistent store is the `ExcerptCache` interface against an in-memory `Map`, and the "refuses every write" pass models a store that fails, not a fill or a quota error.
- **No vault.** Materialization, asset retention, and the Markdown a batch writes are covered by `materialize.test.ts` and the note-import tests; they are outside this harness.
- **No real application.** The real-app counterpart is `packages/e2e/src/excerpt-rendering.ts`, which runs cold, warm, and re-render passes in a real Obsidian window through `pnpm e2e` (see [release checklist](release-checklist.md)).

## See also

- [Excerpt image queue measurements](excerpt-image-queue-measurements.md), for what the shared PDF queue schedules behind these requests.
- [Excerpt image reuse measurements](excerpt-image-reuse-measurements.md), for the identity that lets two Annotation Sources reach one cache entry.
- [Excerpt image WebP measurements](excerpt-image-webp-measurements.md), for what the retained bytes cost once they are encoded.
