# cut_for_index design (jieba-rs)

## Problem
- `cut`: max-prob path only; swallows subwords (`控制系统` hides `控制`).
- `cut_for_search`: only emits dict 2/3-grams *inside* each max-prob token; cannot emit spans crossing token boundaries (`版本控制` from `版本/控制系统`).
- HMM adjacency gluing: OOV runs become one token (`变基到`), not in DAG.

## Proposal
```rust
pub fn cut_for_index<'a>(&self, sentence: &'a str, hmm: bool) -> Vec<Token<'a>>
```
For each Han block:
1. Build DAG (existing `dag`).
2. Emit every dict edge with char-len >= 2 (same as `cut_all_tokens` filtered).
3. Run `calc` + emit max-prob tokens (existing `cut_route`, with/without HMM).
4. Optional: for each max-prob token not in DAG (HMM/OOV), emit char bigrams within it.
Dedup by (byte_start, byte_end) while preserving a stable order.

Query side: `cut(hmm)` tokens, FTS5 `AND` (not phrase) when using pre-tokenized unicode61.

## JS prototype
`/workspace/bench/tok-index-proto.mjs` emulates (1)(2)(3)(4) via `cutAll` ∪ `cut` since `@node-rs/jieba` does not expose DAG.
