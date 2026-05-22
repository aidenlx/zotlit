# Zotero Creator Display Fields & CSL Name Ordering

A focused walkthrough of how upstream Zotero builds the two virtual "creator" columns (`firstCreator`, `sortCreator`) and where CSL's locale-aware family/given ordering actually lives. All file paths are relative to the upstream Zotero repo root (`zotero/`).

---

## 1. Storage model

There is no `firstCreator` or `sortCreator` column in the database. Both are **derived at query time** from the three persistent creator tables:

| Table | Role |
|---|---|
| `creators(creatorID, firstName, lastName, fieldMode)` | name strings; UNIQUE on `(lastName, firstName, fieldMode)` so identical persons are deduped |
| `itemCreators(itemID, creatorID, creatorTypeID, orderIndex)` | item→creator link with role and within-item order |
| `creatorTypes(creatorTypeID, creatorType)` | enum: `author`/`editor`/`translator`/… |
| `itemTypeCreatorTypes(itemTypeID, creatorTypeID, primaryField)` | schema; the row with `primaryField=1` defines the primary creator type for an item type |

`fieldMode` is two-valued:

- `0` — two-field (`firstName` + `lastName`)
- `1` — single-field literal (stored entirely in `lastName`), used for organisations.

The schema header that justifies "no denormalised column" is in `chrome/content/zotero/xpcom/db/.../userdata.sql` (see lines 269–288 of the `creators` / `itemCreators` block).

---

## 2. `firstCreator` — short display string

> *"Why do we do this entirely in SQL? Because we're crazy. Crazy like foxes."*
> — `chrome/content/zotero/xpcom/data/items.js:1466`

### 2.1 Registration into every primary-data SELECT

`chrome/content/zotero/xpcom/data/items.js:43-82` defines `_primaryDataSQLParts`, the map of columns each items query pulls. Two synthetic entries sit alongside the real columns:

```js
// chrome/content/zotero/xpcom/data/items.js:56-57
firstCreator: _getFirstCreatorSQL(),
sortCreator:  _getSortCreatorSQL(),
```

So every time Zotero loads an item via primary-data SQL, SQLite re-derives both strings per row and ships them as columns named `firstCreator` / `sortCreator`.

### 2.2 The SQL builder

`chrome/content/zotero/xpcom/data/items.js:1469-1523` — `_getFirstCreatorSQL()`:

```js
// items.js:1474-1475
var localizedAnd  = Zotero.getString('general.andJoiner').replace(/%S/g, '%s');
var localizedEtAl = Zotero.getString('general.etAl');

// items.js:1479-1503  (caseBlock — same shape for each priority type)
"CASE (SELECT COUNT(*) FROM itemCreators IC <where>) "
  + "WHEN 0 THEN NULL "
  + "WHEN 1 THEN (SELECT lastName FROM itemCreators IC NATURAL JOIN creators <where>) "
  + "WHEN 2 THEN (SELECT PRINTF('<localizedAnd>',
                   (SELECT '⁨'||lastName||'⁩' ... ORDER BY orderIndex LIMIT 1),
                   (SELECT '⁨'||lastName||'⁩' ... ORDER BY orderIndex LIMIT 1,1))) "
  + "ELSE       (SELECT (SELECT lastName ... ORDER BY orderIndex LIMIT 1) || ' <localizedEtAl>') "
  + "END"
```

The four priority types are wrapped in `COALESCE` so the first non-NULL wins:

```js
// items.js:1512-1519
"COALESCE("
  + caseBlock(primaryJoin)                  // primary creator type for this row's itemType
  + caseBlock(creatorTypeWhere('editor'))
  + caseBlock(creatorTypeWhere('director')) // legacy: was primary for Video Recording
  + caseBlock(creatorTypeWhere('contributor'))
+ ") AS firstCreator"
```

The "primary" join (`items.js:1505-1507`) is a `LEFT JOIN itemTypeCreatorTypes ITCT ... WHERE primaryField=1`, so it resolves per item type — `author` for journalArticle/book, `interviewer` for interview, `podcaster` for podcast, etc.

`translator` is intentionally absent. A translator-only item gets `""`.

### 2.3 What SQLite actually does, per row

Per row of `items O`:

1. **Resolve "primary" dynamically.** The `primaryJoin` correlated subquery (`items.js:1505-1507`) is `LEFT JOIN itemTypeCreatorTypes ITCT ON (IC.creatorTypeID = ITCT.creatorTypeID AND ITCT.itemTypeID = O.itemTypeID) WHERE itemID = O.itemID AND primaryField = 1`. Because `O.itemTypeID` is correlated with the outer row, "primary" resolves per row — `author` for journalArticle/book, `interviewer` for interview, `podcaster` for podcast, …
2. **Evaluate four `CASE` blocks in `COALESCE` order.** For each block:
   - First run `SELECT COUNT(*) FROM itemCreators IC <where>` to count matching creators.
   - `WHEN 0` → block resolves to `NULL`; `COALESCE` moves on.
   - `WHEN 1` → second subquery fetches the single `lastName`.
   - `WHEN 2` → two more subqueries with `ORDER BY orderIndex LIMIT 1` and `LIMIT 1 OFFSET 1`, each wrapped as `'⁨' || lastName || '⁩'`, fed to `PRINTF('<andJoiner>', a, b)`. `<andJoiner>` is whatever `Zotero.getString('general.andJoiner')` returns in the UI locale (e.g. `'%s and %s'`, `'%s und %s'`, `'%s 和 %s'`).
   - `ELSE` (3+) → fetch only `lastName` of the first creator, concat ` ` + the locale's `general.etAl` string.
3. **First non-NULL `CASE` wins**, `COALESCE` short-circuits, result aliased `AS firstCreator`.

Practical consequences:

- **Each `CASE` re-runs its `<where>` subquery 2–3 times** (count plus one or two `LIMIT`s). SQLite doesn't cache subquery results across the arms, so a large library pays this cost on every primary-data load. The PK on `itemCreators(itemID, creatorID, creatorTypeID, orderIndex)` covers the `WHERE itemID = ?` part well enough for it to be fine in practice.
- **Bidi isolates are baked into the SQL.** `'⁨'` (U+2068) and `'⁩'` (U+2069) are string literals at `items.js:1492, 1494`. They live inside `_firstCreator` permanently and are stripped only when `getField('firstCreator', /*unformatted=*/true)` is called (`item.js:254-256`).
- **Fallback creator-type IDs are baked in once.** `Zotero.CreatorTypes.getID('editor')` is resolved at SQL-build time (`items.js:1508-1510`) and the whole string is memoised in `_firstCreatorSQL` (`items.js:1468, 1521`).

### 2.4 Fully expanded form of one `CASE` arm

For UI locale strings `andJoiner = '%s and %s'`, `etAl = 'et al.'`, the first (primary-type) arm of the outer `COALESCE` substitutes to:

```sql
CASE (
  SELECT COUNT(*) FROM itemCreators IC
    LEFT JOIN itemTypeCreatorTypes ITCT
      ON (IC.creatorTypeID = ITCT.creatorTypeID AND ITCT.itemTypeID = O.itemTypeID)
  WHERE itemID = O.itemID AND primaryField = 1
)
  WHEN 0 THEN NULL
  WHEN 1 THEN (
    SELECT lastName FROM itemCreators IC NATURAL JOIN creators
      LEFT JOIN itemTypeCreatorTypes ITCT
        ON (IC.creatorTypeID = ITCT.creatorTypeID AND ITCT.itemTypeID = O.itemTypeID)
    WHERE itemID = O.itemID AND primaryField = 1
  )
  WHEN 2 THEN (
    SELECT PRINTF('%s and %s',
      (SELECT '⁨' || lastName || '⁩' FROM itemCreators IC NATURAL JOIN creators
         LEFT JOIN itemTypeCreatorTypes ITCT
           ON (IC.creatorTypeID = ITCT.creatorTypeID AND ITCT.itemTypeID = O.itemTypeID)
       WHERE itemID = O.itemID AND primaryField = 1
       ORDER BY orderIndex LIMIT 1),
      (SELECT '⁨' || lastName || '⁩' FROM itemCreators IC NATURAL JOIN creators
         LEFT JOIN itemTypeCreatorTypes ITCT
           ON (IC.creatorTypeID = ITCT.creatorTypeID AND ITCT.itemTypeID = O.itemTypeID)
       WHERE itemID = O.itemID AND primaryField = 1
       ORDER BY orderIndex LIMIT 1,1)
    )
  )
  ELSE (
    SELECT (SELECT lastName FROM itemCreators IC NATURAL JOIN creators
              LEFT JOIN itemTypeCreatorTypes ITCT
                ON (IC.creatorTypeID = ITCT.creatorTypeID AND ITCT.itemTypeID = O.itemTypeID)
            WHERE itemID = O.itemID AND primaryField = 1
            ORDER BY orderIndex LIMIT 1)
           || ' et al.'
  )
END
```

The three fallback arms (editor → director → contributor) are the same shape but the `<where>` becomes `WHERE itemID = O.itemID AND creatorTypeID = <hardcoded-id>` (`items.js:1508-1510`). All four arms sit inside one outer `COALESCE(..., ..., ..., ...) AS firstCreator`.

### 2.5 Output shape

| Match count for chosen type | Output |
|---|---|
| 0 | NULL — fall through `COALESCE` to next type |
| 1 | `lastName` |
| 2 | `PRINTF(andJoiner, '⁨'+lastA+'⁩', '⁨'+lastB+'⁩')` — each `lastName` wrapped in **U+2068 First Strong Isolate / U+2069 Pop Directional Isolate** so the locale joiner doesn't break bidi |
| 3+ | `lastName1 + ' ' + etAl` |

Only `lastName` is read. For `fieldMode=1` (organisations) that's the literal, which prints correctly without a special case.

### 2.6 Worked examples

Inputs given as ordered `(role, firstName, lastName, fieldMode)` rows on an item; UI locale = en (`andJoiner = '%s and %s'`, `etAl = 'et al.'`). Bidi marks shown as `⁨...⁩`.

| Item type | Creators on item | Walk | `firstCreator` |
|---|---|---|---|
| journalArticle | *(none)* | all four CASEs → NULL | `NULL` |
| journalArticle | `(author, Jane, Smith, 0)` | author count=1 | `Smith` |
| journalArticle | `(author, J., Smith, 0)`, `(author, M., Jones, 0)` | author count=2 → PRINTF | `⁨Smith⁩ and ⁨Jones⁩` |
| journalArticle | Smith / Jones / Brown (3 authors) | author count=3 → ELSE | `Smith et al.` |
| journalArticle | Smith / Jones / Brown / Wilson (4 authors) | same ELSE arm | `Smith et al.` |
| book | `(editor, R., Davis, 0)` only | author CASE NULL; editor count=1 | `Davis` |
| book | `(translator, …, Keene, 0)` only | translator isn't in the priority list — all four miss | `NULL` |
| journalArticle | `(author, '', 'Acme Corp', 1)` | author count=1 → returns the literal in `lastName` | `Acme Corp` |
| journalArticle | Two orgs as authors: `Acme Corp` + `Beta Inc` (`fieldMode=1`) | PRINTF | `⁨Acme Corp⁩ and ⁨Beta Inc⁩` |
| interview | `(interviewer, J., Frost, 0)` + `(interviewee, R., Nixon, 0)` | for `itemType=interview`, primary is `interviewer`; CASE 1 matches | `Frost` |
| videoRecording (legacy, no Author entries) | one `director` only | author/editor NULL; director count=1 | `<DirectorLastName>` |

Locale variations on the 2-author case:

- de UI (`andJoiner = '%s und %s'`) → `⁨Smith⁩ und ⁨Jones⁩`
- zh-CN UI (`andJoiner = '%s和%s'`) → `⁨Smith⁩和⁨Jones⁩` (no surrounding spaces — that's how the locale string is defined)

Locale variations on the 3+ case substitute `etAl` only — the rest of the string is locale-independent.

### 2.7 JS twin for unsaved items

`Zotero.Item::getField('firstCreator')` short-circuits to a JS port when the row hasn't been persisted yet:

```js
// chrome/content/zotero/xpcom/data/item.js:245-249
if (field === 'firstCreator' && !this._id) {
    // Hack to get a firstCreator for an unsaved item
    let creatorsData = this.getCreators(true);
    return Zotero.Items.getFirstCreatorFromData(this.itemTypeID, creatorsData,
        { omitBidiIsolates: !!unformatted });
}
```

`Zotero.Items.getFirstCreatorFromData` (`chrome/content/zotero/xpcom/data/items.js:1321-1365`) reproduces the SQL byte-for-byte against an in-memory `creators[]` array. Same priority order, same 1/2/3+ branches, same bidi isolates (optional via `omitBidiIsolates`).

The priority order's first entry is resolved via `Zotero.CreatorTypes.getPrimaryIDForType(itemTypeID)` (`chrome/content/zotero/xpcom/data/cachedTypes.js:325-337`), backed by `_primaryIDCache` populated from `SELECT itemTypeID, creatorTypeID FROM itemTypeCreatorTypes WHERE primaryField=1` at `cachedTypes.js:268-276`.

### 2.8 How it surfaces on the Item

When primary data loads, the column lands as `item._firstCreator` and is exposed read-only:

```js
// chrome/content/zotero/xpcom/data/item.js:43, 170-172
this._firstCreator = null;
...
Zotero.defineProperty(Zotero.Item.prototype, 'firstCreator', {
    get: function () { return this._firstCreator; }
});
```

`getField('firstCreator')` also strips the bidi isolates when called with `unformatted=true` (`item.js:253-256`).

---

## 3. `sortCreator` — collation key

A second virtual column, **shape-matched to `firstCreator` but tuned for sorting**, not display.

### 3.1 SQL builder

`chrome/content/zotero/xpcom/data/items.js:1529-1582` — `_getSortCreatorSQL()`:

```js
// items.js:1535
let nameSQL = "lastName || ' ' || firstName ";

// items.js:1539-1561  (same caseBlock pattern as firstCreator)
"CASE (SELECT COUNT(*) FROM itemCreators IC <where>) "
  + "WHEN 0 THEN NULL "
  + "WHEN 1 THEN (SELECT " + nameSQL + " ... LIMIT 1) "
  + "WHEN 2 THEN (... LIMIT 1) || ' ' || (... LIMIT 1,1) "
  + "ELSE       (... LIMIT 1) || ' ' || (... LIMIT 1,1) || ' ' || (... LIMIT 2,1) "
  + "END"
```

```js
// items.js:1571-1578 — same COALESCE priority list as firstCreator
"COALESCE("
  + caseBlock(primaryJoin)
  + caseBlock(creatorTypeWhere('editor'))
  + caseBlock(creatorTypeWhere('director'))
  + caseBlock(creatorTypeWhere('contributor'))
+ ") AS sortCreator"
```

### 3.2 Differences from `firstCreator`

|   | `firstCreator` | `sortCreator` |
|---|---|---|
| Name parts | `lastName` only | `lastName \|\| ' ' \|\| firstName` |
| Creators included | up to 2 (then `et al.`) | up to 3 |
| Locale strings | `andJoiner` / `etAl` | none — pure name concat |
| Bidi isolates | yes (U+2068/U+2069) | no |
| Purpose | shown to humans | fed to `Intl.Collator` |

For organisations (`fieldMode=1`, `firstName=''`), the concat produces `"OrgName "` with a trailing space — harmless for collation.

### 3.3 What SQLite actually does, per row

Same execution shape as `firstCreator` (four `COALESCE`'d `CASE` blocks, same priority types in the same order, dynamic primary-type join), but each arm's inner subquery emits `lastName || ' ' || firstName` and the multi-creator arms space-concat up to three creators. No `PRINTF`, no locale strings, no bidi isolates.

Per-arm output (within one creator type):

| Match count | Inner SELECT |
|---|---|
| 0 | NULL → `COALESCE` moves on |
| 1 | `lastName \|\| ' ' \|\| firstName` of row 1 |
| 2 | `(row 1) \|\| ' ' \|\| (row 2)` |
| 3+ | `(row 1) \|\| ' ' \|\| (row 2) \|\| ' ' \|\| (row 3)` — **only the first three** |

Notes:

- **Cap is hard at three creators.** A 4-author item shares its sort key with a 3-author item that has the same first three authors. Rarely a problem in practice, but it does mean tie-breaking stops at the third creator.
- **No `fieldMode` branch.** Single-field literals (orgs) go through the same `lastName || ' ' || firstName` concat. Since `firstName` is empty, the result is `"OrgName "` with a trailing space. For two orgs, that produces a double-space between them and a trailing space (`"Acme Corp  Beta Inc "`). `Intl.Collator` collapses whitespace runs for primary collation, so this is harmless but real.
- **Same `<where>` re-evaluation cost** as `firstCreator` (count + 1–3 `LIMIT`s per arm).

### 3.4 Fully expanded form of one `CASE` arm

The first (primary-type) arm of the outer `COALESCE`, fully substituted:

```sql
CASE (
  SELECT COUNT(*) FROM itemCreators IC
    LEFT JOIN itemTypeCreatorTypes ITCT
      ON (IC.creatorTypeID = ITCT.creatorTypeID AND ITCT.itemTypeID = O.itemTypeID)
  WHERE itemID = O.itemID AND primaryField = 1
)
  WHEN 0 THEN NULL
  WHEN 1 THEN (
    SELECT lastName || ' ' || firstName FROM itemCreators IC NATURAL JOIN creators
      LEFT JOIN itemTypeCreatorTypes ITCT
        ON (IC.creatorTypeID = ITCT.creatorTypeID AND ITCT.itemTypeID = O.itemTypeID)
    WHERE itemID = O.itemID AND primaryField = 1
  )
  WHEN 2 THEN (
    SELECT
      (SELECT lastName || ' ' || firstName FROM itemCreators IC NATURAL JOIN creators
         LEFT JOIN itemTypeCreatorTypes ITCT
           ON (IC.creatorTypeID = ITCT.creatorTypeID AND ITCT.itemTypeID = O.itemTypeID)
       WHERE itemID = O.itemID AND primaryField = 1
       ORDER BY orderIndex LIMIT 1)
      || ' ' ||
      (SELECT lastName || ' ' || firstName ... ORDER BY orderIndex LIMIT 1,1)
  )
  ELSE (
    SELECT
      (SELECT lastName || ' ' || firstName ... ORDER BY orderIndex LIMIT 1)
      || ' ' ||
      (SELECT lastName || ' ' || firstName ... ORDER BY orderIndex LIMIT 1,1)
      || ' ' ||
      (SELECT lastName || ' ' || firstName ... ORDER BY orderIndex LIMIT 2,1)
  )
END
```

(The three trailing `LIMIT`s in the `ELSE` block read positions 0, 1, 2 — that's where the "first three" cap comes from. The editor/director/contributor arms replace the `LEFT JOIN itemTypeCreatorTypes ... primaryField=1` with `WHERE itemID = O.itemID AND creatorTypeID = <hardcoded-id>`.)

### 3.5 Worked examples

Same inputs as the `firstCreator` examples (en UI locale, but UI locale doesn't matter here):

| Item type | Creators on item | `sortCreator` |
|---|---|---|
| journalArticle | *(none)* | `NULL` |
| journalArticle | `(author, Jane, Smith, 0)` | `Smith Jane` |
| journalArticle | `(author, J., Smith, 0)`, `(author, M., Jones, 0)` | `Smith J. Jones M.` |
| journalArticle | Smith / Jones / Brown (3 authors) | `Smith J. Jones M. Brown D.` |
| journalArticle | Smith / Jones / Brown / Wilson (4 authors) | `Smith J. Jones M. Brown D.` — Wilson **not** included |
| book | `(editor, R., Davis, 0)` only | `Davis R.` |
| book | `(translator, …, Keene, 0)` only | `NULL` |
| journalArticle | `(author, '', 'Acme Corp', 1)` | `Acme Corp ` — trailing space from empty `firstName` |
| journalArticle | Two orgs as authors: `Acme Corp` + `Beta Inc` (`fieldMode=1`) | `Acme Corp  Beta Inc ` — double space between, trailing space |
| interview | `(interviewer, J., Frost, 0)` + `(interviewee, R., Nixon, 0)` | `Frost J.` (only the interviewer — primary type for `interview`) |

How these sort against each other under the en locale collator after `getSortTitle` strips leading punctuation:

```
Acme Corp
Acme Corp  Beta Inc
Brown D. Davis E.
Davis R.
Smith J. Jones M.
Smith J. Jones M. Brown D.
Smith Jane
```

Notice `Smith J. Jones M.` and `Smith J. Jones M. Brown D.` sort adjacently (first two creators identical), which is the whole point of carrying a longer sort key than the display string.

### 3.6 How it surfaces on the Item

```js
// chrome/content/zotero/xpcom/data/item.js:44, 173-175
this._sortCreator = null;
...
Zotero.defineProperty(Zotero.Item.prototype, 'sortCreator', {
    get: function () { return this._sortCreator; }
});
```

No JS twin: unsaved items have `this._sortCreator === null`, which the only consumers (sort paths) tolerate by falling back to `firstCreator`. See `item.js:244` — `// TODO: Add sortCreator`.

### 3.7 Consumers

**Items pane column sort** — `chrome/content/zotero/itemTree.jsx:618-637`:

```js
// itemTree.jsx:519-528 (state init)
this._sortCollation       = Zotero.getLocaleCollation();
this._sortCreatorAsString = Zotero.Prefs.get('sortCreatorAsString');
this._sortCreatorCache    = {};
```

```js
// itemTree.jsx:618-637 (_compareField, 'firstCreator' case)
case 'firstCreator': {
    let prop = this._sortCreatorAsString ? 'firstCreator' : 'sortCreator';
    let cache = this._sortCreatorCache;
    let fieldA = cache[a.id];
    let fieldB = cache[b.id];
    if (fieldA === undefined) {
        let s = a.ref[prop];
        if (!s) s = a.ref.getField('firstCreator');     // unsaved fallback
        cache[a.id] = fieldA = Zotero.Items.getSortTitle(s || '');
    }
    if (fieldB === undefined) { /* same */ }
    if (fieldA === '' && fieldB === '') return  0;
    if (fieldA === '' && fieldB !== '') return  1;
    if (fieldA !== '' && fieldB === '') return -1;
    return this._sortCollation.compareString(1, fieldA, fieldB);
}
```

Key points:

1. **Default sort key is the long form** (`sortCreator`), so two items with display `"Smith et al."` don't collide — they're tie-broken on the second and third authors.
2. **Pref `extensions.zotero.sortCreatorAsString`** (`itemTree.jsx:524`) flips the key to `firstCreator`, making the column sort strictly by displayed text.
3. **`Zotero.Items.getSortTitle(s)`** (`items.js:1599-1612`) strips inline HTML tags (`<i>`, `<b>`, `<span class="nocase">`, …) and leading punctuation before comparison. The strip regex list is at `items.js:1585-1596`.
4. **Collation** uses `Zotero.getLocaleCollation()` — a Mozilla `nsICollation` — so the final order is Unicode/locale-aware (case-fold, German ß, accent equivalence, etc.).
5. **`_sortCreatorCache`** memoises the computed sort key per row for the duration of one `_sort()` call.

**Local-server REST sort** — `chrome/content/zotero/xpcom/server/server_localAPI.js:167-168`:

```js
if (sort == 'creator') {
    sort = 'sortCreator';
}
```

`?sort=creator` on the local API is rewritten transparently to `sortCreator`. Same intent: sort by spelled-out names, not the abbreviated display.

---

## 4. Why two fields exist

`firstCreator` alone can't drive a stable sort:

- Two papers with display `"Smith et al."` collide as identical keys → unstable ordering of multi-author rows.
- The bidi isolates inside the display string would confuse a collator.

`sortCreator` solves both: a longer (up to three authors), bidi-free, plain-text key tuned for `Intl.Collator`. Same priority axis (per-itemType primary → editor → director → contributor), different output shape.

---

## 5. CSL bibliography layer — locale-aware family/given ordering

Neither `firstCreator` nor `sortCreator` does any locale-aware name reordering. They always read `lastName` (and `firstName` for sort). All script/locale logic lives in **citeproc-js**, the bundled CSL processor, and only fires when output goes through CSL (bibliography, Cite-As-You-Write, Quick-Copy in citation mode).

Source: `chrome/content/zotero/xpcom/citeproc.js`.

### 5.1 Input handoff — `itemToCSLJSON`

Zotero hands citeproc a plain CSL-JSON shape. The creator-mapping branch is at `chrome/content/zotero/xpcom/utilities/utilities_item.js:138-183`:

```js
// utilities_item.js:152-159
if (creator.name || (creator.fieldMode === 1 && creator.lastName && !creator.firstName)) {
    nameObj = { literal: creator.name || creator.lastName };
}
else if (creator.lastName || creator.firstName) {
    nameObj = {
        family: creator.lastName || '',
        given:  creator.firstName || ''
    };
    // ...particle parsing at lines 164-174 via Zotero.Utilities.Item.parseParticles
}
```

So Zotero feeds citeproc:

- `{literal: "..."}` for `fieldMode=1` / single-field — citeproc never reorders these.
- `{family: lastName, given: firstName, [non-dropping-particle], [dropping-particle], [suffix]}` otherwise.

The item's `language` field travels alongside as `cslItem.language` and is the trigger for most locale-aware behaviour below.

### 5.2 Per-name script auto-detection — `_isRomanesque`

`chrome/content/zotero/xpcom/citeproc.js:13778-13802`:

```js
CSL.NameOutput.prototype._isRomanesque = function (name) {
    // 0 = entirely non-romanesque, 1 = mixed, 2 = pure romanesque
    var ret = 2;
    if (!name.family.replace(/\"/g, '').match(CSL.ROMANESQUE_REGEXP)) {
        ret = 0;
    }
    if (!ret && name.given && name.given.match(CSL.STARTSWITH_ROMANESQUE_REGEXP)) {
        ret = 1;
    }
    var top_locale;
    if (ret == 2) {
        if (name.multi && name.multi.main) top_locale = name.multi.main.slice(0, 2);
        else if (this.Item.language)       top_locale = this.Item.language.slice(0, 2);
        if (["ja", "zh"].indexOf(top_locale) > -1) ret = 1;   // force family-first
    }
    return ret;
};
```

Three buckets:

- **0 — non-romanesque** (e.g. pure CJK family name): renders `family + given` **with no separator**, so `毛澤東` not `毛 澤東`.
- **1 — mixed, or pure romanesque but `Item.language` starts with `ja`/`zh`**: family-first **with a space** (`Mao Zedong`).
- **2 — pure romanesque, language not ja/zh**: defers to the style's directives (typically given-first in bibliographies).

The render-side switch is at `chrome/content/zotero/xpcom/citeproc.js:13851-13859`:

```js
if (romanesque === 0) {
    blob = this._join([non_dropping_particle, family, given], "");
} else if (romanesque === 1 || name["static-ordering"]) {
    merged = this._join([non_dropping_particle, family], nbspace);
    blob = this._join([merged, given], " ");
} else if (name["reverse-ordering"]) {
    merged = this._join([non_dropping_particle, family], nbspace);
    blob = this._join([given, merged], " ");
}
// ...further branches for given-first / sort-order / et al.
```

### 5.3 Style/locale directives — `name-as-sort-order`

CSL styles can declare `<name name-as-sort-order="first|all"/>` and locales can declare `<style-options name-as-sort-order="zh ja ko"/>`. Citeproc looks the item's bare language code up against the locale's list at `chrome/content/zotero/xpcom/citeproc.js:14344-14362`:

```js
CSL.NameOutput.prototype.getNameParams = function (langTag) {
    var ret = {};
    var langspec = CSL.localeResolve(this.Item.language, this.state.opt["default-locale"][0]);
    var try_locale = this.state.locale[langspec.best] ? langspec.best
                                                      : this.state.opt["default-locale"][0];
    var name_as_sort_order   = this.state.locale[try_locale].opts["name-as-sort-order"];
    var name_as_reverse_order = this.state.locale[try_locale].opts["name-as-reverse-order"];
    var name_never_short      = this.state.locale[try_locale].opts["name-never-short"];
    var field_lang_bare       = langTag.split("-")[0];

    if (name_as_sort_order && name_as_sort_order[field_lang_bare]) {
        ret["static-ordering"]  = true;     // force family-first
        ret["reverse-ordering"] = false;
    }
    if (name_as_reverse_order && name_as_reverse_order[field_lang_bare]) {
        ret["reverse-ordering"] = true;
        ret["static-ordering"]  = false;
    }
    if (name_never_short && name_never_short[field_lang_bare]) {
        ret["full-form-always"] = true;
    }
    ...
};
```

Other relevant references:

- Attribute declaration: `chrome/content/zotero/xpcom/citeproc.js:671`, `9705-9710`, `17254-17258`.
- Per-name option resolution that calls `getStaticOrder`: `citeproc.js:14255, 14313, 14475-...`.

### 5.4 Decision tree (per creator)

Citeproc's effective decision for a single creator, in order:

1. Is `nameObj.literal` set? → emit verbatim, no reordering. (`fieldMode=1` always lands here.)
2. Does `family` fail the romanesque regex? → `family+given` (no space).
3. Is `Item.language` `ja*` or `zh*`? → family-first with a space.
4. Does the active CSL locale's `name-as-sort-order` list include the item's bare language? → family-first with a space.
5. Does the active CSL style/element set `name-as-sort-order="all"` (or `"first"` for position 0)? → family-first with the style's `sort-separator`.
6. Otherwise → given-first with the style's punctuation.

### 5.5 What this means for Zotero's UI vs CSL

| Surface | Locale-aware? | Lever |
|---|---|---|
| Items pane "Creator" column | No — `firstCreator` is `lastName` only | none |
| `sortCreator` collation | Partial — `Intl.Collator` is locale-aware for *byte comparison*, but the key itself is always `"lastName firstName"` | `getLocaleCollation()` + `sortCreatorAsString` pref |
| Bibliography / CAYW via CSL | Yes — `_isRomanesque` + `name-as-sort-order` | `Item.language` field + selected CSL style |
| Templates/plugins (ZotLit, BBT, etc.) | Whatever the plugin author writes — Zotero provides no helper | n/a |

The "right" way to surface a locale-correct *display* author string in a plugin is to either (a) mirror Zotero's UI choice and show only `lastName`, or (b) port the script test from `_isRomanesque` and honour `Item.language`. Anything else baking in a fixed `"firstName lastName"` or `"lastName firstName"` will print Chinese/Japanese names wrong on at least some items.

---

## 6. Key file references

| Concern | File | Lines |
|---|---|---|
| Schema (creators / itemCreators / creatorTypes) | `chrome/content/zotero/xpcom/db/.../userdata.sql` | 113–116, 269–288 |
| Primary data column registration | `chrome/content/zotero/xpcom/data/items.js` | 43–82 |
| `_loadCreators` (read + `ORDER BY orderIndex`) | `chrome/content/zotero/xpcom/data/items.js` | 335–405 |
| Items cache invariant comment | `chrome/content/zotero/xpcom/data/items.js` | 1463–1467 |
| `_getFirstCreatorSQL` | `chrome/content/zotero/xpcom/data/items.js` | 1469–1523 |
| `_getSortCreatorSQL` | `chrome/content/zotero/xpcom/data/items.js` | 1529–1582 |
| `getSortTitle` (strip regex list) | `chrome/content/zotero/xpcom/data/items.js` | 1585–1612 |
| `getFirstCreatorFromData` (JS twin) | `chrome/content/zotero/xpcom/data/items.js` | 1321–1365 |
| `_firstCreator` / `_sortCreator` defaults | `chrome/content/zotero/xpcom/data/item.js` | 43–44 |
| `firstCreator` / `sortCreator` getters | `chrome/content/zotero/xpcom/data/item.js` | 170–175 |
| Unsaved-item fallback in `getField` | `chrome/content/zotero/xpcom/data/item.js` | 245–249 |
| `setCreator` / `removeCreator` (orderIndex shifting) | `chrome/content/zotero/xpcom/data/item.js` | 1174–1269 |
| Creator save (INSERT OR REPLACE) | `chrome/content/zotero/xpcom/data/item.js` | 1565–1607 |
| `_primaryIDCache` for `getPrimaryIDForType` | `chrome/content/zotero/xpcom/data/cachedTypes.js` | 268–276, 325–337 |
| Items pane sort comparator | `chrome/content/zotero/itemTree.jsx` | 519–637 |
| `sortCreatorAsString` pref read | `chrome/content/zotero/itemTree.jsx` | 524 |
| REST `?sort=creator` rewrite | `chrome/content/zotero/xpcom/server/server_localAPI.js` | 167–168 |
| `itemToCSLJSON` creator mapping | `chrome/content/zotero/xpcom/utilities/utilities_item.js` | 138–183 |
| citeproc `_isRomanesque` | `chrome/content/zotero/xpcom/citeproc.js` | 13778–13802 |
| citeproc name render switch | `chrome/content/zotero/xpcom/citeproc.js` | 13851–13859 |
| citeproc `getNameParams` (locale lookup) | `chrome/content/zotero/xpcom/citeproc.js` | 14344–14362 |
| citeproc `name-as-sort-order` attribute | `chrome/content/zotero/xpcom/citeproc.js` | 671, 9705–9710, 17254–17258 |
