# PROTOTYPE — Item Query candidate and relation plans (#595)

Throwaway code. It lives only on `prototype/item-query-candidate-plans`. Nothing here is production code or should be imported.

**Question ([#595](https://github.com/aidenlx/zotlit/issues/595), map [#591](https://github.com/aidenlx/zotlit/issues/591)):** which candidate-scan and relation-loading strategy gives the best measured balance of correctness, latency, memory, and module depth for Item Query?

**Branch choice:** this is a measurement question, not a state-model or UI question. The artifact is a runnable benchmark, not an HTML walkthrough. Its output is `results/RESULTS.md` (tables), `results/results.json` (raw data plus `EXPLAIN QUERY PLAN` text), and `FINDINGS.md` (the verdict).

## Run

```sh
pnpm prototype:item-query            # full: 5 warm runs per plan (≈10 min)
pnpm prototype:item-query --quick    # 1 run per plan
pnpm prototype:item-query --fresh    # rebuild scratch databases first
node --expose-gc packages/item-query/prototype/bench.ts --quick --only=scenario   # parity only
```

The live database defaults to `~/Zotero/zotero.sqlite` (override with `ZOTLIT_PROTOTYPE_ZOTERO_DB`). The runner copies it into `$TMPDIR/zotlit-item-query-prototype-WIPE-ME/` and never opens the live file for writing. Real-Library query literals are chosen by selectivity class and never written out; results record only counts and timings.

## Plans

| Plan | Family (research #597) | Candidate scan | Relation loading |
| --- | --- | --- | --- |
| `REF` | oracle and current-helper baseline | whole universe, no SQL order | per-ID prepared loops, every field and relation |
| `A0` | 1. hydrate and evaluate | Library range scan; SQL default order when it reproduces the sort; stops at limit+1 | candidate-scoped `IN (…)` chunks, only the needed fields and relations |
| `A` | 1. item-led with pushdown | `A0` plus a sound correlated `EXISTS` lowering in the universe SQL | same as `A0` |
| `B` | 2. predicate-led sets | reverse-index ID set per leaf, JS set algebra, universe restriction by `IN` chunks; falls back to `A0` | same as `A0` |
| `A0k` | 1. without SQL order | `A0` without `ORDER BY`: unordered scan plus incremental top-K | same as `A0` |
| `H` | adaptive (the verdict) | reverse-index sets for selective leaves only (Tag, field value, Collection, key, Attachment) when the set is ≤ 25% of the Library, otherwise `A0k` | same as `A0` |
| `C-cold` / `C-warm` | 3. query-local snapshot | none (in memory) | Library-wide loads once; `warm` reuses a cached snapshot |

## Files

- `core.ts`: parser adapter over `@zotlit/filter-expression`, a minimal evaluator (a subset of the adopted semantics), preflight validation, needs analysis, and sound pushdown lowering with exactness tracking for `!`.
- `source.ts`: raw `node:sqlite` access, the statement/row/slice/heap `Meter`, and set, per-ID, and Library-wide hydration.
- `plans.ts`: the plan families.
- `fixtures.ts`: scratch databases. These are an active-Library copy, an `ANALYZE`d copy, two synthetic scale fixtures built from the live DDL, and an adversarial scenario with personal and group Libraries.
- `bench.ts`: differential parity against `REF`, timings, chunk sweep, time-to-first-row, cancellation probe, retained snapshot heap, EQP capture, and the report.

## Deliberately out of scope

Partial-date intervals, Temporal values, the full function registry, custom fields, Collection paths (leaf names only), collation, and Projection Path grammar beyond bare names. #602 still owns these semantic edges. The prototype compares plans differentially against `REF`, so its verdict does not depend on those choices.
