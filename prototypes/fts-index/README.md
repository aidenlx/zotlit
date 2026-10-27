# ZotLit PDF FTS prototype (`prototypes/fts-index`)

Prototype for [aidenlx/zotlit#1799](https://github.com/aidenlx/zotlit/issues/1799): desktop PDF full-text search with CJK-quality tokenization, ending in an **FTS5 index table** you can query with snippets and `zotero://open-pdf` page links.

**Recommended path (option C):** a Rust SQLite **loadable extension** (`zotlit_cjk`) loaded into Electron/Obsidian `node:sqlite` via `allowExtension` + `loadExtension`. ICU4X `icu_segmenter` is the base tokenizer for all languages; jieba is an optional Chinese enhancer (+~3 MiB).

## Pipeline (PDF → FTS5)

```
PDF
  → extract blocks/pages   (Zotero SDT if ZOTLIT_PDF_WORKER set; else pdf.js)
  → normalize              (PaddleX CJK join + Zotero Latin hyphen rule)
  → section_path           (PDF outline / PageIndex-style tree; else title_level vote)
  → loadExtension(zotlit_cjk) or JS Intl fallback
  → CREATE FTS5 + INSERT   (item_key, attachment_key, page_index, page_label,
                            section_path, unit_id, page_rects, text)
  → MATCH + snippet() + zotero://open-pdf?page=
```

One command (after build + `npm i`):

```bash
npm run build:ext          # ICU-only + ICU+jieba → dist/*.so
npm i
npm run e2e                # samples/sample-cjk.pdf (CC0)
# Optional SDT blocks:
# ZOTLIT_PDF_WORKER=/path/to/pdf-worker npm run e2e
# Optional jieba enhancer binary + tokenize arg:
# npm run build:ext:jieba && ZOTLIT_CJK_VARIANT=jieba npm run e2e
```

Verify with Node 24: `npx -y node@24 pipeline/run-e2e.mjs`

### Why not `.zotero-ft-cache` / raw `getFulltext`?

Zotero joins pages with `\f`. Trimming a leading form-feed **shifts every page index** vs PDF `pageIndex` used by open-pdf links. Hyphen joining and reading-order belong on stable per-page / per-block units (SDT), not on a re-split cache blob.

## What we borrowed from where

| Idea in this prototype | Upstream | License | Notes |
|------------------------|----------|---------|-------|
| ONNX block boundaries, multi-column reading order, `pageRects`, page labels, outline | Zotero **document-worker** / **pdf-worker** `getStructure` (`src/pdf/index.js` → `structure/structure.js`), ONNX `build/block-seg`, `anchor.pageRects` | **AGPL-3.0** | Optional: `ZOTLIT_PDF_WORKER=/path/to/pdf-worker` spawns `pipeline/sdt-child.mjs` with `--import scripts/pdfjs-setup.js` — **not vendored** |
| Latin hyphen continuation at paragraph/part boundaries | pdf-worker `block-cleanup.js`, SDT `parts.js` `shouldDropHardHyphenAtPartBoundary` | AGPL-3.0 | Idea reimplemented in `pipeline/normalize.mjs` |
| Unicode NFC before index (NFD kana/hangul from some extractors) | — (local) | MIT | `pipeline/normalize.mjs` `normalizePageText` |
| CJK line-join (no space when either side is CJK) | PaddleX `layout_parsing/pipeline_v2.py` `merge_text_across_page` (~L1414–1425) | **Apache-2.0** | Idea port in `pipeline/normalize.mjs` |
| Heading level vote (numbering + keywords + height cluster) | PaddleX `layout_parsing/title_level.py` | Apache-2.0 | Idea port in `pipeline/title-level.mjs` |
| Section tree → `section_path` breadcrumb | VectifyAI **PageIndex** `page_index_flash` (`pageindex/flash/api.py`) | **MIT** | Outline first; else voted headings |
| Optional scanned-page OCR | PaddleOCR / paddleocr-js PP-OCRv5/v6 | Apache-2.0 | Hook only: `pipeline/ocr-hook.mjs` (`ZOTLIT_OCR_HOOK=1`) |

## Build variants

| Feature | Artifact | Strip size (linux x64, measured) |
|---------|----------|----------------------------------|
| ICU-only (default) | `dist/zotlit_cjk_icu.so` | **2.59 MiB** |
| ICU + jieba | `dist/zotlit_cjk_icu_jieba.so` | **5.60 MiB** |

Ship **one** `.so` per install: two builds export the same `sqlite3_zotlitcjk_init`; loading both in one process collides. Managed Binary today is `.wasm`-oriented ([ADR 0069](https://github.com/aidenlx/zotlit/blob/main/docs/adr)); native FTS extensions need that path extended — download ICU+jieba only when the user enables enhanced Chinese.

Tokenizer args (FTS5 barewords only): `tokenize='zotlit_cjk'`, `… jieba` / `zh_jieba`, `… icu` / `zh_icu`, `… ja`, `… ko`.

## Key findings (numbers)

- **Electron 37.6** main: `allowExtension` + `loadExtension` **PASS** for both variants (`bench-results/test-ext-electron-*.json`). Renderer process **not** verified yet.
- **Chinese** (progit-zh 500 pages; substring GT; zh15 hand + 300 sampled):

  | Config | Index | zh15 AND R/P | s300 AND R/P |
  |--------|-------|--------------|--------------|
  | ICU-only + Han bigram | ~99 ms / 2144 KiB | **0.9929 / 0.9993** | **0.919 / 0.9965** |
  | ICU+jieba | ~138 ms / 1584 KiB | **0.9987 / 0.9004** | **0.9882 / 0.2087** |

  Low jieba sampled precision is largely an **AND-query artifact**: unquoted multi-character queries are split into multiple jieba tokens (AND), while the ground-truth set is contiguous substring match; the 300-query sample is also biased toward jieba dictionary spans. Phrase/`""` queries keep high recall. Default recommendation: **ICU-only**; jieba as opt-in enhancer.
- **Lindera** embed dicts are huge (IPADIC ~46 MiB, ko-dic ~82 MiB) and KO quality regressed on technical loanwords — not default.
- **English / Thai / JA** smoke: ICU keeps `v2.4.0`, folds `café`→`cafe`, splits `pre-commit`; Thai `new_auto` yields dictionary words; JA hand AND R≈0.96.
- Earlier bake-off (FTS vs zbsearch vs MiniSearch) and `cut_for_index` design: see `docs/` and `bench-results/`.

## Layout

```
prototypes/fts-index/          # suggested repo subfolder
  README.md                    # this file
  REPORT.zh.md                 # Chinese design/report (~architecture reset)
  Cargo.toml                   # workspace (napi optional)
  crates/zotlit-cjk-core/      # tokenizer core
  crates/zotlit-fts-ext/       # cdylib loadable extension
  crates/zotlit-fts-napi/      # option A reference (optional)
  pipeline/                    # PDF → FTS5 demo
  scripts/                     # build-ext, benches, electron tests
  bench-results/               # measured JSON
  docs/                        # design + research notes
  samples/                     # CC0 sample PDF + Pro Git download script
```

Large corpora, `target/`, `node_modules`, and upstream checkouts (zotero-src, pdf-worker, PageIndex, Paddle*) are **excluded**. Pro Git is CC BY-NC-SA — use `samples/download-progit.sh`, do not commit those PDFs.

## License

Prototype code: MIT (unless noted). Upstream licenses as in the table above; AGPL document-worker must remain an external optional dependency.

## Recent updates (2026-10-27)

- **CJK tokenizer fix:** overlapping Han/kana/Hangul bigrams as PRIMARY + ICU/jieba words COLOCATED; queries emit bigrams. See `crates/zotlit-cjk-core/src/lib.rs` and `bench/cjk-recall/`.
- **glibc 2.28 floor for ORT:** `crates/glibc_compat/isoc23_shim.c` + zigbuild notes under `bench/electron-compat/`.
- **Benches added under `bench/`:** `layout-compare` (v3 source-GT only), `cjk-recall`, `electron-compat`, `static-infer`. Each has an English `README.md`. Model weights, PDFs, corpora, and binaries are not shipped — see each README for fetch/rebuild steps.
