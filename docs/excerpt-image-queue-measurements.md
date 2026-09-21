# Excerpt Image queue measurements

This record answers the scheduling questions behind [ADR 0052](../apps/obsidian/docs/adr/0052-pdf-excerpt-work-uses-a-shared-dedicated-queue.md): with one bounded PDF queue and one resident document, how much work does a multi-PDF batch do, what does a warm batch cost, and what does the queue hold in memory while it runs. The numbers come from `apps/obsidian/src/services/excerpt-image/queue-measurements.ts`, which drives the production `ExcerptImageService` over a synthetic corpus.

## How to run it again

```sh
cd apps/obsidian
ZOTLIT_QUEUE_MEASUREMENTS=1 \
ZOTLIT_QUEUE_MEASUREMENTS_OUT=../../tmp/queue-measurements.json \
  pnpm exec vitest run src/services/excerpt-image/queue-measurements.test.ts
```

The suite skips unless `ZOTLIT_QUEUE_MEASUREMENTS=1`, so it never runs in CI; `ZOTLIT_QUEUE_MEASUREMENTS_OUT` is optional and just writes the record to a file. It names a path relative to `apps/obsidian`, so `../../tmp` is the workspace root's gitignored `tmp/` ([scratch artifacts](../policies/scratch-artifacts.md)); two runs on this machine reproduced every count exactly and every time within the ranges below.

## What the harness models, and what it does not

The harness runs **in Node**, not in Obsidian:

- **PDF work is modelled.** A counting stand-in replaces the renderer: it charges one "document load" whenever the resident document changes, 40 ms of modelled load time, then 12 ms of modelled crop time per excerpt. The real renderer's costs are Chromium rasterization plus Obsidian's PDF.js document, neither of which exists in Node. Counts of loads/renders/hits are therefore properties of the queue and the corpus; the *wall times* carry the modelled 40 ms/12 ms costs on top of the real scheduling overhead.
- **The cache is the same interface, not the same store.** Requests go through the production preflight and the production `ExcerptCache` contract against an in-memory `Map`, not the plugin's IndexedDB store. Cache-hit latency is therefore a scheduling number, not a storage number.
- **Memory is the process's**, sampled after each excerpt settles (`process.memoryUsage()`), so the reported peaks are lower bounds of a heap that also holds the test runner.

What this record cannot show is Obsidian's own half: the PDF.js document load, page parse, and canvas rasterization that `ExcerptRenderer` drives inside the app, the plugin's IndexedDB store, note scheduling, and a real corpus. The in-app half of the queue itself — real Chromium crops under a minimized, background-throttled window — is measured in *The queue in a minimized Chromium window* below. The Obsidian half stays the `packages/e2e` suite's boundary: see [what remains unverified](#what-remains-unverified).

## The real app's own numbers, and the part of the criterion they cannot cover

Everything above is the Node harness. This section is what the running application produced in this worktree, on the same machine, and what the Fixture corpus and this environment cannot produce at all. It answers ticket #1184's criterion row by row instead of leaving the acceptance suite as an unfulfilled promise. Measured **2026-09-22** in this worktree, through `packages/e2e`'s End-to-end Run, with the same machine as above.

### The corpus, and why some rows are absent

The Fixture corpus is **37 items, 12 attachments, 7 notes, 12 annotations** (`packages/scripts/lib/fixture/spec.ts`). Of those 12 annotations exactly **three** carry the excerpt cache image types (`image`/`ink`), and all three hang off the one Attachment `RGRPDF24` (`attachments/rougier-2014.pdf`): `FDRFQ7C2`, `TYY6Z6ZF`, `4PE492KU`. No second PDF in the corpus carries an excerpt-able Annotation, and the corpus's one excerpt-bearing note (itemID 13, `NNNNAAAA`) references two of those three.

The excerpt-rendering acceptance shares that shape: `EXCERPT_RENDERING_CASES` is **9 requests against one renderable PDF** (`attachments/excerpt-acceptance/excerpt-rendering.pdf`), beside a corrupt and an encrypted PDF that must answer `unavailable`.

So a multi-PDF *excerpt* batch, and a multi-PDF *note* batch, are not reachable on this corpus at all: there is one PDF to render excerpts from, and one note that embeds them. Those rows stay modelled above.

### Real PDF work: loads, renders, hits

Measured by `packages/e2e/src/excerpt-acceptance.ts` in the End-to-end Run of this worktree (`pnpm exec vitest run --disableConsoleIntercept -t "crops from an open reader's document"`), from the renderer's own counters (`ExcerptRendererDiagnostics`, the same counters the Node harness stands in for) plus the resolution each request reported:

| Pass | Crops drawn | PDF files opened | PDF documents loaded | Resolved from the cache |
| --- | --- | --- | --- | --- |
| Reader-backed crop (an open reader's own document) | 1 borrowed | 0 | 0 | 0 |
| Note import over the warm cache (3 embedded Annotations prepared) | 0 | 0 | 0 | every excerpt it resolved |
| Detached fallback (reader closed, card Refresh) | 1 detached | 1 | 1 | 0 |

The third row is the same request the first row answered, after the reader was gone: the crop is re-rendered from the file, and its decoded pixels are identical to the borrowed crop's — both decoded to 201 × 192 with pixel digest `8eb22d6a…`, which is the reader/detached parity the shared cache publication rests on.

### Real batch time

| Pass | Requests | Renders | Cache hits | Total |
| --- | --- | --- | --- | --- |
| Cold, one PDF, 9 cases | 9 | 9 | 0 | 3426 ms |
| Warm, same 9 cases | 9 | 0 | 9 | 363 ms |
| Re-render after a clear | 1 | 1 | 0 | 257 ms |
| Cold again in a minimized window | 9 | 9 | 0 | 9 renders, same pixels |

`verifyExcerptRendering` in the End-to-end Run (`pnpm exec vitest run --disableConsoleIntercept -t "deterministic PDF matrix"`; the flag is what prints the evidence on a run whose case passes) reports these through its own evidence line — emitted as soon as the batch result exists, before the memory probes that can fail. No PDF reader leaf is open in any pass (`pdfLeaves` `{ before: 0, after: 0 }`), and the corrupt and encrypted PDFs answer `unavailable`. Each pass's number covers resolving a case *and* decoding, digesting and sampling its image, so it is a pass time rather than a bare cache-hit latency.

### First-note completion

The Fixture corpus's one excerpt-bearing note, imported over the warm cache (all three embedded Annotations already resolved), settled in **15 677 ms** — from the app job starting (its `noteIndex.whenIndexed()` wait included) to the app's own settlement flag — and every one of its excerpts came from the cache, with no PDF opened and no crop drawn during the import. That is a *single* note over a *single* PDF: the corpus has no multi-PDF note batch to time, which is the row this record cannot fill.

### Peak memory

`process.getProcessMemoryInfo()` — the probe `verifyExcerptRendering` uses — is unreliable in this environment: the run above reported it for the maximum-pixels case (private 326 866 KiB / 329 602 KiB / 328 114 KiB, before / during / after the canvas) and then resolved it to `null` for the maximum-dimension case, which fails that case at the tip (a pre-existing failure, not one this record's section introduces). The renderer's own Node measurement does answer, so the reader-backed evidence records `process.memoryUsage()` around the note import: RSS 629 866 496 B → 631 701 504 B, `heapUsed` 94 692 884 B → 98 127 192 B (≈ 600.7 → 602.5 MiB RSS, 90.3 → 93.6 MiB heap). Those are one window's process numbers around a warm import, not a peak over a cold multi-PDF batch, and the harness's heap/RSS rows above stay the modelled ones.

### What is measured for real, and what is not

| The criterion asks for | How it is answered |
| --- | --- |
| Cold and warm batches | Real: 9 cases cold (3426 ms) and warm (363 ms) through the app; modelled at scale in the Node tables above |
| Multi-PDF batches | **Modelled only**: the Fixture corpus's excerpt-able Annotations and its excerpt-bearing note all live on one PDF |
| Repeated same-PDF excerpts | Real: the three embedded Annotations of `RGRPDF24`, resolved one after another and then reused by the import |
| Loads | Real: PDF file opens and document loads from the renderer's counters (table above); modelled per resident-document change in the Node tables |
| Renders | Real: crops counted as borrowed + detached from the same counters; the renderer's counter peaks at one at a time |
| Hits | Real: the warm import resolved its excerpts with no crop drawn and no PDF opened, and the warm pass answered all 9 cases from the cache; modelled as retention/cache decisions in the Node tables |
| Total time | Real: the pass times and the first-note completion above; modelled wall times carry the 40 ms/12 ms costs |
| First-note completion | Real for one note over one PDF (15 677 ms, warm, the job's index wait included); **not measured** for a multi-PDF batch — no such batch exists in this corpus |
| Peak memory | Partly: the renderer's own `process.memoryUsage()` around the import above; `process.getProcessMemoryInfo()` answers `null` here, and the harness numbers stay the Node process's |
| Corpus and runtime details | Real: the corpus counts and key names above; runtime Electron 43.7.1 / Chromium 150.0.7871.250 / Node 24.21.0 under desktop Obsidian 1.14.2 |

## The runtime this record is against

Run date **2026-09-21**. Every number below was measured in one process.

| Component | Version |
| --- | --- |
| Node | v26.9.0 |
| Vitest | 4.1.6 |
| `p-queue` | 9.3.3 (the scheduler under test) |
| Machine | Apple M4 Pro, macOS (darwin 27.0.0), arm64 |
| Obsidian / Electron / Chromium | not involved in the Node passes; the minimized-window section below ran Electron 43.3.0 / Chromium 150.0.7871.212 |

## The corpus

24 notes × 3 annotations = 72 distinct excerpts over 6 PDFs, notes admitted at concurrency 16, each note awaiting only its own excerpts. Two arrival shapes:

- **Interleaved** — note *n* belongs to PDF *n* mod 6, so six PDFs are in flight at once.
- **Grouped** — each PDF's four notes arrive together.

The repeated-PDF pass is different on purpose: 20 excerpts of **one** PDF, one at a time.

## Cold, warm, and repeated batches

Method: one measurement pass per row, each pass with its own renderer stand-in; `cold` and `warm` share one cache, the other two start empty. `Loads` counts resident-document changes, `Renders` counts crop renders started, `Hits` counts requests served from the cache without PDF work.

| Pass | Excerpts | Loads | Renders | Hits | Total ms | First note ms |
| --- | --- | --- | --- | --- | --- | --- |
| Cold, interleaved | 72 | 24 | 72 | 0 | 1929–1970 | 82–87 |
| Cold, grouped | 72 | 26 | 72 | 0 | 2039–2044 | 83–84 |
| Warm (same corpus, warm cache) | 72 | 0 | 0 | 72 | 1.7–5.3 | 0.6–2.2 |
| Repeated single PDF, cold | 20 | 1 | 20 | 0 | 318–320 | 54–55 |

A warm batch is pure cache: no document is loaded, no crop is rendered, and the whole 72-excerpt batch settles in single-digit milliseconds, four orders of magnitude below the cold pass that paid 24 loads.

Grouping a PDF's notes together did **not** reduce loads (26 versus 24). That is the affinity rule working as designed rather than as an optimization: the queue gives a waiting PDF its turn after four consecutive jobs, so when several PDFs are in flight the round-robin reloads the resident document on each switch. Affinity bounds how long one PDF can hold the load, which is a fairness property; it is not a load-count optimization. The single-PDF pass shows the other side: one load served all 20 excerpts.

## Queue bounds and memory

Method: peaks sampled after each excerpt settles — `Queue admitted` reads the queue's own admitted count, `Render peaks` the renderer stand-in's own counter, heap and RSS `process.memoryUsage()`.

| Measurement | Method | Cold, interleaved | Cold, grouped | Warm | Repeated PDF |
| --- | --- | --- | --- | --- | --- |
| Peak concurrent renders | renderer counter | 1 | 1 | 0 | 1 |
| Peak admitted jobs | queue diagnostic, sampled | 45 | 45 | 0 | 0 |
| Peak heap | sampled heapUsed | 57.7 MiB | 57.7 MiB | 24.8 MiB | 26.1 MiB |
| Peak RSS | sampled rss | 194 MiB | 194 MiB | 154–180 MiB | 154–180 MiB |

One crop rendered at a time in every pass, which is the queue's initial concurrency of one holding across 16 concurrent note producers. The admitted peak of 45 is below the 128 bound because with 16 notes × 3 excerpts the corpus never approaches it; the bound itself is asserted by the queue's own tests (`pdf-queue.test.ts`), not by this corpus.

## A cache hit while a crop render is blocked

Method: one service renders an unrelated excerpt and is held inside its render; the same service then resolves an already-cached excerpt, and the harness times that resolution.

| Observation | Value |
| --- | --- |
| Cache hit latency while the render was blocked | 0.04–0.11 ms |
| Render still started and blocked at that moment | yes |

Freshness and cache checks run on their own bounded queue before admission, so a hit neither waits for the PDF slot nor takes one. This is the ADR's "a valid cached image can complete while an unrelated PDF is rendering", measured end to end through the production service.

## The queue in a minimized Chromium window

The passes above are scheduling in Node. `queue-chromium.test.ts` measures the other half of the same queue inside Chromium: it bundles `queue-chromium.browser-test.ts` and runs it in a disposable Electron renderer whose window the fixture shows off-screen and then minimizes. Every job in the batch draws a crop on a real canvas and encodes it with the production `encodeExcerptImage`; 130 producers over 5 PDFs start together, which is two past the admitted bound.

The window is minimized because that is the state "minimized Obsidian operation" names, and Chromium reports such a page **hidden** and clamps its timers — which the trial measures rather than assumes. Method: the fixture reports the page's `visibilityState`, and the trial times a 200 ms `setTimeout` and a 200 ms `AbortSignal.timeout` inside the same window before it returns.

```sh
cd apps/obsidian
ZOTLIT_TEST_ELECTRON_PATH=<Electron.app>/Contents/MacOS/Electron \
ZOTLIT_QUEUE_CHROMIUM_MEASUREMENTS_OUT=../../tmp/queue-chromium-measurements.json \
  pnpm exec vitest run src/services/excerpt-image/queue-chromium.test.ts
```

It skips cleanly without `ZOTLIT_TEST_ELECTRON_PATH`, so it never runs in CI. The record is printed to stdout either way; `ZOTLIT_QUEUE_CHROMIUM_MEASUREMENTS_OUT` only writes it to a file, and names a path relative to `apps/obsidian`, so `../../tmp` is the workspace root's gitignored `tmp/` ([scratch artifacts](../policies/scratch-artifacts.md)).

Run date **2026-09-21**, one process, on the machine above.

| Observation | Value |
| --- | --- |
| Page visibility in the trial window | `hidden` |
| Excerpts admitted / rendered | 130 / 130 |
| Producers past the bound that waited | 2 |
| Peak admitted jobs | 128 |
| Peak concurrent canvas renders | 1 |
| Bytes encoded across the batch | 286 776 |
| Wall time for the batch | 570 ms |
| Cache hit while a render was blocked | 0.10 ms, answered while still blocked |
| 200 ms `setTimeout` in this window | 837 ms |
| 200 ms `AbortSignal.timeout` in this window | 837 ms |

Three properties of the app's bounds follow from those numbers:

- **Progress does not run on timers.** The 130-excerpt batch finished in 0.57 s in a window whose timers are clamped to roughly 0.8 s, and it encoded the same byte count an unthrottled run of the same trial encodes (286 776). Chromium rasterization and encoding are not timer-driven, so a minimized Obsidian slows the *precision* of the two deadlines the excerpt path sets (the job deadline and the 5 s teardown bound) — a throttled deadline fires late, never early.
- **The bound decides in-app exactly as it does in Node.** Admitted peaked at 128 with no crop started for the two producers past it, and both ran once slots returned: a full queue waits in Chromium too, instead of answering `unavailable`.
- **One crop at a time, and a cache hit never queues behind it.** The renderer's own counter peaked at 1 across 130 jobs, and a request answered from stored bytes resolved in 0.10 ms while a render held the slot.

The trial asserts those properties (and `visibilityState`) and throws rather than reporting if any of them breaks, so the numbers above are the shape of a passing run.

## A re-run after the admission diagnostics landed

The Node passes were re-measured after the queue gained its admission diagnostics and the corrected admission comment — no scheduling change — with the workspace `tmp/` recipe above, on the same machine while other builds were running. Every count came back identical: 24 loads / 72 renders / 0 hits cold interleaved, 26 / 72 / 0 grouped, 0 / 0 / 72 warm, and 1 load with 20 renders for the repeated PDF, with the same peak render (1) and peak admitted (45) values. Wall times ran 2–5 % above the recorded ceilings (cold interleaved 2019 ms, grouped 2102 ms, repeated PDF 326 ms), which is machine load rather than a scheduling difference; the counts are what the record claims.

## What remains unverified

- **Obsidian's own rendering at scale.** *The real app's own numbers* above are the Obsidian half of this record: real PDF.js loads, crops, cache hits, pass times and one note's completion, measured through the End-to-end Run on this machine. What that corpus cannot reach is scale and variety — its excerpt-able Annotations all live on one PDF, so multi-PDF batches and a multi-PDF note batch stay modelled here, and peak memory has only the renderer's own `process.memoryUsage()`, because `process.getProcessMemoryInfo()` resolves to `null` in this environment.
- **The plugin's real store and corpus.** The Node passes use an in-memory `Map` behind the production `ExcerptCache` contract; IndexedDB storage, vault writes, and a real Zotero corpus with real PDFs are not measured here. The End-to-end Run's numbers above use the plugin's real IndexedDB store and a real vault, but a synthetic corpus.
- **Where those are verified.** On a machine with desktop Obsidian and a running Zotero: `pnpm fixture open --local-api`, then `pnpm e2e`. `packages/e2e/src/excerpt-rendering.ts` is their acceptance — it clears the excerpt cache and renders each case cold with `pdfLeaves` asserted `{ before: 0, after: 0 }` (no PDF reader open), then warm (every case `provenance: "cache"` with identical pixels), then re-renders, then repeats the cold pass in a minimized window and requires the same pixels with `provenance: "rendered"`. See the [release checklist](release-checklist.md).
- **Why the minimized-window pass was not run here.** The Electron half of the minimized-window section ran in a disposable renderer rather than through the suite's own pass, because this worktree's `electron` package carries no downloaded binary ([`allowBuilds`](../pnpm-workspace.yaml) refuses its postinstall); its numbers are the trial's, not the End-to-end Run's.
