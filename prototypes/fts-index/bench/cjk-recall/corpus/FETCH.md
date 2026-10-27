# Corpus fetch (not shipped)

Third-party source text is excluded for copyright. To reproduce:

1. Clone [progit/progit2-zh](https://github.com/progit/progit2-zh) and [progit/progit2-ja](https://github.com/progit/progit2-ja) (or the AsciiDoc trees used by the eval).
2. Build paragraph extracts into `corpus/progit-zh-source-paras.txt` and `corpus/progit-ja-source-paras.txt` (one paragraph per line), matching the eval script’s expectations.
3. Optional wiki extras under `corpus/extra/` — short topic pages used only for false-hit probes.
4. PDF page extracts used as the FTS index (`progit-zh.clean.json`, `progit-ja.pages.json`) are regenerated from the corresponding PDFs via the layout-compare / PDF.js extract pipeline — do not commit PDFs.

See `../scripts/eval-cjk-recall.mjs` and `REPORT.zh.md` / `README.md` for paths and flags.
