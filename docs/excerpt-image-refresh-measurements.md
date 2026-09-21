# Excerpt Image refresh and restart measurements

This record answers the questions behind [ADR 0055](../apps/obsidian/docs/adr/0055-reader-edits-revalidate-excerpt-images.md) and ticket #1187: what a saved edit costs when no card displays the Annotation, what a reopened view paints before the current pixels resolve, what the device-local image budget does to the latest-image references beside it, and what a manual clear takes with it. The numbers come from `apps/obsidian/src/services/excerpt-image/refresh.browser-test.ts`, which drives the production `ExcerptImageService`, `ExcerptDisplayService`, `QueryClientService`, `openExcerptStore`, and `encodeExcerptImage` in a disposable Electron renderer, over Chromium's own IndexedDB. `refresh.test.ts` is the acceptance that runs that trial and asserts the record's shape.

## How to run it again

```sh
cd apps/obsidian
ZOTLIT_TEST_ELECTRON_PATH=<Electron.app>/Contents/MacOS/Electron \
ZOTLIT_REFRESH_MEASUREMENTS_OUT=../../tmp/refresh-measurements.json \
  pnpm exec vitest run src/services/excerpt-image/refresh.test.ts
```

The suite skips unless `ZOTLIT_TEST_ELECTRON_PATH` names an installed Electron, so it never runs in CI. The record is printed to stdout either way; `ZOTLIT_REFRESH_MEASUREMENTS_OUT` only writes it to a file, and names a path relative to `apps/obsidian`, so `../../tmp` is the workspace root's gitignored `tmp/` ([scratch artifacts](../policies/scratch-artifacts.md)). Two runs on this machine produced byte-identical records.

## The runtime this record is against

Run date **2026-09-21**. Every number below was measured in one run of one renderer.

| Component | Version |
| --- | --- |
| Node | v26.9.0 (bundles the trial and runs Vitest; the trial itself runs in the renderer) |
| Vitest | 4.1.6 |
| Electron / Chromium | 43.3.0 / 150.0.7871.212 (the renderer the trial runs in) |
| Machine | Apple M4 Pro, macOS 27.0 (build 26A428), darwin 27.0.0, arm64 |
| Cache keys under test | the browser trial's own hasher: 64-bit FNV-1a in place of `node:crypto`'s SHA-256 |
| Store | the plugin's own IndexedDB schema v2, opened at a two-crop budget instead of the production 256 MiB |

## What is real in this trial, and what stands in

The production halves:

- **IndexedDB is Chromium's own.** The store is the production `openExcerptStore`: real read-write transactions, the real `accounting` record, the real least-recently-used walk over the `images.access` index, and the production rule that evicting an image deletes the `latest` references that locate it.
- **The service, the display, and the query client are the shipped classes**, over the real persistent store — so a reference write, a cache read, a Held Read, and a clear are the plugin's own code paths.
- **Every crop is encoded by the production encoder**: `encodeExcerptImage`, lossless WebP, on a real Chromium canvas. The bytes this record counts are real encoded bytes.

The stand-ins:

- **No PDF is opened.** `__fixtures__/renderer-host.ts` replaces the PDF.js host, the filesystem, `node:zlib`, and the Zotero database with functions that throw, so a path needing one fails loudly rather than passing quietly. The trial's own `render` is a gate: the trial decides when a resolve answers and with which drawing. A "crop" here is therefore the trial's drawing of a 320×120 canvas from a seed, not a rasterized page.
- **The key hasher is not SHA-256.** Chromium has no synchronous SHA-256, so `__fixtures__/renderer-hash.ts` answers `createHash` with 64-bit FNV-1a. Every identity claim below is about two requests hashing alike or differently, never about a digest's cryptographic property.
- **A restart is a fresh service and display over the same IndexedDB**, not a new process: the trial closes one composition and opens the next over the database the first one wrote, which is exactly the state an application restart leaves behind.
- **No Obsidian window.** The card is `ExcerptDisplayService.open()`; the React view is not mounted. What the view does with a moved snapshot — keeping the previous object URL while a replacement runs, releasing it the moment the image it was made from is replaced — is covered by `excerpt-image-state.test.ts`.

## The record one run produced

```json
{
  "passed": [
    "one resolution over the real store",
    "inactive replacement through the shared queue",
    "restart paints the stored image, then replaces it",
    "eviction, references, and image byte accounting",
    "clear races with running and queued crop work"
  ],
  "bytes": {
    "budget": 1468,
    "crop": 734
  },
  "queue": {
    "admitted": 0,
    "rendering": 0,
    "queued": 0,
    "checking": 0,
    "awaiting": 0,
    "limit": 128
  },
  "references": 40,
  "crops": 8
}
```

| Measurement | Value | Where it comes from |
| --- | --- | --- |
| Crops drawn and encoded | 8 | the trial's own counter, incremented by every crop it answers a resolve with |
| One crop, encoded | 734 B | a 320×120 lossless-WebP drawing of the trial's seed |
| Image budget the eviction walk ran under | 1468 B | two crops, deliberately small so one eviction happens inside one trial |
| Images the walk wrote | 3 | the walk's own writes, one of which the budget evicted |
| Images evicted | 1 | the oldest, together with the reference that located it |
| References still standing | 40 | read back from the store after the walk |
| Shared queue after the replacements | admitted 0, awaiting 0, limit 128 | the production `ExcerptPdfQueue` diagnostics, sampled when the inactive replacements settled |
| Wall time | not recorded | this trial is not a performance record; the Vitest case that runs it reported 445–629 ms across two runs, including bundling the entry with Vite and launching Electron |

The five labels are the trial's own scenario checkpoints: it throws on the first failed check, so a returned report of five labels is the shape of a run that finished every scenario.

## What each scenario settles

**One resolution over the real store.** One `resolve` renders a crop (734 B), stores it, and remembers which image the Annotation has: the reference under the Annotation's record carries the canonical cache key, and the second `resolve` of the same pixels answers from the store instead of rendering again. The bytes that reach the store are the encoder's own output, so the store's accounting and the reference it publishes agree about one real image.

**Inactive replacement through the shared queue.** A saved edit to an Annotation no card displays replaces the stored image through the shared `p-queue`, under its admitted bound (128), and an Annotation this device never displayed is left alone: it neither renders nor gains a reference. After the replacements settle, the queue reports nothing admitted, rendering, queued, checking, or awaiting.

**Restart paints the stored image, then replaces it.** A fresh display over the same IndexedDB paints the stored image while the Annotation's current pixels resolve, marked `current: false` and `status: "reading"`, and then the current crop replaces it. The check compares the painted bytes with the stored entry's bytes element by element rather than by length, because a fresh render of the saved pixels is the same size and a different image.

**Eviction, references, and image byte accounting.** The walk writes 40 references for Annotations that hold no image, then writes crops until the budget evicts: 3 crops of 734 B through a 1468 B budget evict exactly the oldest image, and its reference goes with it (the store deletes the references that locate an evicted key). The 40 references that locate no image cost the image budget nothing — they all stand after the walk, and the crop written after them still fits.

**Clear races with running and queued crop work.** A manual clear lands while one crop runs and one waits for a slot. It removes the Held Reads (`keysUnder([EXCERPT_DISPLAY])` is empty), the image entries, and the references; the crop work it overtook restores none of them; and a card mounted at clear time stops painting the cleared image, which the trial checks on the card's own snapshot rather than on the query cache alone.

## What this record does not cover

- **Real crop cost and real crop bytes.** No PDF is parsed, no page is rasterized, and no borrowed reader document is involved. 734 B per 320×120 drawing is a property of the trial's own drawing; a real excerpt's size and encoding cost depend on the page, the display scale, and the region. The queue's own record covers what the shared scheduler does with real Chromium crops ([Excerpt Image queue measurements](excerpt-image-queue-measurements.md)).
- **The persistence behind the reference across a real application restart.** The store is real, but the process is not restarted and no Obsidian window is opened; the trial models the restart by opening a fresh service and display over the same database.
- **Durable note assets and Zotero-owned cache content.** Clear must preserve both; that needs a vault and a Zotero data directory, so it is covered where those exist (`service.test.ts`), not here.
- **The minimized-window half.** This trial runs in a hidden but unminimized renderer, so Chromium's background throttling is not in play; `queue-chromium.test.ts` measures the queue in a minimized window ([Excerpt Image queue measurements](excerpt-image-queue-measurements.md)).
- **The real application.** On a machine with desktop Obsidian and a running Zotero: `pnpm fixture`, then `pnpm e2e`, whose excerpt acceptance is `packages/e2e/src/excerpt-rendering.ts` (see the [release checklist](release-checklist.md)). That run is the boundary for rendering cold, reusing a warm cache, and re-rendering in a minimized window against real PDFs.

## See also

- [Excerpt Image queue measurements](excerpt-image-queue-measurements.md), for the shared queue these replacements run through, including the minimized-window pass.
- [Excerpt Image reuse measurements](excerpt-image-reuse-measurements.md), for the identity that lets two Annotation Sources reach one cache entry.
- [Excerpt Image WebP measurements](excerpt-image-webp-measurements.md), for what the retained bytes cost once they are encoded.
- [Excerpt Image batch retention measurements](excerpt-image-batch-measurements.md), for the in-memory half of the retention this store backs.
