# Item Query SQLite access paths

Date: 2026-08-02

## Scope and evidence level

This note resolves the research in [#597](https://github.com/aidenlx/zotlit/issues/597), under the implementation-route map [#591](https://github.com/aidenlx/zotlit/issues/591). It records the access paths that Zotero declares, the relationships that `@zotlit/db` models, measured plans and aggregate distributions from the active database, and physical alternatives for later prototypes. It does not select a physical plan or database seam.

The active user database was opened with `sqlite3 -readonly` and `PRAGMA query_only=ON`. Queries returned only aggregate counts, anonymized distributions, and `EXPLAIN QUERY PLAN` output. No private Item value, key, creator, Tag, or Collection name was selected or recorded. Plan output is evidence about one SQLite version and one data distribution, so this note records the SQLite version and `sqlite_stat*` state. SQLite states that `EXPLAIN QUERY PLAN` output is for interactive diagnosis and can change between releases ([SQLite EQP](https://sqlite.org/eqp.html)).

## Baselines are already different

The committed `@zotlit/db` snapshot is named `userdata_125`, and its maintenance note treats the Zotero `userdata` counter as the DDL compatibility marker ([ZOTERO_MIGRATION.md](../../packages/db/drizzle/ZOTERO_MIGRATION.md), [snapshot directory](../../packages/db/drizzle/20260509071212_userdata_125/)). Zotero `main` at commit [`d54327a`](https://github.com/zotero/zotero/commit/d54327a0459984e894599db2c783dfa88d4cd63e) declares `userdata` 129 ([userdata.sql:1](https://github.com/zotero/zotero/blob/d54327a0459984e894599db2c783dfa88d4cd63e/resource/schema/userdata.sql#L1)).

The 126 migration adds normalized shadow columns to item values, tags, creators, and annotation text. The 127 migration removes the Saved Search `required` column and old word-index tables. The 129 migration adds `clientVersion` to four object tables ([schema.js:3686-3730](https://github.com/zotero/zotero/blob/d54327a0459984e894599db2c783dfa88d4cd63e/chrome/content/zotero/xpcom/schema.js#L3686-L3730)). The current Drizzle model has none of the normalized columns and still models `savedSearchConditions.required` ([schema.ts:317-476](../../packages/db/drizzle/schema.ts#L317-L476), [schema.ts:618-636](../../packages/db/drizzle/schema.ts#L618-L636)).

This drift has two direct effects on Item Query research:

- Every measurement needs its `version.userdata` value. A plan measured on 125 is not a complete statement about 126–129.
- The normalized columns change possible text semantics, but they add no declared indexes. Zotero uses them for normalized `contains` and `beginsWith` matching through expressions such as `COALESCE(valueNormalized, value)` ([searchConditions.js:597-613](https://github.com/zotero/zotero/blob/d54327a0459984e894599db2c783dfa88d4cd63e/chrome/content/zotero/xpcom/data/searchConditions.js#L597-L613), [search.js:1886-1933](https://github.com/zotero/zotero/blob/d54327a0459984e894599db2c783dfa88d4cd63e/chrome/content/zotero/xpcom/data/search.js#L1886-L1933)). They improve normalization compatibility, not B-tree selectivity for a leading-wildcard search.

## Declared access paths

SQLite can use the left-most prefix of a multi-column index, and a suitable multi-column index can satisfy filtering and ordering together. Without a suitable ordering index, SQLite uses a temporary B-tree for `ORDER BY` ([SQLite query planner](https://www.sqlite.org/queryplanner.html), [SQLite EQP: temporary sorting B-trees](https://sqlite.org/eqp.html#temporary_sorting_b_trees)).

| Item Query area | Zotero tables and declared indexes | Constraint or useful path |
| --- | --- | --- |
| Target Library universe | `items`: rowid primary key, `UNIQUE(libraryID, key)`, and explicit `items_synced`; `deletedItems`: `itemID` primary key; `itemTypes`: `itemTypeID` primary key ([userdata.sql:157-191](https://github.com/zotero/zotero/blob/d54327a0459984e894599db2c783dfa88d4cd63e/resource/schema/userdata.sql#L157-L191), [userdata.sql:386-391](https://github.com/zotero/zotero/blob/d54327a0459984e894599db2c783dfa88d4cd63e/resource/schema/userdata.sql#L386-L391)) | The `(libraryID, key)` auto-index can constrain its left-most `libraryID` prefix. No declared index combines `libraryID` with `dateModified`, `dateAdded`, `itemTypeID`, or the final key tie-breaker. The default Library scan plus modification sort therefore has no matching single index. The deleted anti-lookup is keyed by `itemID`. |
| Scalar item fields | `itemData` primary key `(itemID, fieldID)`, plus indexes on `fieldID` and `valueID`; `itemDataValues.value` is unique ([userdata.sql:174-191](https://github.com/zotero/zotero/blob/d54327a0459984e894599db2c783dfa88d4cd63e/resource/schema/userdata.sql#L174-L191)) | Exact value lookup can go `value -> valueID -> itemData -> itemID`. Item-first hydration can go `itemID -> fieldID -> valueID`. A field-specific exact lookup still has to combine separate `fieldID` and `valueID` paths; no `(fieldID, valueID)` index exists. `contains`, normalized `contains`, and most expression-based comparisons do not have a declared searchable index. |
| Creators | `creators` has `UNIQUE(lastName, firstName, fieldMode)`; `itemCreators` has primary key `(itemID, creatorID, creatorTypeID, orderIndex)`, `UNIQUE(itemID, orderIndex)`, and an index on `creatorTypeID` ([userdata.sql:274-295](https://github.com/zotero/zotero/blob/d54327a0459984e894599db2c783dfa88d4cd63e/resource/schema/userdata.sql#L274-L295)) | Item-first creator hydration and creator ordering have useful `itemID` prefixes. Reverse traversal from a matched `creatorID` has no declared `itemCreators(creatorID)` index. Partial-name and normalized-name predicates also have no declared name-search index. |
| Tags | `tags.name` is unique; `itemTags` has primary key `(itemID, tagID)` and an index on `tagID` ([userdata.sql:247-272](https://github.com/zotero/zotero/blob/d54327a0459984e894599db2c783dfa88d4cd63e/resource/schema/userdata.sql#L247-L272)) | Exact tag-name selection and item-first tag hydration both have direct paths. Normalized or substring tag matching scans tag values before it reaches the keyed bridge. |
| Collections | `collections` has `UNIQUE(libraryID, key)`; `collectionItems` has primary key `(collectionID, itemID)` and an index on `itemID` ([userdata.sql:297-321](https://github.com/zotero/zotero/blob/d54327a0459984e894599db2c783dfa88d4cd63e/resource/schema/userdata.sql#L297-L321)) | Stable collection identity and both bridge directions are indexed. Collection names and parent links are not indexed. A path filter can resolve the small Library collection tree once, then use collection IDs for membership tests. |
| Attachment presence | `itemAttachments.itemID` is the primary key and `parentItemID` has an index ([userdata.sql:204-226](https://github.com/zotero/zotero/blob/d54327a0459984e894599db2c783dfa88d4cd63e/resource/schema/userdata.sql#L204-L226)) | Parent-first `hasAttachment` checks and bulk attachment hydration have direct paths. |
| Sorting | `items` has no declared index on `dateModified` or `dateAdded`. Item values have no index that combines field identity, value ordering, Library scope, and Item identity. | Default modification order and scalar metadata order can require a temporary sort. Limit pushdown is only useful when SQL reproduces the complete Item Query order and filter semantics. |

The Drizzle declaration is not a complete index catalog. For example, it declares only `items_synced` for `items` and omits Zotero's `UNIQUE(libraryID, key)`; it also omits the creator and item-creator unique constraints ([schema.ts:299-315](../../packages/db/drizzle/schema.ts#L299-L315), [schema.ts:471-505](../../packages/db/drizzle/schema.ts#L471-L505)). Measurements must read the real schema's `sqlite_master`/`PRAGMA index_list` metadata or the version-matched Zotero DDL. They must not infer physical indexes only from `schema.ts`.

## Current `@zotlit/db` access shape

`createClient()` wraps `node:sqlite` in a Drizzle Node client and exposes the relation graph through the returned client ([client/node.ts:1-21](../../packages/db/src/client/node.ts#L1-L21)). `defineQuery` adds per-client prepared-statement caching and typed placeholders ([queries/_shared.ts:178-220](../../packages/db/src/queries/_shared.ts#L178-L220), [queries/_shared.ts:255-320](../../packages/db/src/queries/_shared.ts#L255-L320)).

The existing query layer supplies useful behavioral examples, but it does not yet supply an Item Query physical seam:

- `getItemsByLibrary` asks RQB for every top-level, non-deleted Item in a Library, includes all item data and creators, and orders by `dateModified` ([items.ts:72-128](../../packages/db/src/queries/items.ts#L72-L128), [items.ts:214-233](../../packages/db/src/queries/items.ts#L214-L233)).
- `getItemsByID` reuses one prepared, full-item query once per ID ([items.ts:245-258](../../packages/db/src/queries/items.ts#L245-L258)). The indexed-item path uses the same ID-first loop after a lightweight ordered ID pass ([index-items.ts:131-169](../../packages/db/src/queries/index-items.ts#L131-L169), [index-items.ts:185-220](../../packages/db/src/queries/index-items.ts#L185-L220)).
- Tag and attachment helpers also loop over Item IDs or parent IDs. Tag loading then performs one tag-row lookup per distinct tag ID ([tags.ts:50-66](../../packages/db/src/queries/tags.ts#L50-L66)); attachment loading performs one parent query per Item ([attachments.ts:84-97](../../packages/db/src/queries/attachments.ts#L84-L97)).
- Collection nodes are loaded once per Library, while memberships use an Item-first prepared query ([collections.ts:9-41](../../packages/db/src/queries/collections.ts#L9-L41)). This is already close to a useful split for path resolution.

Zotero itself provides a primary-source bulk-loading comparison: it loads item fields, creators, tags, and collections in separate queries constrained by Library and an ID fragment ([items.js:254-318](https://github.com/zotero/zotero/blob/d54327a0459984e894599db2c783dfa88d4cd63e/chrome/content/zotero/xpcom/data/items.js#L254-L318), [items.js:397-402](https://github.com/zotero/zotero/blob/d54327a0459984e894599db2c783dfa88d4cd63e/chrome/content/zotero/xpcom/data/items.js#L397-L402), [items.js:865-925](https://github.com/zotero/zotero/blob/d54327a0459984e894599db2c783dfa88d4cd63e/chrome/content/zotero/xpcom/data/items.js#L865-L925)). This is evidence for a physical alternative, not proof that the same chunk size or query count is best for ZotLit.

The Obsidian database service already gives a long read a pinned client and opens its source with `mode=ro`; clone modes include the copied WAL and immutable mode reads the main database without the live WAL ([database/service.ts:80-88](../../apps/obsidian/src/services/database/service.ts#L80-L88), [database/read-source.ts:1-18](../../apps/obsidian/src/services/database/read-source.ts#L1-L18), [database/read-source.ts:106-153](../../apps/obsidian/src/services/database/read-source.ts#L106-L153)). A plan that needs persistent indexes cannot assume that this source is writable.

## Candidate SQL shapes for measurement

These shapes keep the settled universe of one Library's top-level, non-trashed Items. They intentionally leave field-alias expansion and evaluator correctness outside SQL. Replace literal ID lists with bounded parameters or a measured candidate-table mechanism.

### Universe and default order

```sql
SELECT i.itemID
FROM items AS i
JOIN itemTypes AS t ON t.itemTypeID = i.itemTypeID
WHERE i.libraryID = ?
  AND t.typeName NOT IN ('attachment', 'note', 'annotation')
  AND NOT EXISTS (
    SELECT 1 FROM deletedItems AS d WHERE d.itemID = i.itemID
  )
ORDER BY i.dateModified DESC, i.key ASC
LIMIT ?;
```

Measure this both as written and without `ORDER BY`. Record whether the Library prefix uses the `(libraryID, key)` auto-index and whether the sort reports `USE TEMP B-TREE FOR ORDER BY`.

### Index-friendly exact scalar candidate

```sql
SELECT i.itemID
FROM itemDataValues AS v
JOIN itemData AS d ON d.valueID = v.valueID
JOIN items AS i ON i.itemID = d.itemID
JOIN itemTypes AS t ON t.itemTypeID = i.itemTypeID
WHERE v.value = ?
  AND d.fieldID IN (?, ...)
  AND i.libraryID = ?
  AND t.typeName NOT IN ('attachment', 'note', 'annotation')
  AND NOT EXISTS (
    SELECT 1 FROM deletedItems AS x WHERE x.itemID = i.itemID
  );
```

Compare this reverse path with an Item-correlated `EXISTS` shape. The two plans can trade places as selectivity changes because no composite `itemData(fieldID, valueID)` index exists.

### Relation candidates

```sql
-- Exact tag, reverse path
SELECT it.itemID
FROM tags AS t
JOIN itemTags AS it ON it.tagID = t.tagID
WHERE t.name = ?;

-- Resolved collection IDs, reverse path
SELECT ci.itemID
FROM collectionItems AS ci
WHERE ci.collectionID IN (?, ...);

-- Attachment presence, parent path
SELECT DISTINCT ia.parentItemID AS itemID
FROM itemAttachments AS ia
WHERE ia.parentItemID IS NOT NULL;
```

Intersect each relation candidate with the Target Library universe. Also measure the equivalent correlated `EXISTS` form when another selective predicate has already made the outer Item set small.

### Set-oriented hydration for one candidate chunk

```sql
SELECT d.itemID, d.fieldID, v.value
FROM itemData AS d
JOIN itemDataValues AS v ON v.valueID = d.valueID
WHERE d.itemID IN (?, ...);

SELECT ic.itemID, ic.creatorID, ic.creatorTypeID, ic.orderIndex,
       c.firstName, c.lastName, c.fieldMode
FROM itemCreators AS ic
JOIN creators AS c ON c.creatorID = ic.creatorID
WHERE ic.itemID IN (?, ...)
ORDER BY ic.itemID, ic.orderIndex;

SELECT it.itemID, it.type, t.name
FROM itemTags AS it
JOIN tags AS t ON t.tagID = it.tagID
WHERE it.itemID IN (?, ...);

SELECT ci.itemID, ci.collectionID
FROM collectionItems AS ci
WHERE ci.itemID IN (?, ...);

SELECT ia.parentItemID, ia.itemID
FROM itemAttachments AS ia
WHERE ia.parentItemID IN (?, ...);
```

These queries align with the item-first prefixes of the bridge indexes. They should be compared with the current prepared per-ID loops for round trips, allocated rows, peak memory, cancellation interval, and total elapsed time.

## Physical alternatives to carry into the decision ticket

The source evidence supports these alternatives. It does not yet rank them.

1. **Hydrate-and-evaluate baseline.** Scan the Target Library universe, hydrate bounded chunks through set-oriented relation queries, run the authoritative evaluator, sort in memory, and apply the limit.
2. **Selective SQL candidates.** Lower only predicates with sound, measured access paths, such as exact item values, exact tags, resolved collection IDs, and attachment presence. Hydrate and evaluate the candidate superset.
3. **Adaptive candidate direction.** Choose between relation-first joins and Item-correlated `EXISTS` from measured selectivity classes. Keep the choice internal to Item Query.
4. **Derived in-memory index.** Build source-versioned maps for frequently filtered scalar values and relations, similar in lifecycle to the current item lookup index. Continue to read Zotero as the authority and evaluate every returned Item.
5. **Derived sidecar SQLite index.** Store searchable or sortable projections outside `zotero.sqlite`. Validate it against a source signature before use. This preserves the read-only source but adds refresh, storage, and failure-recovery work.
6. **Indexes on a writable clone.** Add session indexes only to a private clone, then discard them with the clone. This is possible only if the database service offers a writable clone mode and accounts for index-build time and disk use.
7. **Persistent indexes in `zotero.sqlite`.** Treat this as a separate compatibility and ownership alternative. Zotero owns and migrates the file, while the current service opens it read-only. Any experiment must use a disposable copy.

The database seam also remains open. `@zotlit/db` currently exports the client and domain queries, but its package exports do not expose the Drizzle schema as a public entry point ([package.json:14-26](../../packages/db/package.json#L14-L26)). The implementation-route decision can place candidate and hydration SQL behind narrow `@zotlit/db` operations, expose a supported schema/query entry point to `@zotlit/item-query`, or use another typed internal seam. Raw access through the driver's client is another measurable physical alternative, but it gives up the existing query wrapper's typing and caching.

## Measurements left for prototypes

For each representative Library size and distribution, record:

- `version.userdata`, Node and SQLite versions, read mode, WAL inclusion, and whether `ANALYZE` statistics exist;
- table and relation-row counts as anonymized aggregates only;
- `EXPLAIN QUERY PLAN` for the universe, exact scalar, substring scalar, tag, collection, creator, attachment, sort, and bulk-hydration shapes;
- elapsed time, returned and visited row counts where observable, peak memory, and cancellation latency;
- the crossover between per-ID prepared queries and set-oriented chunks;
- the effect of candidate selectivity, not only the fastest hand-picked value;
- behavior at SQLite's bound-parameter limit and several safe chunk sizes;
- parity against the correctness oracle before crediting any SQL pushdown.

The next decision gate is factual: determine whether the existing indexes plus set-oriented hydration meet the acceptance criteria. Index creation and derived-store alternatives need evidence only if that baseline misses the criteria.

## Measured active-database evidence

Research for [#597](https://github.com/aidenlx/zotlit/issues/597), under the
[Item Query Wayfinder map](https://github.com/aidenlx/zotlit/issues/591).

## Result

The current Zotero schema supports an item-led, two-phase plan without a full
table scan. The `(libraryID, key)` index gives a Library range scan and an exact
Zotero key lookup. The item-led primary keys then give efficient point lookups
for fields, creators, tags, collections, Attachment presence, and trash state.

The schema does not have an index that supplies Item Query's default
`dateModified DESC, key` order for one Library. Every measured sorted candidate
shape used a temporary B-tree. The schema also has no composite reverse index
for an EAV field and value. These two facts are the main SQL cost drivers in the
measured Library.

Candidate-scoped bulk relation loads have good item-led access paths. The
current `@zotlit/db` API does not expose these SQL batch shapes. Its public
helpers use one prepared query for each Item or relation key. Item Query needs a
new internal database seam for candidate IDs and batch hydration, or it needs to
accept this repeated-query cost.

This research does not choose the physical plan. Ticket #595 must compare the
viable plan families. Ticket #592 must choose the plan and the database seam.

## Constraints from the settled contract

Item Query reads top-level, non-trashed Items from one Target Library. The Filter
Expression evaluator is authoritative. SQL can return a sound candidate
superset. The core is asynchronous, supports cancellation and chunked
hydration, and accepts `NodeDatabaseClient` directly. A limited query can stop
after one extra matching Item only when SQL supplies the final order. An
in-memory sort must inspect all matches. These constraints come from
[ADR 0063](../adr/0063-item-query-core-is-base-independent-and-asynchronous.md),
[ADR 0064](../adr/0064-item-query-has-a-field-oriented-contract.md),
[ADR 0065](../adr/0065-item-query-cli-is-versioned-and-self-describing.md),
[ADR 0066](../adr/0066-item-query-is-a-deep-module-with-two-operations.md), and
the [Item Query glossary](../../packages/item-query/GLOSSARY.md).

## Method and limits

I inspected Zotero userdata schema version 125 from the active database and
from Zotero's
[official schema at tag 9.0.3](https://github.com/zotero/zotero/blob/9.0.3/resource/schema/userdata.sql).
I compared it with ZotLit's
[Drizzle schema](../../packages/db/drizzle/schema.ts),
[relation graph](../../packages/db/drizzle/relations.ts), and current query
modules under [`packages/db/src/queries`](../../packages/db/src/queries/).

I opened the active database with `sqlite3 -readonly` and set
`PRAGMA query_only=ON`. All data queries returned only counts, quantiles, or
query plans. They did not select an Item title, Zotero key, creator name, Tag
name, Collection name, or field value. The evidence below is aggregate and
anonymized.

The measured corpus has one Library and 9,233 live top-level Items. This is a
useful medium-size personal Library. It does not test group-Library skew or a
cross-Library workload. Relations are sparse apart from creators and Tags. The
largest observed creator fan-out is an outlier, so mean values alone are not a
safe batch-size guide.

A companion route measurement used a legacy 49.5 MiB fixture with 24,352 live
top-level Items. That fixture has one personal Library, no `sqlite_stat1` or
`sqlite_stat4`, one Collection node, and zero Collection memberships,
Attachments, or deleted rows. It is a larger scalar and sort corpus, not a
representative relation corpus. The active database complements it with
non-zero relation and trash rows, but has only 9,233 live top-level Items.

| Legacy fixture entity | Rows |
| --- | ---: |
| all Zotero item rows | 24,776 |
| live top-level Items | 24,352 |
| field applications | 190,093 |
| distinct field values | 124,480 |
| creator applications | 80,429 |
| Tag applications | 12,446 |
| Collection memberships | 0 |
| Attachments | 0 |
| deleted Items | 0 |

`EXPLAIN QUERY PLAN` reports the chosen access path and temporary structures. It
does not report actual row counts, memory use, or elapsed time. See SQLite's
[EXPLAIN QUERY PLAN documentation](https://sqlite.org/eqp.html). I did not
publish wall-clock timings from the active database because cache state, a live
Zotero writer, and process startup would make single-run numbers unstable. The
prototype ticket should time warm and cold runs with fixed fixtures and record
SQLite, Node, and Zotero versions.

The database has no `sqlite_stat1` table. SQLite therefore made these choices
without saved `ANALYZE` statistics. `automatic_index` was enabled, but none of
the recorded plans reported an automatic index. Running `ANALYZE` would write
to the Zotero-owned database, so this research did not run it. SQLite documents
the statistics behavior in [The Query Optimizer](https://sqlite.org/optoverview.html#manual_control_of_query_plans_using_sqlite_stat_tables).

## Measured corpus

The active database was about 58 MiB and used SQLite 3.43.2. Its relevant table
sizes were:

| Entity | Rows |
| --- | ---: |
| all Zotero item rows | 9,556 |
| live top-level Items | 9,233 |
| trashed item rows | 5 |
| field applications (`itemData`) | 65,225 |
| distinct field values (`itemDataValues`) | 35,112 |
| creator applications | 27,532 |
| Tag applications | 13,519 |
| Collection applications | 178 |
| Attachment rows | 226 |

For the Item Query universe, candidate hydration fan-out was:

| Data per Item | Items with any | Total live relation rows | Mean | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| fields | 9,233 | 64,600 | 7.00 | 6 | 12 | 13 | 17 |
| creators | 9,227 | 27,532 | 2.98 | 2 | 6 | 14 | 187 |
| Tags | 2,430 | 13,512 | 1.46 | 0 | 8 | 16 | 43 |
| Collections | 175 | 176 | 0.02 | 0 | 0 | 1 | 2 |
| live Attachments | 177 | 219 | 0.02 | 0 | 0 | 1 | 6 |

Nine Item types occur. The largest type contains 84.2% of Items, and the five
largest types contain 99.0%. Type filters can therefore range from selective to
almost match-all.

The EAV fields also have different distributions:

| Field | Item coverage | Distinct values | Largest exact-value match |
| --- | ---: | ---: | ---: |
| title | 100.0% | 9,216 | 2 |
| Citation Key | 100.0% | 9,233 | 1 |
| date | 99.4% | 233 | 1,600 |
| DOI | 28.7% | 2,592 | 39 |
| Extra | 45.2% | 1,444 | 359 |
| language | 1.7% | 5 | 133 |
| publication title | 9.0% | 383 | 72 |

Thus one generic "EAV equality" estimate is not sufficient. A title or Citation
Key equality can be highly selective. A date or language equality can return a
large fraction of the Library.

## Existing access paths

The official Zotero schema owns these relevant indexes. The active database
matched them.

| Purpose | Existing index or key |
| --- | --- |
| Item Library range and exact key | unique `(libraryID, key)` |
| trash anti-lookup | `deletedItems(itemID)` integer primary key |
| field load for one Item | `itemData(itemID, fieldID)` primary key |
| reverse EAV lookup | separate `itemData(fieldID)` and `itemData(valueID)` indexes |
| exact shared EAV value | unique `itemDataValues(value)` |
| creators in source order | unique `itemCreators(itemID, orderIndex)` |
| Tags for one Item | `itemTags(itemID, tagID)` primary key |
| Items for one Tag | `itemTags(tagID)` |
| exact Tag name | unique `tags(name)` |
| Collections for one Item | `collectionItems(itemID)` |
| Items for one Collection | `collectionItems(collectionID, itemID)` primary key |
| Attachments for one parent | `itemAttachments(parentItemID)` |

There is no compatible index for:

- `(libraryID, dateModified, key)` or `(libraryID, dateAdded, key)`;
- `(fieldID, valueID, itemID)` or `(valueID, fieldID, itemID)`;
- creator name to creator application;
- `(libraryID, collectionName)`; or
- Collection name ordering or Tag name ordering inside an Item batch.

The live database contains unique `(libraryID, key)` indexes on `items` and
`collections`. The pulled Drizzle declarations only name the `synced` indexes
for these tables. SQL still uses the live unique indexes, but the TypeScript
schema does not make these constraints visible to query authors. Compare
Zotero's [official userdata schema](https://github.com/zotero/zotero/blob/9.0.3/resource/schema/userdata.sql)
with [`items` and `collections` in the pulled schema](../../packages/db/drizzle/schema.ts).

## Representative candidate plans

All plans below include the one-Library predicate, the top-level type check,
the trash anti-lookup, `ORDER BY dateModified DESC, key`, and `LIMIT 101` unless
the row says otherwise. `SEARCH` and `USE TEMP B-TREE` are SQLite's terms.

| Shape | Important `EXPLAIN QUERY PLAN` result | Cost implication |
| --- | --- | --- |
| match all | `SEARCH items USING (libraryID=?)`; Item type and trash by primary key; `USE TEMP B-TREE FOR ORDER BY` | Reads the Library index range, then sorts all candidates before the limit. |
| exact Zotero key, no sort | `SEARCH items USING (libraryID=? AND key=?)` | One direct Item lookup. |
| Item type equality | Library range first; Item type by primary key; temporary order B-tree | There is no type-led Item index. The dominant type can match 84.2%. |
| modified-time range | Library range first; temporary order B-tree | The range and order cannot use a timestamp index. |
| correlated EAV equality | Library range; for each candidate, `itemData(itemID=? AND fieldID=?)`; value by primary key; temporary order B-tree | Predictable item-led probes. Cost grows with Library candidates, even for a rare value. |
| EAV-first equality join | value by unique index; `itemData(fieldID=?)`; Item by primary key; temporary B-trees for `DISTINCT` and order | Separate EAV indexes do not provide a field-and-value lookup. This form can scan every row for one field. |
| correlated EAV contains | Same item-led EAV probes as equality; temporary order B-tree | `%needle%` has no value access path. Each candidate field value must be tested. |
| correlated Tag equality | exact Tag by `tags(name)`; application by `(itemID, tagID)`; temporary order B-tree | The inner probe is efficient, but it repeats per candidate. |
| Tag-first equality | Tag by `name`; applications by `tagID`; Items by primary key; temporary B-trees for `DISTINCT` and order | A selective Tag can create a small candidate set before Item hydration. |
| creator contains | applications by `itemID`; creator by primary key; temporary order B-tree | No reverse name index exists. Work follows creator fan-out. |
| Collection equality | memberships by `itemID`; Collection and trash by primary key; temporary order B-tree | The item-led path is cheap in this sparse corpus. A Collection-first form can use the Collection Library-key range, but still tests names and sorts. |
| Attachment presence | Attachments by `parentItemID`; Attachment Item and trash by primary key; temporary order B-tree | The existence probe is efficient and sparse. |

The exact match-all output was:

```text
|--SEARCH i USING INDEX sqlite_autoindex_items_1 (libraryID=?)
|--CORRELATED SCALAR SUBQUERY 1
|  `--SEARCH d USING INTEGER PRIMARY KEY (rowid=?)
|--SEARCH ty USING INTEGER PRIMARY KEY (rowid=?)
`--USE TEMP B-TREE FOR ORDER BY
```

The exact correlated EAV-equality output was:

```text
|--SEARCH i USING INDEX sqlite_autoindex_items_1 (libraryID=?)
|--CORRELATED SCALAR SUBQUERY 1
|  `--SEARCH d USING INTEGER PRIMARY KEY (rowid=?)
|--CORRELATED SCALAR SUBQUERY 2
|  |--SEARCH id USING INDEX sqlite_autoindex_itemData_1 (itemID=? AND fieldID=?)
|  `--SEARCH v USING INTEGER PRIMARY KEY (rowid=?)
|--SEARCH ty USING INTEGER PRIMARY KEY (rowid=?)
`--USE TEMP B-TREE FOR ORDER BY
```

The exact Tag-first output started at the name and reverse bridge indexes, then
used temporary structures for distinct IDs and final order:

```text
|--SEARCH t USING COVERING INDEX sqlite_autoindex_tags_1 (name=?)
|--SEARCH jt USING INDEX itemTags_tagID (tagID=?)
|--SEARCH i USING INTEGER PRIMARY KEY (rowid=?)
|--CORRELATED SCALAR SUBQUERY 1
|  `--SEARCH d USING INTEGER PRIMARY KEY (rowid=?)
|--SEARCH ty USING INTEGER PRIMARY KEY (rowid=?)
|--USE TEMP B-TREE FOR DISTINCT
`--USE TEMP B-TREE FOR ORDER BY
```

Two details are important:

1. `LIMIT 101` does not remove the sort cost in these plans. SQLite must build
   the requested order because no input path supplies it.
2. Exact EAV equality has two selective dimensions but no composite index. The
   planner chose the field index in the tested reverse form. SQL spelling can
   change which single-column index it chooses, but it cannot create the
   missing combined access path.

The larger legacy fixture reproduced the Library-range scan and temporary
default-order B-tree. `ORDER BY key` alone used `(libraryID, key)` without a
temporary B-tree. Its Tag-first SQL still chose a Library Item scan plus
`(itemID, tagID)` probes, while the active database chose the Tag name and
`tagID` reverse indexes. Both databases lack statistics. This plan difference
shows why the implementation must retain measured fallback shapes instead of
inferring direction from index names alone.

## Representative batch hydration plans

I used an eight-ID `IN` batch to inspect candidate-scoped relation loading.

| Batch | Important plan result |
| --- | --- |
| fields | `itemData(itemID=?)`, then field and value primary-key lookups |
| creators | `itemCreators(itemID, orderIndex)`, then creator/type primary-key lookups; no temporary sort |
| Tags | `itemTags(itemID=?)`, then Tag primary-key lookup; temporary B-tree for Tag-name order inside each Item |
| Collections | `collectionItems(itemID=?)`, then Collection/trash primary-key lookups; temporary B-tree for name order |
| Attachment presence | `itemAttachments(parentItemID=?)`, then Item/trash primary-key lookups |

The exact eight-ID creator batch output was:

```text
|--SEARCH jc USING INDEX sqlite_autoindex_itemCreators_2 (itemID=?)
|--SEARCH c USING INTEGER PRIMARY KEY (rowid=?)
`--SEARCH ct USING INTEGER PRIMARY KEY (rowid=?)
```

These plans scale with the selected candidate batch and its relation fan-out.
They do not need a Library-wide relation preload. A Library-wide Tag load also
uses the Item Library range and item-led Tag index, but it builds an order
B-tree and reads Tag rows for every Item. Candidate-scoped loading avoids this
work when SQL or early evaluation narrows the set.

The host parameter limit and generated SQL size must constrain the batch size.
The prototype must test several batch sizes. The measured fan-out suggests that
one fixed row-count estimate is unsafe because one Item has 187 creators.

## Current `@zotlit/db` interface constraints

The database client wraps Node's synchronous `DatabaseSync` in Drizzle. The
caller supplies the connection URL and options. The package example uses a
read-only immutable URI, but
[`createClient`](../../packages/db/src/client/node.ts) does not force this mode.

The current public operations are optimized for existing note and template
workflows:

- [`getItemsByLibrary`](../../packages/db/src/queries/items.ts) hydrates all
  Items in one Library with all EAV fields and creators. It fixes the order to
  `dateModified DESC`.
- [`getItemsByID`](../../packages/db/src/queries/items.ts) loops over IDs and
  runs the cached full-Item query once per ID. There is no dynamic batch `IN`
  query.
- [`getTagsByItemIDs`](../../packages/db/src/queries/tags.ts) runs one Tag
  application query per Item, then one Tag row query per distinct Tag ID.
- [`getAttachmentsByParents`](../../packages/db/src/queries/attachments.ts)
  runs one prepared query per parent Item.
- [`collections.ts`](../../packages/db/src/queries/collections.ts) exposes one
  Item membership lookup and a Library-wide Collection-node load. It has no
  candidate-batch membership loader.
- The public index exports do not expose a candidate-ID query, a query-specific
  SQL predicate/order seam, or candidate-scoped batch loaders. See
  [`src/index.ts`](../../packages/db/src/index.ts).

For a candidate chunk of `B` Items, the current interfaces execute `B`
full-Item statements through `getItemsByID`. Tag hydration then executes `B`
application statements plus `U` Tag-row statements, where `U` is the number of
distinct Tag IDs in the chunk. Attachment hydration executes `B` parent
statements. Candidate-scoped set queries can express each relation family in
one statement per bounded chunk; this is the statement-count reason to measure
them, not evidence that one batch size is already best.

The package's
[query-authoring policy](../../packages/db/policies/query-authoring.md) prefers
one cached lookup plus a caller loop. It permits a dynamic `IN (...)` query when
round trips dominate. Item Query is such a case if it hydrates tens or hundreds
of candidates in each asynchronous chunk.

The former `@zotlit/bases-query` code had a dynamic candidate predicate/order
seam and Library-wide relation loaders. The map treats that code as behavioral
evidence only. The current branch removed those exports, so they are not an
available production interface.

## Physical alternatives for #595

These are viable families to prototype. This section does not select one.

### 1. Item-led candidate scan and candidate-scoped hydration

Scan the Target Library through `(libraryID, key)`. Apply sound correlated
`EXISTS` predicates where they reduce work. Read candidate IDs in SQL order
when SQL can reproduce the full Item Query order. Hydrate and evaluate in
bounded ID batches. Load only the relations referenced by filter, projection,
or sort.

This family uses every existing item-led index. Its cost is stable for a
9,233-Item Library. A selective predicate still performs one probe per Library
candidate. The missing timestamp order index also makes the default limited
query sort the Library range before evaluation.

### 2. Selective predicate-led candidate sets

Start from a reverse index when a predicate has a useful path: exact Zotero key,
exact Tag, exact shared EAV value, Collection, or Attachment parent. Produce
Item ID sets for each sound pushdown term. Intersect or union these sets, then
apply the Target Library, Item type, trash, final order, hydration, and
authoritative evaluation.

This family can avoid thousands of item-led probes for rare values. Its benefit
depends on selectivity. The measured date field shows the opposite case: one
exact value can match 1,600 Items. EAV equality also lacks a composite
field-and-value index, and Boolean set algebra must preserve the sound-superset
rule for `OR` and `NOT`.

### 3. Query-local Library snapshot

Hydrate the live top-level Items and the required relation maps once, then run
the authoritative evaluator and sort in memory. Cache the snapshot only inside
a source lease or behind a source-version signature. Process it in asynchronous
chunks.

This family avoids complex SQL lowering and makes all filter semantics uniform.
It reads about 64,600 field applications and 27,532 creator applications for
this Library before optional relations. It cannot use limited-result early
termination for an in-memory sort. Cache invalidation and peak memory become
primary costs.

### Index-bearing variants

A writable shadow copy or ZotLit-owned sidecar could add composite candidate and
EAV indexes. Adding unmanaged indexes directly to `zotero.sqlite` would change
a database whose schema and migrations Zotero owns. It also conflicts with the
current read-only access posture. The physical-plan ticket must decide whether
an index-bearing copy is in scope before any such benchmark. This research does
not recommend changing the live Zotero database.

## Decisions left for later tickets

Ticket #595 should answer these questions with runnable prototypes:

- Which plan family wins for match-all, rare equality, common equality,
  relation equality, contains, SQL-sortable limit, and in-memory sort?
- What candidate and hydration batch sizes keep one synchronous slice within
  the responsiveness target?
- Is candidate-scoped relation loading better than one Library preload at the
  measured sparsity and at a relation-heavy fixture?
- How much does missing `sqlite_stat1` data change plan choice across realistic
  databases?

Ticket #592 should then choose:

- the physical plan family and fallback rules;
- the private `@zotlit/db` seam;
- exact SQL pushdown coverage;
- whether any cache or shadow database exists; and
- the policy for schema drift and index discovery.

The correctness oracle in #598 must compare every SQL-assisted result with the
full evaluator. The performance criteria in #596 must define Library-size,
latency, memory, and synchronous-slice thresholds. This artifact supplies
constraints and evidence for those decisions. It does not make them.
