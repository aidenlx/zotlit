# CJK FTS recall (bigram-primary tokenizer)

Diagnoses and fixes mid-word / random-substring miss rates for Chinese and
Japanese under the `zotlit_cjk` FTS5 tokenizer.

## Fix

**Index:** overlapping Han / kana / Hangul char-bigrams as **PRIMARY**
(sequential positions); ICU (or jieba) word segments as **COLOCATED** on the
bigram that starts at the same character.

**Query:** emit overlapping bigrams as PRIMARY (so mid-word substrings hit
indexed bigrams). Previous query path emitted only ICU/jieba words, so
colocated bigrams were unsearchable whenever a 2-gram was split.

Source of the fix: `../../crates/zotlit-cjk-core/src/lib.rs`.

## Results

See [`results/results.json`](./results/results.json) and per-config
`results/_out_*.json`. Chinese report: `REPORT.zh.md`.

| Config | ZH hand phrase | ZH random-substr | ZH false-hit | JA random-substr |
|--------|---------------:|-----------------:|-------------:|-----------------:|
| baseline-icu | 0.980 | **0.437** | 0.025 | **0.368** |
| **fixed-icu** | **0.996**† | **1.000** | **0** | **1.000** |
| fixed-jieba | 0.996 | 1.000 | 0 | (same class) |

† Exact hand phrase recall is **0.9955** (reported as 0.996).

jieba adds ~3 MiB (ICU-only `.so` ≈ 2.62 MiB vs ICU+jieba ≈ 5.63 MiB) with
**no extra recall** on this eval → default **ICU-only**, jieba optional.

### Caveat (SQLite FTS5)

Overlapping **non-colocated** tokens are documented as undefined by SQLite.
If that bites in production, fall back to unigram PRIMARY + colocated
bigrams with an app-level AND-of-bigrams query rewrite. Single-character
queries need separate handling.

## What is not in this tree

- Built tokenizer `.so` files (`dist/baseline`, `dist/fixed`)
- Third-party corpora (progit2-zh / progit2-ja AsciiDoc trees, wiki dumps)
- PDF page JSON indexes (`progit-zh.clean.json`, etc.)

See [`corpus/FETCH.md`](./corpus/FETCH.md) for how to obtain sources.

## Reproduce

```bash
# 1. Build baseline + fixed tokenizer variants into dist/
#    (from prototypes/fts-index; ICU-only and ICU+jieba)
npm run build:ext
# copy/rename into dist/baseline and dist/fixed as the eval expects

# 2. Fetch corpora (see corpus/FETCH.md) and PDF page extracts

# 3. Run (each .so in a fresh Node process — SQLite ignores a second
#    loadExtension of the same tokenizer name in one process)
node scripts/eval-cjk-recall.mjs
# → results/results.json
```
