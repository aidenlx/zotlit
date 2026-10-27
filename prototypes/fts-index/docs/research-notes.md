# Earlier research notes (PDF → structure → index)

## Zotero document-worker / pdf-worker (AGPL-3.0)

- `getFulltext` joins pages with `\f`. Splitting then trimming a leading form-feed **shifts page indices** relative to PDF `pageIndex` / `zotero://open-pdf`. Prefer per-page or SDT block extraction.
- `getStructure` runs ONNX **block-seg** (`src/pdf/structure/model/block-seg`) for block boundaries and multi-column reading order; emits `catalog.pages[].label`, `catalog.outline`, and `content[].anchor.pageRects` in annotation coordinate space.
- Latin hyphen join lives in `block-cleanup.js` / SDT `parts.js` (`shouldDropHardHyphenAtPartBoundary`). Do **not** vendor AGPL sources into this package — invoke a local checkout via `ZOTLIT_PDF_WORKER` if available.

## PaddleOCR / PaddleX (Apache-2.0)

- CJK line join: `layout_parsing/pipeline_v2.py` `merge_text_across_page` — if either side is CJK (`\u4e00–\u9fff`), concatenate **without** a space; Latin gets a space.
- Heading levels: `layout_parsing/title_level.py` — symbol patterns + `SPECIAL_KEYWORDS` + height clusters; majority vote among semantic / relative-order / cluster levels.
- Full OCR (PP-OCRv5/v6) is heavy (~seconds/page in our smoke test) — optional hook only for scanned pages (`pipeline/ocr-hook.mjs`).

## PageIndex / VectifyAI (MIT)

- `page_index_flash` builds a section tree from embedded TOC / heuristics (`pageindex/flash/api.py`).
- We borrow the **section_path** idea: outline titles first, else voted headings → breadcrumb column for filtering and display. We do not require the PageIndex runtime for the demo.

## Engine bake-off (earlier)

- SQLite FTS5 unicode61 / trigram vs zbsearch vs MiniSearch on Pro Git pages: FTS stayed lean on RSS and cold-load; CJK needed a real tokenizer (hence option C).
- See `bench-results/` JSON and `REPORT.zh.md`.
