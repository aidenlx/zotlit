# Multi-library search-index benchmark (issue #697)

## Machine note

- Node: v26.5.1
- Platform: darwin arm64
- Date: 2026-08-17T14:33:56.699Z

## Dataset

- Heavy-user scenario library sizes: 20000 / 5000 / 1000 / 200 / 50
- Typical scenario library sizes: 3000 / 800 / 150
- Titles: 4-10 words from a 300-word synthetic pool plus ~19 common English words; creators from a 15x20 name pool; publicationTitle from a 5-item pool; dateModified spread uniformly over the past 3 years; ~40% of items get a citation key.
- IDF-skew probe (heavy scenario only): term `quantum` planted in ~15% of lib-1 titles (short 3-word titles, e.g. "quantum network word12") and in exactly one lib-5 item (long 11-word title, both query terms appear once each, buried far apart). Probe query: `quantum network`.

## 1. Build time

| Scenario | Composite full build (ms) | Per-library builds (ms) | Per-library sum (ms) |
| --- | --- | --- | --- |
| Heavy-user (20000/5000/1000/200/50) | 495.7 | lib1(20000)=366.9, lib2(5000)=89.7, lib3(1000)=23.1, lib4(200)=2.5, lib5(50)=0.6 | 482.9 |
| Typical (3000/800/150) | 54.3 | lib1(3000)=59.8, lib2(800)=10.4, lib3(150)=1.9 | 72.1 |

## 2. Invalidation cost (derived)

Composite invalidation = full rebuild of all libraries. Per-library invalidation = rebuild of only the changed library. Median of 3 rebuilds.

| Scenario | Composite full rebuild (ms) | Per-library rebuild, largest lib (ms) | Per-library rebuild, smallest lib (ms) |
| --- | --- | --- | --- |
| Heavy-user (20000/5000/1000/200/50) | 485.1 | 356.7 | 0.6 |
| Typical (3000/800/150) | 68.9 | 50.5 | 2.0 |

## 3. Query latency (warm, median of 9 runs, limit 50)

| Scenario | Query | Composite median (ms) | Per-library merged median (ms) |
| --- | --- | --- | --- |
| Heavy-user (20000/5000/1000/200/50) | probe-title (2-word, contains probe term) | 6.465 | 5.414 |
| Heavy-user (20000/5000/1000/200/50) | author-name | 11.429 | 10.615 |
| Heavy-user (20000/5000/1000/200/50) | 3-char prefix | 72.171 | 61.820 |
| Heavy-user (20000/5000/1000/200/50) | citation-key-ish | 0.753 | 0.620 |
| Heavy-user (20000/5000/1000/200/50) | empty query | 18.632 | 18.806 |
| Typical (3000/800/150) | probe-title (2-word, contains probe term) | 2.034 | 2.441 |
| Typical (3000/800/150) | author-name | 1.038 | 1.281 |
| Typical (3000/800/150) | 3-char prefix | 7.213 | 7.617 |
| Typical (3000/800/150) | citation-key-ish | 0.046 | 0.061 |
| Typical (3000/800/150) | empty query | 1.929 | 1.949 |

## 4. Ranking fidelity (composite ordering treated as ground truth)

| Scenario | Query | Top-20 overlap (of 20) | First divergence rank |
| --- | --- | --- | --- |
| Heavy-user (20000/5000/1000/200/50) | probe-title (2-word, contains probe term) | 19 | 0 |
| Heavy-user (20000/5000/1000/200/50) | author-name | 19 | 7 |
| Heavy-user (20000/5000/1000/200/50) | 3-char prefix | 16 | 6 |
| Heavy-user (20000/5000/1000/200/50) | citation-key-ish | 20 | 3 |
| Heavy-user (20000/5000/1000/200/50) | empty query | 20 | none observed |
| Typical (3000/800/150) | probe-title (2-word, contains probe term) | 20 | 1 |
| Typical (3000/800/150) | author-name | 18 | 5 |
| Typical (3000/800/150) | 3-char prefix | 14 | 4 |
| Typical (3000/800/150) | citation-key-ish | 10 | 3 |
| Typical (3000/800/150) | empty query | 20 | none observed |

## Raw observations: IDF-skew probe (heavy scenario)

- Probe query: `quantum network`
- Weak lib-5 item (itemID 26201, title: "word160 word243 word142 quantum analysis word267 word15 network word253 word284 word278") score in its own tiny index: 22.005700177851278
- Top 3 strong lib-1 items in their own index: itemID 1766 score 18.5172 ("quantum network network"); itemID 2525 score 18.5172 ("quantum network network"); itemID 1467 score 18.5171 ("quantum network network")
- Naive merge rank of weak item: 0
- Composite rank of weak item: not in top 50
- Naive merge rank of top strong item (itemID 1766): 1
- Composite rank of same top strong item: 0

