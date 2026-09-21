# Excerpt image reuse measurements

This record answers the evidence [issue #1182](https://github.com/aidenlx/zotlit/issues/1182) asks of the shared Excerpt Image: for one Annotation reached first through the Zotero Local API and then through the Zotero database, what each representation loads, renders, and hits in the cache. It backs the identity that [ADR 0050](../apps/obsidian/docs/adr/0050-excerpt-cache-identity-is-shared-across-verified-annotation-sources.md) shares across verified sources and the preflight that [ADR 0052](../apps/obsidian/docs/adr/0052-pdf-excerpt-work-uses-a-shared-dedicated-queue.md) keeps off the PDF queue.

**The numbers below come from controlled doubles, not from a real PDF.** These trials run under Vitest in Node, with injected freshness, render, and cache doubles, and — for the renderer trial — the PDF.js host doubles in `renderer.test.ts`. No Electron, Obsidian, or Chromium process takes part, no PDF page is parsed, and no canvas is allocated. They therefore say how many loads, renders, and cache hits the pipeline asks for, and nothing about how long a real render takes or how large it is. The real stack those doubles stand in for is measured live in [PDF annotation probes](pdf-annotation-probes.md).

## How to run it again

```sh
cd apps/obsidian
pnpm exec vitest run src/services/excerpt-image
```

The pair trial is `reuses one render for an API request followed by a database request` in `request.test.ts`, its renderer half is `keeps one resident document across the two representations of a database` in `renderer.test.ts`, and the admission bound is measured by two trials in `service.test.ts`: `returns a stored cache hit while every admission slot is taken` and `gives back the slot a stored cache hit took`. The two Electron browser trials in the same directory skip unless `ZOTLIT_TEST_ELECTRON_PATH` points at an Electron build, which is the state this record was taken in.

## The runtime this record is against

Run date **2026-09-21**. Every number below was measured on one machine, in one process.

| Component | Version |
| --- | --- |
| Node | 26.9.0 (`darwin-arm64`) |
| Test runner | Vitest 4.1.6 |
| Machine | Apple M4 Pro, macOS 27.0 (build 26A428), arm64 |
| Zotero schema | the in-memory fixture schema `createFixtureSchema` builds, one Attachment `ATCH2345` with `storage:paper.pdf` |
| Real PDF | none — the refresher double returns a fixed 3-byte payload |
| Standing in for | Obsidian 1.14.x with Electron 43.3.0 / Chromium 150.0.7871.212, as measured live in [PDF annotation probes](pdf-annotation-probes.md) |

## One Annotation, two representations

The API request carries a `zotero-local-api` source naming Server ID `A8sf5Zsz8ySw`; the database request carries the `zotero-db` source of the database that Server ID names. Both resolve the same Attachment, Annotation, Library, and pixel inputs, so both hash to one `excerptKey` — the trial asserts the equality, and every number below depends on it.

| Step | Provenance | PDF loads | Renders | Cache reads | Cache hits | Cache writes |
| --- | --- | --- | --- | --- | --- | --- |
| API request | `rendered` | 1 | 1 | 1 | 0 | 1 |
| Database request | `cache` | 0 | 0 | 1 | 1 | 0 |

Totals for the pair: **1 load, 1 render, 1 cache hit**. The database representation reaches the bytes the API representation generated without re-entering the refresher.

The provenance column, the render count, and the load column are the committed assertions: `request.test.ts` pins `provenance: "rendered"` then `provenance: "cache"` and `render` called once, and `renderer.test.ts` pins one `getDocument` for the pair — the step split of those totals follows the provenance each step reports. The cache-read, cache-hit, and cache-write counters come from an instrumented copy of that trial — the same doubles with counters attached — because call counts on doubles are not something the suite asserts.

## The renderer keeps one document across both representations

Method: one `ExcerptRenderer` renders the API request and then the database request, with the PDF.js host doubled (`loadPdfJs`, document, pages, canvas) so each call is counted rather than performed.

| Observation | Total for the pair |
| --- | --- |
| `loadPdfJs` calls | 1 |
| `getDocument` calls | 1 |
| Page objects handed to the renderer | 2 — page 1 once per representation |
| Files opened | 2 — one per representation |
| PDF byte reads across those opens | 2 (chunked) on the first, 0 on the second |
| Documents destroyed before disposal | 0 |

The second open reads no bytes: the document the first call loaded is still resident and answers for the second source. The pair ends with one destroy, when the renderer is disposed.

## A stored excerpt answers while every admission slot is taken

Method: one annotation is rendered and stored, then 128 distinct annotations are admitted and each render is held open, then the stored annotation is requested again. The first blocked render is the signal that the bound is full.

| Observation | Value |
| --- | --- |
| Admitted PDF jobs | 128 |
| Renders started while blocked | 1 |
| Stored excerpt on the second request | `provenance: "cache"` |
| Renders caused by that request | 0 |
| Total renders after the bound is released | 129 (128 admitted + the one that stored the bytes) |

A stored excerpt answers while the bound is full: the preflight runs before the refusal, so the bound decides only for work that would render, never for bytes that already exist.

## What this record does not say

- **No real PDF, no real renderer.** The refresher double returns three bytes; the renderer trial doubles PDF.js. Nothing here measures rasterization, encoding, or memory.
- **No vault.** These trials resolve excerpts in memory; the durable asset write and the retention of an image an earlier release named are covered by `materialize.test.ts`.
- **No real application.** The real-app counterpart is `packages/e2e/src/excerpt-rendering.ts`, which runs cold, warm, and re-render passes in a real Obsidian window on a developer machine through `pnpm e2e` (see [release checklist](release-checklist.md)). It is not part of this record.

## See also

- [Excerpt image WebP measurements](excerpt-image-webp-measurements.md), for what the stored bytes cost.
- [PDF annotation probes](pdf-annotation-probes.md), for the live Obsidian/Electron/Chromium record these doubles stand in for.
