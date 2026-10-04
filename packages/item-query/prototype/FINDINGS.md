# Findings — Item Query candidate and relation plans (#595)

Question: which candidate-scan and relation-loading strategy gives the best measured balance of correctness, latency, memory, and module depth? The full numbers are in [`results/RESULTS.md`](results/RESULTS.md), and the plans are described in the [README](README.md).

## Verdict

Adopt the **hybrid plan `H`**. It does an item-led Library scan **without SQL `ORDER BY`**, with an incremental top-K, chunked candidate-scoped `IN (…)` hydration of only the fields and relations the query needs, and the authoritative evaluator. It uses **predicate-led reverse-index candidate sets** for selective leaves only, when the set is no larger than about 25% of the Library.

Reject correlated-`EXISTS` pushdown (`A`) and the query-local Library snapshot (`C`) as the primary mechanism.

```text
                   ┌──────────── selective leaves only ────────────┐
filter ─lower──►   │ exact Tag · exact field value (both storage   │── set ≤ 25% Library ──► candidate IDs
                   │ classes) · Collection · Zotero key · Attachment│                         │ restrict to universe (IN chunks)
                   └────────────────────────────────────────────────┘                         │ sort keys in JS
                                         │ no selective leaf, or set too large                ▼
                                         ▼                                         ┌──────────────────────┐
                   Library range scan, unordered ──chunk 250──► hydrate needs ──►  │ evaluator (authority)│
                   (no temp B-tree)                 (IN …, fieldID-restricted)     │ top-K (limit+1)      │
                                                                                   └──────────┬───────────┘
                                                                         project winners (IN chunks) ─► Query Result
```

## Evidence

### Correctness: every family can be exact, given four soundness rules

All 892 plan runs matched the `REF` oracle on rows, order, projected values, `returnedCount`, and `truncated`. The runs cover the active Library, an `ANALYZE`d copy, two synthetic scale fixtures, and an adversarial scenario with personal and group Libraries. Mutation checks showed that the scenario catches the hazards below. Each one had to be built into the lowering for parity:

1. **Storage-class binding.** `itemDataValues.value` has no affinity, so `12` and `'12'` are distinct rows. An exact-value leaf must bind both the text and the numeric form. Without this, `volume == "12"` loses rows in `A` and `B`.
2. **Trashed Collections.** The Collection leaf must exclude `deletedCollections`, or `!collections.contains(…)` under-selects. This matters only because negation needs exact terms.
3. **Negation only over exact terms.** `!` lowers only when its operand is an exact equivalence. A superset term under `!` is unsound.
4. **Library isolation.** Reverse-index leaves (Tag, Attachment) have no Library column. Restricting to the Target Library universe after set algebra is mandatory. The scenario reuses personal keys in the group Library to prove this.

### Latency and responsiveness: SQL default order is the hidden cost

| 50k Items (synth-scalar) | A0 SQL order | A EXISTS pushdown | B sets | **H** | C-warm | C-cold |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| match all, limit 100 | 48 ms / **45** slice | 47 / **45** | 48 / **46** | 106 / 1.5 | 0.4 | 948 / 87 |
| unique title | 294 / 48 | 103 / **102** | 8 / 7 | **8 / 8** | 24 | 954 / 87 |
| rare Tag | 159 / 47 | 24 / 24 | 5 / 4 | **4 / 4** | 21 | 949 / 88 |
| dominant type (80%) | 49 / 46 | 46 / 44 | 197 / 43 | 110 / **2** | 0.6 | 934 / 87 |
| `!tags.contains(common)` | 50 / 47 | 72 / 69 | 222 / 47 | 177 / **2** | 0.7 | 930 / 87 |
| title asc, limit 100 | 375 / 63 | 372 / 63 | 370 / 62 | **311 / 3** | 86 / 77 | 991 / 76 |
| `title.lower().contains("the")` | 52 / 48 | 52 / 48 | 51 / 47 | 313 / **3** | 1.1 | 935 / 86 |

Each cell is median total ms / max synchronous slice ms.

- **There is no `(libraryID, dateModified)` index, so SQLite sorts the whole Library inside the first `step()`.** Time to first row is 4.4 ms at 9k Items and 40–46 ms at 30–50k. Chunking cannot split that step. Every plan that asks SQL for the default order therefore has a ~45 ms slice at scale, even for `limit 100`. Cancellation shows the same cost: with an abort scheduled at 20 ms, `A0`, `A`, and `B` reject at 41–48 ms on the synthetic fixtures, while `H` and `A0k` reject at 20 ms.
- **Correlated `EXISTS` pushdown (`A`) moves filter work into that same unsplittable step.** The cost includes a per-Item probe for the whole Library. For a common venue it is slower than no pushdown (147 ms vs 52 ms), and its slice grows to 102–160 ms.
- **Reverse-index sets (`B`) win by one to two orders of magnitude on selective leaves.** They lose on dominant type (no type index, so the leaf scans the Library) and on negation (universe difference). `H` keeps only the winning leaves and caps the set size, so it matches `B` where `B` wins and falls back to the sliced scan elsewhere.
- **The cost of `H`** is losing limit-based early termination on unfiltered or non-selective queries. On the 50k fixture, match-all `limit 100` takes 106 ms instead of 48 ms, and `contains` takes 313 ms instead of 52 ms. Every slice stays at or below 3 ms instead of 45 ms. At the active Library's size (9k), the same queries take 17 ms and 45 ms.

### Relation loading: set-oriented chunks, but not for speed alone

- Per-ID prepared loops (today's `@zotlit/db` helper shape) were only 10–27% slower than `IN (…)` chunks under `node:sqlite`, despite running up to about 200× more statements (99,521 vs 465). The case for the set shape is statement count and a seam that can restrict `fieldID`, not raw speed.
- **Chunk size 250** keeps every slice of a limited `H` query at or below 13 ms. `limit=all` reaches 18–31 ms, mostly in the final sort. A chunk of 4000 is 4–24% faster in total but raises slices to 20–81 ms. A chunk of 25 adds 15–20% overhead.
- Candidate-scoped loading beats a Library preload whenever anything narrows the set. A preload (`C-cold`) costs about 1 s at 30–50k Items regardless of the query.

### Memory

- `C` retains 23 MB at 9k Items, 69 MB at 30k relation-heavy, and 93 MB at 50k scalar-heavy, before any cache-invalidation machinery. Warm queries are excellent (≤ 86 ms), but the snapshot is only safe behind a source-version signature, and the cold path is the slowest plan measured. This prototype finds no reason to adopt it. It remains a possible later cache on top of `H`, not a plan family.
- The `H` peak heap is bounded by the hydrated chunk plus top-K for limited queries. `limit=all` holds every match, as in every family.

### Statistics sensitivity

`ANALYZE` changed plan text for all 17 shapes. It added Bloom filters, and in a one-Library database it chose `SCAN i` instead of the Library-index range. It changed no reverse-index leaf access path and no ranking: `H` and `B` stay 1–4 ms on selective leaves, and `A` stays 18–26 ms on field equality. The plan choice must not depend on `sqlite_stat1`. `H`'s threshold uses its own measured set size, not planner estimates.

## Open items for #592 and #596

- **Thresholds need acceptance criteria (#596).** The 25% set cap and chunk size 250 are reasonable defaults. A size-gated variant could use SQL `ORDER BY` for early termination when the Library is small: the sort step is 4.4 ms at 9k Items. Choose this only if #596 values total latency over the slice bound.
- **The remaining unsliced work is `limit=all` final sort plus projection,** at 20–34 ms for 50k matches. A chunked merge or projection would close it. This was not measured.
- **Database seam (#592).** `H` needs four internal operations:
  1. an unordered universe scan cursor;
  2. reverse-index leaf queries for Tag, field value, Collection, key, and Attachment parent;
  3. a universe restriction plus sort-key fetch for an ID chunk;
  4. per-relation batch hydration with a `fieldID` restriction.

  This prototype used raw `node:sqlite`. The cost of Drizzle's typed wrapper on these shapes was not measured.
- **Semantic edges are still open in #602** (collation, clock, custom-name rules). The parity method is differential, so these choices do not change the verdict, but the oracle's fixed expectations wait on them.
- **Synthetic distributions are modelled on the active Library's aggregates.** No group-Library-scale or 24k legacy fixture was available locally.
