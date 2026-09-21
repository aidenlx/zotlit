# Excerpt Image reader-borrow measurements

This record answers the questions behind [ADR 0054](../apps/obsidian/docs/adr/0054-reader-and-detached-excerpts-share-cache-publication.md): when an open PDF reader lends its document to excerpt work, how many PDF documents still get loaded, what does the revision proof cost, and does a later import reuse what the reader produced. The numbers come from `apps/obsidian/src/services/excerpt-image/borrow-measurements.ts`, which drives the production `ExcerptImageService` and the production `ExcerptRenderer` over real files with a stand-in for the reader Obsidian would hold open.

## How to run it again

```sh
cd apps/obsidian
ZOTLIT_BORROW_MEASUREMENTS=1 \
ZOTLIT_BORROW_MEASUREMENTS_OUT=../../tmp/borrow-measurements.json \
  pnpm exec vitest run src/services/excerpt-image/borrow-measurements.test.ts
```

The suite skips unless `ZOTLIT_BORROW_MEASUREMENTS=1`, so it never runs in CI; `ZOTLIT_BORROW_MEASUREMENTS_OUT` is optional and just writes the record to a file. It names a path relative to `apps/obsidian`, so `../../tmp` is the workspace root's gitignored `tmp/` ([scratch artifacts](../policies/scratch-artifacts.md)). Two runs on this machine reproduced every count exactly (the wall times below are the second run's).

## What the harness models, and what it does not

- **The revision proof is real.** Files are real files on disk; the reader's document answers `getData()` with the bytes its load would have read; the comparison is the production one — SHA-256 over the document's bytes against a stable, size-and-mtime-checked read of the file. Counts of `documentBytes` are therefore the number of revision proofs actually taken.
- **PDF work is modelled.** A counting stand-in replaces PDF.js: one "document load" charges 40 ms, one crop render charges 12 ms. The real renderer's costs are Chromium rasterization plus Obsidian's own PDF.js document, neither of which exists in Node. Load/render/hit counts are properties of the code under measurement; the wall times carry the modelled 40 ms/12 ms on top of real scheduling and real hashing.
- **The canvas is a stand-in** that returns the lossless-WebP fixture at the requested size, because Node has no canvas encoder.
- **The cache is the same interface, not the same store.** Requests go through the production preflight and the production `ExcerptCache` contract against an in-memory `Map`, not the plugin's IndexedDB store.

## The runtime this record is against

Run date **2026-09-21**. Every number below was measured in one process.

| Component | Version |
| --- | --- |
| Node | v26.9.0 |
| Vitest | 4.1.6 |
| `p-queue` | 9.3.3 (the scheduler the excerpt path runs on) |
| Machine | Apple M4 Pro, macOS (darwin 27.0.0), arm64 |
| Obsidian / Electron / Chromium | not involved (see "Real Obsidian" below) |

## The corpus

3 PDFs × 4 annotations = 12 distinct excerpts, each file 64 KiB of deterministic bytes, every excerpt resolved together. One reader document per PDF holds the bytes that PDF had when the reader opened it.

## Reader open, no reader, and the import that follows

Method: one pass per row, each pass a fresh service (and fresh cache unless named). `Loads` counts PDF.js document loads, `Renders` counts crop renders started, `Hits` counts requests answered from the cache without PDF work, `Proofs` counts `getData()` reads taken from reader documents.

| Pass | Excerpts | Loads | Renders | Hits | Proofs | Total ms |
| --- | --- | --- | --- | --- | --- | --- |
| Reader open, documents current | 12 | **0** | 12 | 0 | 3 | 165.8–169.5 |
| No reader (every excerpt reads the file) | 12 | 3 | 12 | 0 | 0 | 284.5–305.9 |
| Import after the reader, cache warm | 12 | 0 | 0 | 12 | 0 | 0.5–0.6 |
| Reader open, one PDF changed on disk | 12 | 1 | 12 | 0 | 1 | 209.2–210.8 |
| One PDF again, its document already proven | 4 | 0 | 4 | 0 | 0 | 54.6–56.3 |

What the rows say:

- **A compatible reader removes the PDF loads.** 12 excerpts cropped from three open documents cost zero document loads, against three for the same corpus with no reader — and each of those three is one parse of one file, reused by that file's other excerpts (the resident-document session of ADR 0052).
- **The wait is one proof per document, not one per crop.** Three `getData()` reads covered 12 excerpts (`Proofs` 3), because a document proven against a file revision stays proven while that file's size and modification time do not move.
- **The proof is amortized, not repeated.** The second pass over one PDF — its document already proven earlier in the process — took zero proofs and zero loads.
- **The import that follows the reader is pure cache.** 12 hits, no loads, no renders, and the whole pass settles in about half a millisecond: the reader-backed crop published under the same `excerptKey`, so the database-backed import never asks for the file at all.
- **A changed file is refused, not trusted.** After rewriting one PDF's bytes in place (same length, every byte different), only that file was loaded again — one document for its four excerpts — while the two unchanged PDFs kept borrowing. The stale document's own bytes were re-proven against the moved file exactly once (`Proofs` 1), and the borrowed path never served the old revision.

## What this record does not cover

- **Absolute crop cost.** The modelled 12 ms stands in for Chromium rasterizing a crop off a borrowed page; the real number depends on the page and the display scale.
- **Memory.** A borrowed crop holds no document of its own, but `getData()` does make the reader's document read its whole stream in the worker. That cost is per document and per session; this harness does not sample it.
- **Queue bounds and fairness.** Those are [ADR 0052](../apps/obsidian/docs/adr/0052-pdf-excerpt-work-uses-a-shared-dedicated-queue.md)'s record (`docs/excerpt-image-queue-measurements.md`). Borrowed crops are admitted through the same `ExcerptPdfQueue`, and the controlled acceptance in `renderer-borrow.test.ts` asserts one borrowed crop at a time and the PDF affinity turn a borrowed crop yields to a detached one; this harness resolves each corpus together and sees the same serialization.

## Real Obsidian

Real-desktop acceptance was **not** run for this record. It needs the Fixture Vault, a running Zotero with the Local API, and a desktop Obsidian window — the `packages/e2e` boundary (`packages/e2e/src/excerpt-rendering.ts` is the existing helper for it, and it drives `services.excerptImage` through the Obsidian CLI). It was not run here because it retargets the user's running Obsidian at a fixture vault and needs a live Zotero session, which is the coordinator's run, not a ticket worktree's.

The command that runs it, from the repository root, against a running desktop Obsidian with the CLI enabled:

```sh
pnpm fixture
pnpm e2e
```

### What that run has to settle, and why this record cannot

Four cases need the real app. Each is named with what is missing in-process; none of them is faked or skipped silently here.

| Case | Why Node cannot decide it | Where the run settles it |
| --- | --- | --- |
| Cold or minimized fallback | `borrowDocument()` answers `null` for a view whose PDF viewer child Obsidian never built; whether a minimized or background window builds it at all is Obsidian's own behaviour, and the acceptance has to minimize a real window to find out | `packages/e2e/src/excerpt-rendering.ts`'s minimized tier, which minimizes the Electron window and expects the same resolved excerpts |
| A reader open before plugin startup | A document loaded before the plugin loaded is a real Obsidian load order, not a test ordering; the plugin's own suites model it (`pdf-annotation-editor/borrow.test.ts` lends such a document, `renderer-borrow.test.ts` refuses one whose bytes moved on) | the End-to-end Run, over a Vault whose PDF the reader had open before the plugin enabled |
| A compatible reader avoids another PDF load | Counts real PDF.js document loads in the running app, next to Obsidian's own viewer document | the End-to-end Run, comparing that count against the detached path |
| A later database-backed import reuses the reader's entry | Needs the real cache (`IndexedDB` behind the plugin), a real reader crop, and a real batch import afterwards | the End-to-end Run, over the Fixture's own Zotero data |

The closest available evidence, in place of that run:

1. **The borrowed bytes come from the build Obsidian actually ships.** In the installed Obsidian 1.14.2 (`/Applications/Obsidian.app/Contents/Resources/app.asar`, extracted to `node_modules/.ob-rev-1.14.2/`), `lib/pdfjs/pdf.min.mjs` carries `PDFDocumentProxy.getData() { return this._transport.getData(); }` and the worker answers `GetData` with `requestLoadedStream().then((stream) => stream.bytes)`; `NetworkPdfManager.requestLoadedStream` is `streamManager.requestAllChunks()`, so a document loaded from Obsidian's `app://` resource URL reads its remaining bytes and answers the whole stream. Obsidian opens a PDF with `pdfViewer.open({ url: vault.getResourcePath(file) })` (`app.js`, the PDF view's `loadFile`), which is that URL path.
2. **The revision proof, the fallback, and the cache reuse are covered by controlled acceptance** in the plugin's own suites: `reader-borrow.test.ts` (bytes equal the file's, same-size different bytes refused, a moved file re-proven, a replaced document borrowed again, a closed reader withdrawn, an oversized file refused, and an open cancelled in flight closing its handle), `renderer-borrow.test.ts` (a reader-backed crop takes no document load, publishes the bytes and cache identity the detached path publishes, falls back on an unproven, absent, closed, or pre-startup-and-stale document, cancels with its caller, keeps the queue's one-crop-at-a-time admission, and gives another PDF its turn after four borrowed crops), and `pdf-annotation-editor/borrow.test.ts` (the registry's accessor, a document loaded before the plugin started, closure, replacement, and the reader's own surfaces staying untouched).
