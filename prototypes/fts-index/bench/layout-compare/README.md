# Layout compare (v3 source ground-truth)

Compares four PDF → text / block pipelines for FTS quality and measures
layout-model runtime.

| Method | Description |
|--------|-------------|
| **A** | pdf.js page text order (no block segmentation) |
| **B** | Heuristic two-column reorder |
| **C** | Zotero SDT block-seg (via napi / child process) |
| **D** | PP-DocLayout-S blocks (Paddle), via Rust static `ort` napi |

**Only v3 numbers are valid.** v1/v2 quality tables sampled queries from
Zotero’s own output and are void / biased — do not cite them.

## Results (v3)

- Aggregate: [`corpus-v3/out/AGGREGATE_V3.json`](./corpus-v3/out/AGGREGATE_V3.json)
  (also mirrored under `out-source-gt/`)
- Plots: [`viz/v3_*.png`](./viz/)
- Runtime: [`results/runtime_rust_ort_napi.json`](./results/runtime_rust_ort_napi.json),
  [`results/runtime_wasm.json`](./results/runtime_wasm.json)
- Chinese reports kept for history: `SUMMARY.zh.md`, `REPORT.zh.md`

Corpus: **29 docs** (20 two-column, 9 single), **623 queries** (466 cross-line;
~44 cross-column). Ground truth is aligned from independent sources
(LaTeX / AsciiDoc / Markdown) — **never** from A/B/C/D output.

Headline phrase recall (mean [bootstrap lo–hi]):

| | phrase | AND | cross-line | cross-col | furniture/100q | reading-order |
|--|--:|--:|--:|--:|--:|--:|
| A | 0.939 [0.909–0.964] | 0.956 | 0.933 | 0.921 | 4.26 | 0.753 |
| B | 0.741 | 0.911 | 0.671 | 0.705 | 3.63 | 0.546 |
| C (block) | 0.845 [0.771–0.896] | 0.879 | 0.820 | 0.840 | 1.28 | 0.759 |
| D (block) | 0.619 | 0.711 | 0.578 | 0.608 | 4.10 | 0.440 |

Paired sign test (phrase): A ≻ C by +0.094 (19 better / 1 worse); B vs C
n.s. (p≈0.11). On two-column docs, C furniture drops to **0.91 / 100q**.
`progit-zh` is an outlier (A 0.64, C 0.18, D 0.05) — suspected CJK line
join / order bug in C/D, under investigation.

Runtime (Rust static `ort` napi, Linux x64): block-seg ≈ **3.1 ms/page**,
PP-DocLayout-S ≈ **23 ms @1 thread / 11 ms @4**; outputs match the Python
reference (MAD 0). onnxruntime-web 1.27 is ~6.8× / ~8.3× slower; tract ~
25 ms on block-seg and cannot run DocLayout.

## What is not in this tree

Excluded for size / copyright / license:

- PDFs, page bitmaps, third-party source tarballs (`corpus-v3/{pdfs,pdfs-cap,pages,sources,extract}`)
- ONNX / Paddle model weights (incl. Zotero AGPL weights)
- Built binaries (`.node`, `.so`, `.wasm`), `node_modules/`, `target/`, Python venvs

## Reproduce

1. **Models** — export / download PP-DocLayout-S and Zotero block-seg ONNX
   into a local `models/` directory (see `REPORT.zh.md` for the exact
   filenames used). PP-DocLayout-M / plus-L ONNX export is currently
   blocked (paddle2onnx × Paddle 3).
2. **Corpus** — place capped PDFs under `corpus-v3/pdfs-cap/` and source
   trees under `corpus-v3/sources/<id>/`. Scripts under `corpus-v3/scripts/`
   expect env `PDF_WORKER_ROOT` (pdf.js worker + Zotero SDT bridge) and a
   built `zotlit_cjk` ICU tokenizer `.so` (bigram-primary fix; see
   `../cjk-recall`).
3. **Native addon** — build `native-ort/` (napi-rs + static `ort`):

   ```bash
   cd native-ort && npm i
   # see ../electron-compat for glibc 2.28 / zigbuild / isoc23 shim flags
   npm run build
   ```

4. **Eval**:

   ```bash
   node corpus-v3/scripts/extract_v3.mjs
   python3 corpus-v3/scripts/build_gt_v3.py
   node corpus-v3/scripts/eval_fts_v3.mjs
   # → corpus-v3/out/AGGREGATE_V3.json
   ```

5. **Runtime benches**: `scripts/runtime_native_napi.mjs`,
   `scripts/runtime_wasm.mjs`.

Paths inside committed JSON were rewritten to placeholders (`BENCH_ROOT/`,
`PDF_WORKER_ROOT`, …); point env vars at your local checkouts.
