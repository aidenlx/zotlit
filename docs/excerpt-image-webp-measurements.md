# Excerpt Image WebP measurements

This record answers two questions about the lossless WebP Excerpt Images that [ADR 0053](../apps/obsidian/docs/adr/0053-excerpt-image-storage-uses-webp.md) requires: does the payload stay pixel-identical to the rendered crop, and what does it cost in bytes and encoding time against the PNG the canvas produced before. The numbers come from `apps/obsidian/src/services/excerpt-image/encode.browser-test.ts`, which encodes crops with the production encoder and decodes them again.

## How to run it again

```sh
cd apps/obsidian
ZOTLIT_TEST_ELECTRON_PATH=<Electron.app>/Contents/MacOS/Electron \
ZOTLIT_WEBP_MEASUREMENTS_OUT=../../tmp/webp-measurements.json \
  pnpm exec vitest run src/services/excerpt-image/encode.test.ts
```

The harness bundles the browser entry with Vite and runs its `run()` in a hidden Electron renderer, so the canvas is the same Chromium the plugin ships in. The test skips cleanly when `ZOTLIT_TEST_ELECTRON_PATH` is unset. The record is printed to stdout either way; `ZOTLIT_WEBP_MEASUREMENTS_OUT` only writes it to a file, and names a path relative to `apps/obsidian`, so `../../tmp` is the workspace root's gitignored `tmp/` ([scratch artifacts](../policies/scratch-artifacts.md)). Crop content is deterministic (a fixed seed), so a re-run on the same runtime reproduces every byte count.

## The runtime this record is against

Run date **2026-09-21**. Every number below was measured on one machine, in one process.

| Component | Version |
| --- | --- |
| Electron | 43.3.0, Chrome 150.0.7871.212, `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) … Electron/43.3.0` |
| WebCodecs `ImageDecoder` | present (`typeof ImageDecoder === "function"`) |
| Machine | Apple M4 Pro, macOS (darwin 27.0.0), arm64 |
| Encoding call | `canvas.toBlob(callback, "image/webp", 1)` |
| Comparable record | [PDF annotation probes](pdf-annotation-probes.md) ran the same Electron and Chrome pair inside Obsidian 1.14.x |

The crops are synthetic and deterministic: they reproduce the four content classes ZotLit renders (anti-aliased text lines, equation lines in a serif face, freehand ink strokes, and a noisy gradient image) rather than real PDF pages, because PDF rasterization needs the PDF.js copy Obsidian injects. Sizes and times therefore characterize the encoder, not one particular paper.

## Losslessness

Method: draw a 37 × 23 RGBA pattern on one canvas (851 pixels), encode it with `encodeExcerptImage`, then decode the payload twice — through WebCodecs `ImageDecoder` (`premultiplyAlpha: "none"`, `colorSpaceConversion: "none"`), which returns the samples the file holds, and through the canvas round trip (`createImageBitmap` → `drawImage` → `getImageData`), which premultiplies first. Each decode is compared byte for byte with the source canvas's own `getImageData` buffer. The control row encodes the same canvas at quality `0.9`, whose lossy payload exists to show that the comparison detects damage at all.

| Pattern | Decoder | Equal pixels | Alpha differences | Worst channel step |
| --- | --- | --- | --- | --- |
| opaque, alpha 255 | WebCodecs `ImageDecoder` | 851 / 851 | 0 | 0 |
| opaque, alpha 255 | canvas round trip | 851 / 851 | 0 | 0 |
| translucent, alpha 0, 17, 128, 200, 254, 255 | WebCodecs `ImageDecoder` | 851 / 851 | 0 | 0 |
| translucent, alpha 0, 17, 128, 200, 254, 255 | canvas round trip | 480 / 851 | 0 | 2 |
| translucent, quality `0.9` payload | canvas round trip | 143 / 851 | 0 | 210 |

Both patterns carry the source pixels exactly, alpha included, as the WebCodecs decode shows. The canvas round trip alone cannot show that for translucent pixels: `drawImage` premultiplies, and the unpremultiplication that follows rounds, which moves a translucent colour by up to two of the 255 steps even when the payload is the same one WebCodecs reads back exactly. The oracle in the test therefore treats WebCodecs as the lossless proof and keeps the canvas comparison as the fallback every host has, bounded to that premultiplication step. Generated crops are drawn on an opaque canvas (`alpha: false`), so the opaque row is the production path.

## Size and encoding time

Method: five encode calls per crop on one canvas, minimum wall time reported per encoder, byte counts read from the produced payloads. The two timed calls do **not** wrap the same work, so the ratio below is not two timings around one `toBlob`:

- **PNG ms** is the awaited `toBlob(callback, "image/png")` call alone: one canvas encode, nothing else.
- **WebP ms** wraps all of `encodeExcerptImage`, which is that same `toBlob` for `"image/webp"` at quality `1`, plus `blob.arrayBuffer()` (the payload copy out of the blob), the cancellation check that follows each await, and the container validation (`usableExcerptWebp`) that decides the format metadata. The WebP column therefore carries work the PNG column does not, and the ratio between them is an upper bound on the encoder's own cost rather than a like-for-like comparison.

Sizes come from those same payloads: WebP bytes are `encodeExcerptImage`'s `bytes.byteLength`, PNG bytes `toBlob`'s blob size.

| Crop | Size | PNG bytes | WebP bytes | Change | PNG ms | WebP ms |
| --- | --- | --- | --- | --- | --- | --- |
| text, fourteen rows of anti-aliased 11 px serif | 1200 × 160 | 128 035 | 15 440 | −87.9 % | 2.0 | 2.6 |
| equation, three display lines | 720 × 200 | 14 154 | 14 552 | +2.8 % | 0.7 | 1.8 |
| ink, four stroke passes | 900 × 300 | 29 278 | 9 754 | −66.7 % | 1.3 | 3.0 |
| image-heavy, gradient, blobs, grain | 600 × 400 | 361 827 | 309 196 | −14.5 % | 4.8 | 17.5 |

Lossless WebP pays off on text, ink, and image-heavy crops and costs 398 bytes on a crop whose page area is mostly empty, where the lossless bitstream has little to model — the same overhead Chromium pays for the `ICCP` profile chunk it writes beside the payload (456 bytes of the 706-byte 8 × 8 fixture the validator tests use, measured with the same chunk walk). Encoding WebP costs roughly 1.3 to 3.6 times the PNG encode measured at those boundaries — the ratio counts the WebP call's payload copy and container validation as well as its canvas encode — and the excerpt pipeline spends that work once per generated result because the same bytes feed the display, the derived cache, and the durable note asset.

The test pins the size relations it measured: WebP is smaller for the text, ink, and image crops, and within 10 % of PNG for the sparse equation crop.

## Chunk-level findings

The escaped claim behind "quality `1` is lossless" is worth recording, together with what the validator does about it.

| Observation | Method | Result |
| --- | --- | --- |
| quality `1` selects the lossless encoder | chunk walk of the payload | `RIFF`/`WEBP` with `VP8X` + `ICCP` + `VP8L`; `VP8L` signature `0x2f`, reserved version bits 0 |
| quality `0.9` does not | same walk, quality `0.9` | `VP8X` + `ICCP` + `VP8 ` (lossy), rejected by `usableExcerptWebp` |
| the extended header agrees with the lossless one | `VP8X` width/height (24-bit, minus one) against the `VP8L` 14-bit pair | equal, and the animation and reserved flag bits are clear |
| a host without a canvas WebP encoder | `toBlob` return type | the canvas spec substitutes PNG, which `encodeExcerptImage` detects and keeps as PNG rather than mislabelling it |
