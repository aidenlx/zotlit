---
status: accepted
---

# Pandoc Engine binary stays in OPFS

The Pandoc Engine binary (~58 MB `pandoc.wasm`) stays in OPFS, content-addressed with the temp-write → verify → rename install. Cache API and IndexedDB were evaluated as replacements and rejected on measurements taken in the live Obsidian renderer (Electron 43 / Chromium 150): every axis that could separate the backends came out equal or in OPFS's favor.

The candidate advantage of Cache API was V8's persistent WebAssembly code cache. Measurement shows it cannot deliver here:

- The code cache keys on a real fetched resource URL. A synthetic `Response` stored via `cache.put` comes back from `caches.match()` with an empty `.url` and is permanently ineligible — and the install pipeline is forced into synthetic Responses, because the upstream asset is a `.wasm.zip` that is unzipped and hash-verified before storage.
- Even a genuine network-backed Response never shortened a fresh compile: `compileStreaming` stayed at its no-cache baseline across reloads. Executing real conversions did write a code-cache entry, but only ~3.3 MB of hot functions out of 58 MB; the measured benefit was ~34 ms on the first conversion of a session.
- Reads are identical (~30 ms for the full binary from either backend), and all three backends share one per-origin quota bucket and eviction class, so none is more durable than another.

## Considered options

- Cache API would trade the content-addressed store and atomic rename for URL-keyed entries, and its code-cache advantage measures as noise (~34 ms once per session) while requiring a raw-wasm CDN download source.
- IndexedDB stores only raw bytes (Chromium disallows structured-cloning `WebAssembly.Module`), adds transaction overhead, and has no atomic-rename idiom — dominated on every axis.
- The one measured win is backend-independent: the fabricated `Response` streams the OPFS `File` straight into streaming instantiation, so compilation overlaps the disk read and the binary never materializes as a JS-heap buffer — median 97 ms for the full load versus 291 ms and a ~58.6 MB heap spike for the materialize-then-compile path.
