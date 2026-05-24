# Search Implementation Analysis: Zotero vs. ZotLit v2 `item-lookup`

This report compares the search architectures of upstream **Zotero** (the desktop client at `../zotero/`) and ZotLit v2's **`apps/obsidian/src/services/item-lookup/`** module that powers the in-editor citation suggester and quick-switch modal.

Both systems answer "given a user query, return the most relevant items from a Zotero library", but they sit in very different runtimes (Mozilla XULRunner + SQLite vs. Obsidian/Electron + Drizzle-on-better-sqlite3) and they were designed to optimise very different things.

---

## 1. Top-level architecture

| Aspect                | Zotero (upstream)                                                                                             | ZotLit `item-lookup`                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Query model           | **Declarative**: build a `Zotero.Search` object by adding `(condition, operator, value)` tuples.              | **Imperative**: pass a raw string to `ItemLookup.search(query)`; engine tokenizes and scores.                              |
| Execution             | Compiles to a single (often very large) SQL statement, then runs subsearches for full-text/scope as needed.   | Loads all items for the active library into memory once, builds a MiniSearch index, runs in-process for every keystroke.   |
| Index location        | SQLite tables: `itemData`, `itemDataValues`, `itemCreators`, `fulltextItemWords`, `fulltextItems`.            | In-process `MiniSearch<IndexedItem>` over three flat fields (`title`, `creators`, `date`).                                 |
| Ranking               | None — SQL returns a set of `itemID`s. Ordering is decided by the caller (e.g. `_createItemsSort` collation). | BM25 from MiniSearch, multiplied by a small recency boost (≤1.1×). Empty queries fall back to `dateModified DESC`.         |
| Highlighting          | Caller's responsibility (item-tree row painter). Search itself returns no offsets.                            | Engine returns `SearchMatches` byte ranges aligned to the **original** title via a normalized index map.                   |
| Statefulness          | Each `Zotero.Search` instance is single-use; conditions accumulate and SQL is built lazily.                   | Single long-lived `ItemLookup` service; cache invalidated on DB change or `zotero.citation-library` setting change.        |
| Code size             | `xpcom/data/search.js` 1834 LOC + `searchConditions.js` 823 LOC + dialog-side `searchHandler.mjs` 513 LOC.    | 12 files, ~1.5k LOC total (incl. tests/fixtures). Production code is ~700 LOC.                                             |

---

## 2. Zotero's search subsystem

### 2.1 `Zotero.Search` (`xpcom/data/search.js`)

A `DataObject` subclass that doubles as the **saved-search model** and the **query builder** for any internal lookup. Notable surface:

- `addCondition(name, operator, value, required)` — pushes a condition into `_conditions`. `name` is a string from `searchConditions.js` (e.g. `title`, `creator`, `quicksearch-titleCreatorYear`, `fulltextContent`, `collection`).
- `setScope(other, includeChildren)` — runs `other.search()` first and treats its result as the universe.
- `search(asTempTable?)` — compiles `_conditions` to SQL via `_buildQuery()`, executes it, then layers full-text/regexp/parent-child filters on top, and returns an array of `itemID`s.

### 2.2 Condition catalog (`xpcom/data/searchConditions.js`)

A static dictionary populated lazily at startup. Each entry binds a condition name to a `(table, field, operators, flags?, inlineFilter?, aliases?)` record. Three categories exist:

1. **Standard conditions** — back a real SQL column: `title`, `creator`, `date`, `tag`, `note`, `annotationText`, etc.
2. **Special conditions** — affect query shape, not the WHERE clause: `joinMode`, `noChildren`, `includeDeleted`, `includeParentsAndChildren`, `blockStart`/`blockEnd`.
3. **Quicksearch macros** — `quicksearch-titleCreatorYear`, `quicksearch-titleCreatorYearNote`, `quicksearch-fields`, `quicksearch-everything`. These are *expanded* by `addCondition` (see `search.js:307–362`) into a block of real conditions:

```
blockStart
  key            is        <value if it looks like an item key>
  title          contains  <part>
  publicationTitle contains <part>
  shortTitle     contains  <part>
  court          contains  <part>
  year           contains  <part>
  citationKey    contains  <part>
  creator        contains  <part>
blockEnd
…then for `-everything`:
  fulltextWord   contains  <split>   ×N
or `fulltextContent contains <part>` for quoted strings
```

Modes:

- **`titleCreatorYear`** — used by the citation dialog list mode; restricts to non-children.
- **`titleCreatorYearNote`** — note-only variant.
- **`fields`** — adds `field`, `tag`, `note`, `annotationText`, `annotationComment`.
- **`everything`** — `fields` + full-text content via `fulltextWord` / `fulltextContent`.

### 2.3 Query parsing — `parseSearchString` and `semanticSplitter`

- `Zotero.SearchConditions.parseSearchString` (`searchConditions.js:785`) splits a raw input by whitespace, **preserving `"double-quoted phrases"`** as single units with `inQuotes: true`. Quicksearch expansion then iterates these parts, so `"foo bar" baz` produces two blocks.
- `Zotero.Fulltext.semanticSplitter` (`fulltext.js:1663`) is a hand-rolled Unicode word-class tokenizer that:
  - normalises curly quotes,
  - treats apostrophes inside words as letters (`don't`),
  - emits one token per Han character (CJK),
  - lower-cases everything and deduplicates via an object map.

  It is intentionally simple — Zotero stores tokenized words in `fulltextItemWords` so the indexer and the query path must agree byte-for-byte.

### 2.4 SQL construction (`_buildQuery`)

`_buildQuery()` is ~700 LOC of hand-rolled string assembly. Highlights worth noting for the comparison:

- **Join mode** (`all` / `any`) maps to `INTERSECT` / `UNION` style joins between condition tables.
- **`inlineFilter`** lets `key`/`itemID` conditions collapse `is`/`isNot` runs into a single `IN ()` clause.
- **`required: true`** lets a condition be enforced inside an OR group (rare, mostly used by feed filters).
- Special handling for `field` and `datefield` "templates": one entry covers an arbitrary list of `aliases` (e.g. all `itemFields` except a small denylist), letting `addCondition('publicationTitle', 'contains', x)` reach the same generic SQL path as `title`.
- Full-text content is **post-filtered**: the SQL search returns a candidate set, then `Zotero.Fulltext.findTextInItems` greps the cache files for those IDs.

### 2.5 Quick-search UI (`elements/quickSearchTextbox.js`)

A XUL custom element. Stores the current mode in `Zotero.Prefs("search.quicksearch-mode")`, exposes a dropmarker menu with three radio modes, and dispatches a `command` event with the raw text. The toolbar listener wraps the value into a new `Zotero.Search`, calls `.search()`, and feeds the IDs into the item tree.

### 2.6 Citation dialog (`integration/citationDialog/searchHandler.mjs`)

This is the closest analog to ZotLit's `ItemLookup`. Key behaviors:

- `cleanSearchQuery(str)` strips brackets, commas, semicolons, periods, the localized "and", and `et al`. — so pasting `(Smith et al., 2020)` works. Detects ISBN/DOI shapes and bypasses the cleaner.
- Maintains four buckets: `found`, `open`, `cited`, `selected`. The first comes from the SQL search; the others come from window state (currently-open readers, currently-selected items, items already cited in the document).
- `_getMatchingLibraryItems()` builds a `Zotero.Search`, picks DOI/ISBN/quicksearch by query shape, and runs once per debounce tick. Results are then re-sorted by `_createItemsSort` using `Zotero.getLocaleCollation()`, with a **left-bound match boost on the first creator's last name** ("Baum" beats "Appelbaum" when typing `baum`).
- `_filterNonMatchingItems(items)` runs `semanticSplitter(query)` against an in-memory string concatenation of each item's creators + title + date(year) + publicationTitle + shortTitle + court + year + citationKey. Used for the *selected/open/cited* buckets, where running another SQL search would be wasteful.

---

## 3. ZotLit's `item-lookup` service

### 3.1 Module layout

| File                 | Role                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `service.ts`         | `ItemLookup` `Service` — owns the cache lifecycle, debounces parallel loads, reacts to DB and settings changes.       |
| `engine.ts`          | Pure: `buildIndex(items, …)` and `searchIndex(index, query, …)`. BM25 via MiniSearch + recency multiplier + highlights. |
| `tokenizer.ts`       | Pure: `tokenize`, `normalize`, `normalizeWithIndexMap`. Uses `Intl.Segmenter` + optional cm-chs-patch CJK segmenter.   |
| `format-creator.ts`  | Pure: replicates Zotero `citeproc` `ROMANESQUE_REGEXP` for given/family name ordering, with CJK exception.           |
| `creator-summary.ts` | Pure: "Smith", "Smith and Doe", "Smith et al." for the journalArticle suggestion meta line.                          |
| `render-hit.ts`      | Obsidian-side: `renderSuggestion(settings, hit, el)` paints title + journalArticle meta into the suggester row.       |
| `fixtures.ts`        | Vitest fixtures; lets engine/service tests build items without the DB.                                                |
| `*.test.ts`          | Vitest coverage of each pure module + service lifecycle (cache reuse, debounce, invalidation, degraded-DB).           |

### 3.2 Indexing strategy

`buildIndex` flattens every `Item` for the active library into:

```ts
interface IndexedItem {
  id: number;        // itemID
  title: string;     // raw title or ""
  creators: string;  // "Family Given; Family Given" — formatted per language
  date: string;      // 4-digit year as a string
}
```

…and feeds it into MiniSearch with:

- **`tokenize`** — the custom Unicode-aware `tokenize` that goes through `Intl.Segmenter` for word boundaries, optionally hands CJK runs to the `cm-chs-patch` Obsidian plugin, then splits hyphenated tokens.
- **`processTerm: normalize`** — lower-case, NFD-decompose, strip `\p{Diacritic}`, plus a manual `ł → l` patch (NFD doesn't decompose Polish ł).
- **`storeFields: []`** — items aren't kept inside MiniSearch; the engine keeps its own `byId: Map<number, Item>` so hits can be reattached to the original `Item` shape.

The full item list is held by reference on the index (`items: readonly Item[]`) so an empty-query path can just slice the first `limit` items (already pre-sorted `dateModified DESC` upstream in `getItemsByLibrary`).

### 3.3 Search path (`searchIndex`)

1. Tokenize the query through the *same* tokenizer used to build the index.
2. Run MiniSearch with:
   - `combineWith: "AND"` — every token must match somewhere.
   - `prefix: true`.
   - `fuzzy: term ≤ 3 ? 0 : term ≤ 5 ? 0.1 : 0.2` — typo tolerance scaled by length.
   - `boost: { title: 2.5, creators: 2, date: 1 }`.
   - A pass-through `tokenize` (it has already been tokenized) and `processTerm: normalize`.
3. Multiply each score by `recencyMultiplier(item, nowMs)`:
   ```
   1 + 0.1 × exp(-daysSinceModified / 30)
   ```
   Capped at 1.1× so BM25 stays dominant.
4. Sort by score desc, slice to `limit`.
5. Build a single composite regex from the union of indexed terms each hit matched (longest first to avoid the `util|utility` shadowing problem), and use `normalizeWithIndexMap` to compute highlight ranges in **original-glyph coordinates** so Obsidian's `renderMatches` lights up `útil` for query `util`.

The two-pass design (score+slice first, highlight only the survivors) is deliberate — broad prefix queries can return thousands of MiniSearch hits, and the per-title `normalizeWithIndexMap` is the dominant cost.

### 3.4 Service lifecycle (`service.ts`)

`ItemLookup extends Service<void>` — the project's standard lifecycle base. Behaviour:

- On construction, awaits `settings.loaded`, subscribes to:
  - `db.on("changed", …)` → `#invalidate()` (clears cache, kicks off background reload).
  - `settings.subscribe(…)` → reload when `zotero.citation-library` changes.
- `#loadIfNeeded()` deduplicates parallel callers via `#loadInFlight`. If the DB transitions to non-`"ready"` it drops the cache and returns `null` (so the suggester silently returns `[]` instead of throwing while the DB is reloading).
- `DatabaseError` from `#loadLibrary` is downgraded to a `debug` log; any other error propagates so the service errors out.
- Tokenizer options (`Intl.Segmenter` + optional CJK segmenter) are recomputed at every reload; the segmenter plugin may have been enabled mid-session.

### 3.5 Consumers

`ItemLookup.search` is called from exactly two surfaces:

- `views/citation-suggest/editor-suggest.ts` — the inline Pandoc-citation suggester (`[@key]`).
- `views/quick-switch/modal.ts` — a Cmd-P-style library browser modal.

`render-hit.ts` renders each `SearchHit` into a row with title (truncated to a CSS-driven `--zt-citation-title-max-chars` window centered on the first highlight), optional citation key, and a journalArticle meta line.

---

## 4. Side-by-side feature comparison

| Capability                              | Zotero                                                                                                                | ZotLit `item-lookup`                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Saved searches                          | Yes (`Zotero.Search` is also a persisted `DataObject`; UI in `advancedSearch.xhtml`).                                 | **No.** Scoped to ad-hoc lookup.                                                                    |
| Multiple search modes                   | `titleCreatorYear`, `titleCreatorYearNote`, `fields`, `everything` + arbitrary advanced builder.                      | **One mode**: title + creators + year.                                                              |
| Full-text content                       | Yes — `fulltextItemWords` index + `findTextInItems` cache scan + regex modes.                                         | **No.**                                                                                             |
| Tags / notes / annotations              | Yes (in `fields` / `everything` modes).                                                                               | **No.**                                                                                             |
| Cross-library                           | Yes — every search runs against the SQLite db; `libraryID` is just a condition.                                       | **Single library** at a time — driven by the `zotero.citation-library` setting.                     |
| Quoted phrases                          | Preserved by `parseSearchString`; `fulltextContent` runs against raw cache for phrase match.                          | **No phrase syntax** — every token is independent (AND-combined).                                   |
| Boolean / operator syntax               | Yes via the advanced builder (`is`, `isNot`, `contains`, `beginsWith`, `isInTheLast`, etc.).                          | **None** — implicit AND-of-terms.                                                                   |
| Fuzzy / typo tolerance                  | None inherent. (`contains` is substring; full-text is exact-word.)                                                    | MiniSearch fuzzy with length-scaled edit distance.                                                  |
| Prefix matching                         | `beginsWith` operator on specific fields; `quicksearch` is `contains` (substring).                                    | MiniSearch `prefix: true` on every token.                                                           |
| Diacritic folding                       | Whatever SQLite collation provides (locale-dependent, not used uniformly).                                            | Explicit NFD + diacritic strip + Polish ł patch in both index and query.                            |
| CJK segmentation                        | `semanticSplitter` emits one token per Han character.                                                                 | Delegates to the user's `cm-chs-patch` Obsidian plugin when present; otherwise treats CJK as words. |
| Ranking                                 | None from `Zotero.Search`; caller sorts (collation + left-bound creator match in citation dialog).                    | BM25 × field boosts × recency multiplier; empty query falls back to `dateModified DESC`.            |
| Recency bias                            | None.                                                                                                                 | Soft (≤1.1×) exp-decay with 30-day half-life — tie-breaks only.                                     |
| Highlighting                            | Caller's responsibility; no offsets returned.                                                                         | Engine returns `SearchMatches` ranges in original-glyph offsets.                                    |
| ISBN / DOI shortcut                     | `citationDialog` detects and redirects to `DOI contains …` / `ISBN contains …`.                                       | **No.**                                                                                             |
| Punctuation-tolerant paste              | `cleanSearchQuery` strips brackets, et al, `&`, `;`, etc.                                                             | **No** — the tokenizer alone handles separators.                                                    |
| Reactivity to library mutation          | Each search rebuilds SQL; tree views subscribe to `Zotero.Notifier` for invalidation.                                 | `db.on("changed")` → cache invalidate → background rebuild.                                         |
| Cost per query                          | One or more SQL roundtrips; cost dominated by `LIKE '%…%'` scans and full-text lookups.                               | One MiniSearch call + a `for…of` over survivors. **Constant per query** once the index is built.    |
| Cost up front                           | None — pay per query.                                                                                                 | One full library load + tokenize on first use or after invalidation. Linear in library size.        |

---

## 5. Architectural takeaways

### 5.1 Why Zotero's design fits Zotero

- The desktop client is a **multi-purpose database tool**: saved searches, advanced search dialog, smart collections, item-tree filtering, and the citation dialog all need to share a single query language. A declarative `(condition, operator, value)` model is the right abstraction because conditions are also the user-visible primitive in the advanced search UI.
- SQL is the right execution engine when the data is already in SQLite, libraries can be huge, and queries can scope to collections, full-text, attachments, and annotations in one shot.
- The cost is enormous: 2.6k LOC of hand-rolled SQL generation, an extensible condition catalog, and per-feature "quicksearch" macros that fan out into 5–10 sub-conditions each.

### 5.2 Why ZotLit's design fits the plugin

- ZotLit's `item-lookup` only needs to power **one interaction**: type-ahead suggestion of items to cite. The user types, expects an answer in under 100ms, and never invokes saved searches, scopes, or boolean operators.
- The data set is bounded by `zotero.citation-library` and typically small (tens of thousands of items at most). Loading once and keeping a MiniSearch index in memory is comfortable on modern hardware and removes per-keystroke DB latency.
- All ranking / fuzzy / highlight features that Zotero leaves to the caller live inside the engine, because there is only one caller pattern.
- Direct trade-off: ZotLit cannot answer "items in collection X that are also notes containing 'foo'" — that's outside the surface area.

### 5.3 Behavioral parity gaps

Even within the narrow "type-ahead a citation" use case, ZotLit deviates from Zotero's `quicksearch-titleCreatorYear` in observable ways:

1. **Fewer indexed fields.** Zotero adds `publicationTitle`, `shortTitle`, `court`, and `citationKey` to the OR group. ZotLit indexes only `title`, `creators`, and `date`. A query like `Nature 2024 Doudna` will hit fewer items in ZotLit because `publicationTitle="Nature"` is not searched.
2. **Citation-key lookup.** Zotero matches `citationKey contains <part>`; ZotLit's engine deliberately *excludes* citation keys from the indexed surface (see `engine.test.ts:34` — "ignores citationKey when scoring matches"). The citation key is shown in the rendered row but cannot be searched against.
3. **No paste-clean.** Pasting `(Smith et al., 2020)` in Zotero produces `Smith 2020`; in ZotLit it produces three tokens `smith`, `et`, `al`, `2020` (after the regex-based segmenter), all required, which can yield zero hits because `et`/`al` won't appear in the indexed creators string.
4. **Item-key shortcut.** Zotero's quicksearch checks `isValidObjectKey(part)` and adds `key is <part>` — typing a full 8-char Zotero key resolves directly to that item. ZotLit has no such shortcut.
5. **Children excluded.** `quicksearch-titleCreatorYear` adds `noChildren` so attachments/notes never appear; ZotLit already filters via the DB query (`getItemsByLibrary`), but the criterion lives one layer down rather than next to the search code.

### 5.4 Performance characteristics

| Workload                 | Zotero                                                                                                                              | ZotLit                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| First query after start  | One SQL roundtrip (~10–80 ms typical).                                                                                              | Cold: load + build index (linear in item count); ≈100–500 ms for 10k items.                  |
| Steady-state typing      | One SQL roundtrip per keystroke (debounced); LIKE scans grow with library size.                                                     | One in-process MiniSearch call (≈1–5 ms for 10k items); no DB hit.                           |
| Memory                   | Per-search build cost, no resident index beyond SQLite caches.                                                                      | Holds all items + tokenized inverted index in memory (≈10–40 MB for 10k items, rough order). |
| Behaviour during reload  | Search throws / blocks until DB is reachable.                                                                                       | Returns `[]` immediately; logs at `debug`; auto-recovers on next `db.on("changed")` tick.    |

---

## 6. Summary

Zotero's search is a **general-purpose query engine** that powers everything from the item tree to advanced saved searches; its declarative `Zotero.Search` model and SQL backend are the right tools for that surface area, at the cost of substantial complexity.

ZotLit's `item-lookup` is a **single-purpose type-ahead** that trades generality for sub-millisecond per-keystroke latency, BM25 ranking, fuzzy/diacritic-tolerant matching, and engine-side highlighting — none of which Zotero provides out of the box for its own quicksearch.

The two designs are not in tension because they don't share a problem: Zotero would not gain by adopting an in-memory index (its data model is too broad), and ZotLit would lose its main selling point (instant, ranked, highlighted suggestions) if it called back into a SQL query per keystroke. The gaps in §5.3 are the realistic backlog if ZotLit ever wants to claim feature-parity with Zotero's `quicksearch-titleCreatorYear`: extend `IndexedItem` to include `publicationTitle`, `shortTitle`, and `citationKey`; add a `cleanQuery` step that mirrors `cleanSearchQuery` (strip brackets, `et al`, localized "and"); and add a `key` short-circuit for full Zotero item keys.
