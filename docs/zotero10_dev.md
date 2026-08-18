# Zotero 10 for ZotLit: Platform, Database, and API Changes

Sequel to [`zotero9_dev.md`](./zotero9_dev.md). That note covers Zotero 7 → 8 → 9. This note covers **Zotero 9 → Zotero 10** and states what ZotLit must do.

Research date: 2026-08-18.

**Method.** Every claim below points to one of three sources:

- A source checkout at `~/repo/zotlit-repo/zotero-10` (tag `10.0.0`, commit `22f08d1ced`, 2026-08-17) compared with `~/repo/zotlit-repo/zotero` (tag `9.0.3`, commit `451d96a824`, 2026-05-06). Both checkouts share history, so `git diff 9.0.3 HEAD` is exact.
- The official page `https://www.zotero.org/support/dev/zotero_10_for_developers` (page states "Last Updated 2026-08-06").
- ZotLit's own code in this repository.

Where the official page and the source disagree, the source wins. Three such disagreements are recorded in Section 6.

---

## 1. Release status and platform

| Item | Zotero 9.0.3 | Zotero 10.0.0 |
| --- | --- | --- |
| Gecko / Firefox base | `140.10.0esr` | `140.14.0esr` |
| `userdata` schema version | 125 | 129 |
| `compatibility` version | 7 | 9 |
| `system` schema version | 32 | 32 |
| `triggers` schema version | 18 | 18 |
| Bundled global schema (`schema.json`) | 42 | 44 |

Evidence:

- Gecko: `app/config.sh:4-6` in each checkout (`GECKO_VERSION_MAC` / `_LINUX` / `_WIN`).
- `userdata`: first line of `resource/schema/userdata.sql` (`-- 125` against `-- 129`).
- `compatibility`: `chrome/content/zotero/xpcom/schema.js:45` (`var _maxCompatibility = 9;`, was `7`).
- `system` / `triggers`: first line of `resource/schema/system.sql` and `resource/schema/triggers.sql`. Both unchanged.
- Global schema: the `resource/schema/global` submodule pointer moves from `62e983a2` (version 42) to `70c3aa98` (version 44).

**Platform.** Zotero 10 stays on the Firefox 140 ESR line. Only the ESR patch level moves. No ESM migration, no XPCOM removal, and no Bluebird work is necessary — that was the Zotero 8 transition.

**Release date.** The `10.0.0` tag is dated 2026-08-17, one day before this research. The tag exists in the source repository. Whether the public stable build was already published is **not verified**.

**`strict_max_version`.** The official page tells plugin authors to set `10.0.*` after they confirm compatibility. Strict enforcement is unchanged: `app/scripts/fetch_xulrunner:270-282` patches Firefox's `XPIInstall.sys.mjs` so that `strictCompatibility` is `false` only for builds whose version string contains `-beta`, `-dev`, or `SOURCE`. The same patch is present in 9.0.3 (`git show 9.0.3:app/scripts/fetch_xulrunner:250-253`), so this is **not** a Zotero 10 change.

**Global schema 42 → 44.** No item type and no field was added or removed. A programmatic comparison of the two `schema.json` files shows identical `itemTypes` sets, identical per-type field sets, and an identical `csl` block. The two upstream commits are "Update locales and version" and "Update schema version (search-condition-groups gate)". `packages/zotero-types` therefore needs **no** regeneration for Zotero 10.

---

## 2. Database and SQLite changes

### 2.1 WAL verdict

**Zotero 10 turns WAL on. Zotero 9 and earlier do not use WAL. ZotLit's database service already handles both correctly and needs no change to stay compatible.** One optimization gap remains on platforms that cannot reflink (Section 2.3).

#### What Zotero 10 changed

`chrome/content/zotero/xpcom/db.js:1551-1557`:

```js
// Enable WAL mode for better write performance. With locking_mode=EXCLUSIVE
// set first, SQLite uses heap memory for the WAL index instead of shared
// memory, so no -shm file is created on disk.
await this.queryAsync("PRAGMA journal_mode=WAL");
// NORMAL synchronous is safe with WAL -- only risks losing the last
// transaction on power loss, not corruption
await this.queryAsync("PRAGMA synchronous=NORMAL");
```

Zotero 9.0.3 has no such lines. Its connect path (`chrome/content/zotero/xpcom/db.js:1279-1295`) sets `locking_mode`, `cache_size`, and `foreign_keys` only. It never sets `journal_mode`, so SQLite keeps its `delete` default and writes a `-journal` file, not a `-wal` file. A search of the whole Zotero 9 `xpcom/` tree for the string `-wal` returns no hit outside vendored `package-lock.json` files.

Related Zotero 10 facts, all in `db.js`:

- `DB_LOCK_EXCLUSIVE = true` (line 32) is unchanged from Zotero 9. Zotero still sets `PRAGMA main.locking_mode=EXCLUSIVE` (line 1545). A running Zotero therefore still holds a connection-lifetime SQLite lock on `zotero.sqlite`.
- Because `locking_mode=EXCLUSIVE` is set **before** `journal_mode=WAL`, SQLite keeps the WAL index in heap memory and writes **no `-shm` file** to disk (comment at lines 1551-1553). The `-wal` file itself is on disk.
- New option `openNotExclusive: true` on `Sqlite.openConnection` (line 1520). The comment at lines 1512-1516 says this drops the OS-level exclusive open lock so the database can live on a network filesystem (SMB), and cites Zotero issue #4860.
- WAL is truncated on idle (`PRAGMA wal_checkpoint(TRUNCATE)`, line 933) and on clean close (lines 1172-1173). A non-empty `-wal` file at startup therefore means the last session did not close cleanly, and Zotero then runs `PRAGMA integrity_check(1)` (lines 1497-1500 and 1566-1590).
- `VACUUM` moved out of `executeTransaction({ vacuumOnCommit })` into a new `Zotero.DBConnection.prototype.vacuum()` that uses `VACUUM INTO` plus an atomic file swap (lines 957-1050). Two new preferences drive it: `extensions.zotero.vacuum.interval` (14 days) and `extensions.zotero.vacuum.freelistThreshold` (10 %), in `defaults/preferences/zotero.js`.

The official page's statement that Zotero 10 "requires accounting for `-wal` and `-shm` files" is only half right for the default configuration: a `-shm` file is **absent** while `locking_mode=EXCLUSIVE` is in force.

#### What ZotLit already does

`apps/obsidian/src/services/database/read-source.ts` is already written for WAL. Its module comment states the design, and the code matches:

- `prepareTempRead` (reflink or copy mode) clones `zotero.sqlite` **and** `zotero.sqlite-wal` into a fresh writable temp directory, then opens the clone with `mode=ro` (not `immutable`) so SQLite can build the `-shm` sidecar in that directory and replay the cloned WAL.
- The WAL copy is conditional: `before.wal.exists ? copySource(...) : undefined`. A Zotero 9 data directory has no `-wal` file, and the clone still succeeds.
- A before/after fingerprint of the `(main, wal)` pair guards against a torn snapshot, with 3 attempts and a 25 ms backoff.
- `immutableRead` opens the live file with `mode=ro&immutable=1`. SQLite then skips locking and reads the committed main database only.

`apps/obsidian/src/services/database/service.ts` watches the WAL too: `ZOTERO_WAL_FILENAME` is `"zotero.sqlite-wal"` (`apps/obsidian/src/lib/constants.ts:76`), `#syncWalWatcher` (line 537) opens and closes a watcher on that file as it appears and disappears, and `#watchedFilename` (line 530) accepts WAL directory events except in `immutable` mode.

So the WAL work is **done**. No required change.

### 2.2 One correction to the module comment

`read-source.ts` opens with:

> Zotero keeps `zotero.sqlite` open in WAL mode with exclusive locking while it runs …

That sentence is true for Zotero 10 and **false for Zotero 9**, which ZotLit also supports. The code is correct either way; only the prose over-generalizes. A one-line edit that names the version boundary is worth making, because a future reader may otherwise assume a `-wal` file always exists.

### 2.3 The `immutable` fallback is now lossy on Zotero 10

`prepareRead` degrades to `immutable` whenever a native reflink is impossible, and `isNativeCloneCapabilityError` treats **any platform other than darwin and linux** as a capability failure. The default setting is `"zotero.read-mode": "auto"` (`apps/obsidian/src/services/settings/schema.ts:164`), and `auto` never falls back to full `copy` — that choice is deliberate and documented in the `prepareRead` doc comment.

Consequence on Zotero 10:

- macOS and Linux on a reflink-capable volume: unchanged, WAL-fresh.
- Windows, and any volume that cannot reflink: ZotLit reads the main database file only. Every transaction that Zotero committed since the last checkpoint is invisible.

On Zotero 9 this cost nothing, because all committed data was always in the main file. On Zotero 10 the staleness window lasts until Zotero next checkpoints, which happens on idle or at clean shutdown. During an active editing session, that window can be long.

This is an **optional optimization**, not a compatibility break — ZotLit still reads a valid, if older, database. Section 5 lists the candidate fixes.

### 2.4 Direct-read safety is unchanged in kind

Zotero still holds `locking_mode=EXCLUSIVE`, so ZotLit still cannot open the live file with an ordinary read-only connection while Zotero runs. The clone path and the `immutable=1` path both stay valid. ZotLit performs no writes, which matches Zotero's own standing guidance quoted in `zotero9_dev.md` §4.3.

One residual risk is **reasoned, not verified**: an `immutable=1` read that lands while Zotero is copying pages during a checkpoint could observe a partially checkpointed main file. The same class of risk existed before Zotero 10 with a rollback journal, so this is not new, but it is more frequent now because checkpoints are a routine background event.

### 2.5 New file in the data directory: `fulltext.sqlite`

Zotero 10 rewrote full-text search on SQLite FTS5 in a **separate attached database**:

- `chrome/content/zotero/xpcom/fulltext.js:112` calls `Zotero.DB.loadExtension('fts5')`.
- Line 115 runs `ATTACH DATABASE ? AS ftindex`, where the path is `fulltext.sqlite` in the data directory (comments at lines 43 and 101).
- Lines 143-167 create the virtual tables `ftindex.fulltextContent`, `ftindex.fulltextContentCJK`, `ftindex.fulltextNotes`, and `ftindex.fulltextNotesCJK`.

ZotLit does not read the full-text index, so this file is only a new neighbour in the watched directory. `#watchedFilename` already filters it out.

---

## 3. Schema changes

Four `userdata` migration steps run between 125 and 129. All live in `chrome/content/zotero/xpcom/schema.js`.

### 3.1 Step 126 — normalized shadow columns (`schema.js:3686-3696`)

Verbatim DDL:

```js
else if (i == 126) {
    await _updateCompatibility(8);

    await Zotero.DB.queryAsync("ALTER TABLE itemDataValues ADD COLUMN valueNormalized TEXT");
    await Zotero.DB.queryAsync("ALTER TABLE tags ADD COLUMN nameNormalized TEXT");
    await Zotero.DB.queryAsync("ALTER TABLE creators ADD COLUMN firstNameNormalized TEXT");
    await Zotero.DB.queryAsync("ALTER TABLE creators ADD COLUMN lastNameNormalized TEXT");
    await Zotero.DB.queryAsync("ALTER TABLE itemAnnotations ADD COLUMN textNormalized TEXT");
    await Zotero.DB.queryAsync("ALTER TABLE itemAnnotations ADD COLUMN commentNormalized TEXT");
    await Zotero.DB.queryAsync("REPLACE INTO settings VALUES ('search', 'normalizeBackfill', 1)");
}
```

The resulting table in `resource/schema/userdata.sql:248-251`:

```sql
CREATE TABLE tags (
    tagID INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    nameNormalized TEXT
);
```

The question as posed said Zotero 10 "adds `nameNormalized` on tags". That is correct, but incomplete in three ways:

1. **It is one of six columns across four tables**, not a tags-only feature.
2. **There is no index on any of them.** A search of `resource/schema/userdata.sql` for `CREATE INDEX` returns no hit on `nameNormalized`, `valueNormalized`, `firstNameNormalized`, `lastNameNormalized`, `textNormalized`, or `commentNormalized`. Zotero reads them only through `COALESCE`, inside `LIKE` predicates that scan anyway.
3. **The column is `NULL` for most rows by design.** It is a sparse shadow, not a mirror.

**Type:** `TEXT`, nullable, no default, no constraint, no index.

**How it is populated.**

New rows are written at insert time. `chrome/content/zotero/xpcom/data/tags.js:122-124`:

```js
let sql = "INSERT INTO tags (tagID, name, nameNormalized) VALUES (?, ?, ?)";
let nameNormalized = Zotero.Utilities.Internal.normalizeForSearchStorage(data.tag);
await Zotero.DB.queryAsync(sql, [id, data.tag, nameNormalized]);
```

The equivalents are `data/item.js:1749` and `:1778-1779` (`itemDataValues`), `data/item.js:2276` and `:2286-2288` (`itemAnnotations`), and `data/creators.js:122-123` (`creators`).

Pre-existing rows are filled by a background backfill: `Zotero.Schema.populateNormalizedSearchColumns` (`schema.js:798-914`). It is chunked at 1000 rows, resumable across restarts through the `settings` row `('search', 'normalizeBackfill')`, and runs **after** the first auto-sync, silently and without a progress window (`chrome/content/zotero/xpcom/zotero.js:829-844`). Search "degrades gracefully until it finishes" — Zotero's own words.

**Why most values are `NULL`.** `Zotero.Utilities.Internal.normalizeForSearchStorage` (`chrome/content/zotero/xpcom/utilities_internal.js:122-133`) returns `null` unless normalizing changes more than the case of ASCII letters:

```js
normalizeForSearchStorage: function (value) {
    if (typeof value != 'string' || !value) {
        return null;
    }
    let normalized = Zotero.Utilities.Internal.normalizeForSearch(value);
    // Lowercasing only the ASCII letters, so the comparison treats a case difference as
    // significant unless LIKE would fold it
    let asciiLowercased = value.replace(/[A-Z]/g, c => c.toLowerCase());
    return normalized === asciiLowercased ? null : normalized;
}
```

The underlying `normalizeForSearch` (`utilities_internal.js:83-107`) strips formatting tags, applies NFKD, removes combining marks, lower-cases, folds a fixed set of Latin letters (`ø œ æ ł đ ð þ ß ı ⁄`), folds typographic quotes and dashes to ASCII, then recomposes with NFC so kana and Hangul are not split.

**How Zotero reads it.** Only through `COALESCE`, in `chrome/content/zotero/xpcom/data/searchConditions.js`:

```js
normalizedField: 'COALESCE(nameNormalized, name)',              // line 420, tag
normalizedField: 'COALESCE(valueNormalized, value)',            // line 609, itemData
normalizedField: 'COALESCE(textNormalized, text)',              // line 736, annotation text
normalizedField: 'COALESCE(commentNormalized, comment)',        // line 749, annotation comment
```

Any consumer that reads these columns **must** use the same `COALESCE`. Reading `nameNormalized` alone returns `NULL` for every plain-ASCII tag.

### 3.2 Step 126 recommendation for ZotLit: **do not adopt it**

Recommendation: **skip `nameNormalized` and its five siblings.** Rationale, grounded in ZotLit's code:

- **`packages/item-lookup` does not index tags at all.** Its `SearchField` union is `"title" | "creators" | "publicationTitle" | "shortTitle" | "court"` (`packages/item-lookup/src/engine.ts:29-35`). No tag ever enters the MiniSearch index.
- **`packages/item-lookup` already owns a normalizer.** `packages/item-lookup/src/tokenizer.ts:26-36` lower-cases, applies NFD, and strips combining marks; `normalizeWithIndexMap` (line 42) additionally keeps a code-unit index map so match highlights can be projected back onto the raw title. Zotero's `normalizeForSearchStorage` has no index map, so it cannot serve that need.
- **The two normalizers are not equivalent.** Zotero folds typographic quotes and dashes and recomposes to NFC; ZotLit's does neither. Mixing them would give inconsistent results between the tag path and the title path.
- **The column is unindexed and sparse.** There is no query-planner benefit to gain, and a `COALESCE` over a full scan is exactly what ZotLit already achieves in memory.
- **Backward compatibility.** ZotLit supports Zotero 9, where the column does not exist. Any use would need a runtime capability probe.

If ZotLit later adds tag search, the correct move is to feed `tags.name` into the existing MiniSearch index with the existing tokenizer, not to read `nameNormalized`.

**Adopt `nameNormalized` only if** ZotLit ever needs to reproduce Zotero's own search results exactly (for example, to mirror a saved search). That is not a current requirement.

### 3.3 Step 127 — full-text word tables dropped, `savedSearchConditions.required` dropped (`schema.js:3698-3709`)

```js
else if (i == 127) {
    await _updateCompatibility(9);

    await Zotero.DB.queryAsync("DROP TABLE IF EXISTS fulltextItemWords");
    await Zotero.DB.queryAsync("DROP TABLE IF EXISTS fulltextWords");
    Zotero.Prefs.clear('vacuum.lastTime');

    await Zotero.DB.queryAsync("ALTER TABLE savedSearchConditions RENAME TO savedSearchConditionsOld");
    await Zotero.DB.queryAsync("CREATE TABLE savedSearchConditions (...)");   // without `required NONE`
    await Zotero.DB.queryAsync("INSERT INTO savedSearchConditions SELECT savedSearchID, searchConditionID, condition, operator, value FROM savedSearchConditionsOld");
    await Zotero.DB.queryAsync("DROP TABLE savedSearchConditionsOld");
}
```

This is the **first destructive step in the 9 → 10 range**, and the one that raises `compatibility` to 9. A Zotero 9 client that opens a migrated database throws `IncompatibleVersionException` (`schema.js` `updateSchema`, described in `packages/db/drizzle/ZOTERO_MIGRATION.md`).

ZotLit impact: `packages/db/drizzle/schema.ts` declares `fulltextWords` (line 746), `fulltextItemWords` (line 755), and `savedSearchConditions.required` (line 628). A repository-wide search shows **no query reads any of the three**, so nothing breaks at runtime. The snapshot is simply stale.

### 3.4 Step 128 — attachment paths normalized to bare filenames (`schema.js:3711-3724`)

```js
else if (i == 128) {
    let rows = await Zotero.DB.queryAsync("SELECT itemID, path FROM itemAttachments WHERE linkMode IN (0, 1) AND (path LIKE ? OR path LIKE ?)", ['storage:%/%', 'storage:%\\%']);
    for (let row of rows) {
        let rel = row.path.substr(8);
        if (!(rel.includes('/') || /^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('\\\\'))) {
            continue;
        }
        let filename = rel.split(/[/\\]/).pop();
        if (!filename) {
            continue;
        }
        await Zotero.DB.queryAsync("UPDATE itemAttachments SET path=? WHERE itemID=?", ['storage:' + filename, row.itemID]);
    }
}
```

This is a data repair, not a DDL change. ZotLit already rejects multi-segment storage paths: `parseAttachmentPath` returns `{ kind: "unknown" }` when `isSingleSegment(filename)` is false (`packages/db/src/lib/zt-attach.ts:181-186`). So on Zotero 10 some attachments that ZotLit previously could not resolve **start resolving**. This is a pure improvement and needs no change.

### 3.5 Step 129 — `clientVersion` columns (`schema.js:3726-3731`)

```js
else if (i == 129) {
    let clientVersionTables = ['items', 'collections', 'savedSearches', 'libraries'];
    for (let table of clientVersionTables) {
        await Zotero.DB.queryAsync(`ALTER TABLE ${table} ADD COLUMN clientVersion INT NOT NULL DEFAULT 0`);
    }
}
```

`clientVersion INT NOT NULL DEFAULT 0` is a **local** change counter, distinct from the synced `version`. It backs the local API's `since` filtering and `Last-Modified-Version` header (`chrome/content/zotero/xpcom/server/server_localAPI.js`). ZotLit reads neither column, so this is additive and inert.

### 3.6 Full `userdata.sql` diff, 125 → 129

For completeness, `git diff 9.0.3 HEAD -- resource/schema/userdata.sql` shows exactly:

| Table | Change |
| --- | --- |
| `items` | `+ clientVersion INT NOT NULL DEFAULT 0` |
| `collections` | `+ clientVersion INT NOT NULL DEFAULT 0` |
| `savedSearches` | `+ clientVersion INT NOT NULL DEFAULT 0` |
| `libraries` | `+ clientVersion INT NOT NULL DEFAULT 0` |
| `itemDataValues` | `+ valueNormalized TEXT` |
| `itemAnnotations` | `+ textNormalized TEXT`, `+ commentNormalized TEXT` |
| `tags` | `+ nameNormalized TEXT` |
| `creators` | `+ firstNameNormalized TEXT`, `+ lastNameNormalized TEXT` |
| `savedSearchConditions` | `- required NONE` |
| `fulltextWords` | table dropped |
| `fulltextItemWords` | table dropped (with its index) |

No table was renamed. No primary key was restructured. No column that ZotLit reads was removed.

### 3.7 One more schema-adjacent change: backup file naming

`schema.js:276-305` replaces per-version backups (`zotero.sqlite.<userdata>.bak`) with a single `zotero.sqlite.bak` plus a `settings` row `('backup', 'lastSchemaUpdateState')`, and deletes every legacy `zotero.sqlite.<n>.bak`. ZotLit does not read backup files, so this is informational only.

---

## 4. API changes affecting the companion plugin

`apps/zotero/src/` uses this Zotero surface (enumerated by pattern search):

```
Zotero_Tabs.selectedID          Zotero.Libraries.get / .userLibraryID
Zotero.alert                    Zotero.log / .debug / .getString
Zotero.CollectionTreeRow        Zotero.MenuManager.registerMenu / .unregisterMenu
Zotero.DataDirectory.dir        Zotero.Notifier.registerObserver / .unregisterObserver
Zotero.File.pathToFileURI       Zotero.PreferencePanes.register
Zotero.getMainWindow(s)         Zotero.Prefs.get / .set / .registerObserver / .unregisterObserver
Zotero.Groups.getGroupIDFromLibraryID
Zotero.Items.get / .getIDFromLibraryAndKey
Zotero.ItemTreeManager.registerColumn / .unregisterColumn / .refreshColumns
Zotero.launchURL                Zotero.Profile.dir
Zotero.ProgressWindow           Zotero.Reader._readers / .getByTabID
Zotero.Reader.registerEventListener / .unregisterEventListener
Zotero.Utilities.Internal.copyTextToClipboard
```

### 4.1 Breaking: `context.collectionTreeRow` now throws

This is the **one confirmed runtime break** in `apps/zotero/`.

Zotero 10 removed the singular collection getters. `chrome/content/zotero/zoteroPane.js:2185-2188`:

```js
this.getCollectionTreeRow = function () {
    throw new Error("ZoteroPane.getCollectionTreeRow() was removed "
        + "-- use ZoteroPane.getCollectionTreeRows()");
}
```

The same removal reaches into the MenuManager context. Both `main/library/collection` (`zoteroPane.js:4113-4121`) and `main/library/item` (`zoteroPane.js:4660-4670`) now build their context as:

```js
getContext: () => ({
    get collectionTreeRow() {
        throw new Error("collectionTreeRow was removed -- use collectionTreeRows");
    },
    collectionTreeRows,
    tabType: "library",
    ...
})
```

`chrome/content/zotero/xpcom/pluginAPI/menuManager.js:635-648` was changed to copy property **descriptors** rather than values, precisely so that building a menu does not evaluate that throwing getter. The throw is therefore deferred to the moment a plugin reads the property.

ZotLit reads it twice, in `apps/zotero/src/menus/collection.ts`:

- Line 66, inside `scopedMenuItem(...).onCommand`.
- Line 85, inside the submenu's `onShowing`.

On Zotero 10 the `onShowing` read throws every time the collection context menu opens, and the `onCommand` read throws on every click. The whole ZotLit collection submenu stops working.

Fix: read `context.collectionTreeRows` and take the first entry (or handle a multi-selection deliberately). `rowScope` already accepts `undefined`.

Typing: `zotero-types@4.1.2` declares `LibraryMenuContext.collectionTreeRow?: _ZoteroTypes.CollectionTree` (`types/xpcom/pluginAPI/menuManager.d.ts:112`) and has no `collectionTreeRows`. Until a `zotero-types` release covers Zotero 10, add a local declaration merge in `apps/zotero/src/types/zotero.d.ts` — that file already widens `setL10nArgs` for the same reason.

**Zotero 9's shape, for the compatibility branch.** Zotero 9.0.3 supplies **only** the singular property. `~/repo/zotlit-repo/zotero/chrome/content/zotero/zoteroPane.js:3713-3721`:

```js
"main/library/collection",
{
    getContext: () => ({
        collectionTreeRow,
        tabType: "library",
        tabSubType: undefined,
        tabID: "zotero-pane",
    })
}
```

So `collectionTreeRows` is absent on Zotero 9 and `collectionTreeRow` throws on Zotero 10. The branch must therefore test for **presence of the plural**, never for truthiness of the singular:

```ts
const row = "collectionTreeRows" in context
  ? context.collectionTreeRows[0]     // Zotero 10
  : context.collectionTreeRow;        // Zotero 9
```

`apps/zotero/src/menus/item.ts` reads only `context.items`, `context.setVisible`, and `context.setL10nArgs`. It is safe.

### 4.2 Not affected, verified

- **`Zotero.MenuManager`** — the only change to `menuManager.js` between 9.0.3 and 10.0.0 is the descriptor-copy fix above. `registerMenu` / `unregisterMenu` signatures are unchanged.
- **`Zotero.Notifier`** — `chrome/content/zotero/xpcom/notifier.js` has **no diff** between 9.0.3 and 10.0.0.
- **`Zotero.Prefs`** — `xpcom/prefs.js` has no diff.
- **`Zotero.ItemTreeManager`** — `xpcom/itemTreeManager.js` has no diff. The official page's "Items List Refactor" splits `ItemTree` internals, but the manager API that ZotLit uses (`registerColumn`, `unregisterColumn`, `refreshColumns`) is untouched.
- **`Zotero.Reader._readers` / `getByTabID`** — both still present (`xpcom/reader.js:2666`, `:2800`, `:2814`). `reader.js` changed by 252 lines, but neither symbol was removed. ZotLit's use is **not fully verified at runtime**; see Section 6.
- **`Zotero.Profile.dir`** — still present. Only `getOtherAppProfilesDir` was removed from `xpcom/profile.js`. `packages/protocol/src/source-id.ts` depends on `Zotero.Profile.dir` plus `Zotero.DataDirectory.dir`, and both survive.
- **`Zotero.DataDirectory`** — `init` still resolves `Zotero.Prefs.get('useDataDir') && Zotero.Prefs.get('dataDir')` in the same order (`xpcom/dataDirectory.js:82-95`). `apps/obsidian/src/services/zotero-pref/service.ts` mirrors exactly this logic and stays correct. The removed code is the Firefox-profile fallback for pre-5.0 installs.
- **`Zotero.PreferencePanes.register`** — unchanged for plugins. The only diff in `xpcom/preferencePanes.js` renames Zotero's built-in Sync pane to Account.
- **Local API hardening** — ZotLit's `apps/obsidian/src/services/pandoc/bibliography.ts:36` already sends `"Zotero-Allowed-Request": "1"`, and it targets `http://127.0.0.1:23119`, which passes the Host check at `xpcom/server/server.js:323-327`. Both the Host check and the allowed-request header already exist in Zotero 9.0.3 at the same line numbers, so this is not a Zotero 10 change.
- **Local API write endpoints and `Zotero-Server-ID`** — new in Zotero 10 (`server_localAPI.js`). Read requests do **not** require `Zotero-Server-ID`; only write methods return 428 without it (`server_localAPI.js`, `_checkServerID`). ZotLit only issues `GET /api/users/0/items?...&include=csljson`, so it is unaffected.
- **Plugin FTL registration** and **plugin `prefs.js` cache** — the official page lists both under Zotero 10, but `git diff 9.0.3 HEAD -- chrome/content/zotero/xpcom/plugins.js` is **empty**. Both fixes were cherry-picked into the 9.0 branch and shipped in 9.0.3 (commits `5a745fcc9a` and `3db96c9444`). `apps/zotero/src/lib/l10n.ts` needs no change.

### 4.3 New APIs worth knowing (none required)

- `Zotero.UndoHistory.stageAction(label, args)` and `item.saveTx({ undoAction, undoActionArgs })` — new file `chrome/content/zotero/xpcom/undoHistory.js`, wired in `xpcom/zotero.js:~700`. ZotLit's companion performs no writes, so there is nothing to make undoable today.
- `Zotero.DB.loadExtension(name)`, `Zotero.DB.onIdle(cb)`, `Zotero.DB.addCorruptionHandler(cb)` — internal maintenance hooks.
- `Zotero.HTTP.newCookieContext()` replaces the removed `Zotero.CookieSandbox`. ZotLit uses neither.
- `Zotero.Annotations.COLORS` — the 8-colour palette is now an exported constant (`xpcom/annotations.js`). The colours themselves did not change, and `packages/db/src/lib/zt-color.ts` does not hard-code the list.

---

## 5. ZotLit action list

### Required for Zotero 10 compatibility — 3 items

| # | File | What breaks | Change | Effort |
| --- | --- | --- | --- | --- |
| R1 | `apps/zotero/package.json` (`zotero.strict_max_version`) | Zotero 10 refuses to load the XPI. `strict_max_version` is `"9.*"`. | Set `"10.*"` (or `"10.0.*"`). Keep `strict_min_version` at `"9.0"` to hold Zotero 9 support. `scripts/manifest.ts` and `scripts/build-update-json.ts` propagate the value; the docs version ledger derives from it. | Trivial |
| R2 | `apps/zotero/src/menus/collection.ts:66`, `:85` | `context.collectionTreeRow` throws on every collection-menu open and on every click. | Branch on `"collectionTreeRows" in context`: take `collectionTreeRows[0]` on Zotero 10, `collectionTreeRow` on Zotero 9. Both shapes are confirmed in Section 4.1. | Small |
| R3 | `apps/zotero/src/types/zotero.d.ts` | `zotero-types@4.1.2` has no `collectionTreeRows` on `LibraryMenuContext`, so R2 does not typecheck. | Add a declaration merge, as already done for `setL10nArgs`. Remove it once `zotero-types` covers Zotero 10. | Trivial |

### Optional — 6 items

| # | File | Benefit | Priority |
| --- | --- | --- | --- |
| O1 | `apps/obsidian/src/services/database/read-source.ts` + `apps/obsidian/src/services/settings/schema.ts` | On Zotero 10, `auto` mode on Windows silently reads a stale database. Options: (a) let `auto` fall back to `copy` when a `-wal` file exists and is non-empty; (b) surface a notice that names the setting to change; (c) leave as is and document it. Option (b) is the smallest honest fix. | **Medium — the highest-value optional item** |
| O2 | `apps/obsidian/src/services/database/read-source.ts` (module comment, lines 1-19) | The comment states WAL as an unconditional Zotero fact. Name the Zotero 10 boundary so the Zotero 9 case is not read as a bug. | Low, but cheap |
| O3 | `packages/db/drizzle/schema.ts` | Snapshot still models `userdata` 125. Add the six `*Normalized` columns and the four `clientVersion` columns; drop `fulltextWords`, `fulltextItemWords`, and `savedSearchConditions.required`. Follow the hand-patch procedure in `packages/db/drizzle/ZOTERO_MIGRATION.md` — do **not** re-run `drizzle-kit pull`. Rename the snapshot directory marker to `_userdata_129`. Nothing breaks without this; it is hygiene. | Low |
| O4 | `packages/db` (new query) | Read `SELECT version FROM version WHERE schema='userdata'` and `schema='compatibility'` on connect, and log a warning when the value exceeds what the snapshot models. `zotero9_dev.md` §4.2 already recommended this; it is still not implemented. Zotero 10 raising `compatibility` from 7 to 9 makes it more useful. | Low |
| O5 | `apps/zotero/AGENTS.md:3` | The first line reads "Zotero 9 (Firefox 140 ESR) companion plugin." Update to name the supported range once R1 lands. | Trivial |
| O6 | `apps/docs/content/docs/(intro)/install-companion.mdx`, `.../concepts/how-zotlit-connects-to-zotero.mdx` | Both already say "Zotero 9 or later", so no edit is required. If O1 chooses option (c), add a short note about read mode on Windows. | Conditional |

### Explicitly **not** needed

- `packages/zotero-types` — global schema 42 → 44 added no item type and no field.
- `packages/protocol` — its wire version is ZotLit's own; `Zotero.Profile.dir` and `Zotero.DataDirectory.dir` both survive.
- `packages/item-lookup` — no tag indexing, own normalizer; see Section 3.2.
- `packages/db/src/lib/zt-attach.ts` and `zt-path.ts` — Zotero 10's step-128 repair makes ZotLit strictly more capable, with no code change.
- `apps/obsidian/src/services/pandoc/bibliography.ts` — already sends `Zotero-Allowed-Request`.
- `apps/zotero/src/lib/l10n.ts` — the FTL registration rewrite shipped in 9.0.3.

### Backward compatibility with Zotero 9

ZotLit supports both. The constraints:

- **R2 must work on both.** Zotero 9 supplies `collectionTreeRow` as a plain value and has no `collectionTreeRows`. Zotero 10 supplies `collectionTreeRows` beside a `collectionTreeRow` getter that throws. Branch on `"collectionTreeRows" in context`. Never test the truthiness of `context.collectionTreeRow` — that read itself throws on Zotero 10.
- **O3 must keep every column ZotLit reads nullable-tolerant.** The `*Normalized` columns do not exist on Zotero 9; the dropped tables do exist there. Since no query touches any of them, a single schema file can describe the union without a runtime probe — but any future query against them needs a capability check.
- **The WAL path is already version-agnostic**, because the WAL copy is conditional on the file existing.
- **`strict_min_version` stays `"9.0"`.** Nothing in R1-R3 requires a Zotero 10 API.

---

## 6. Open questions and unverified items

1. **Public release of Zotero 10.0.0.** The tag is dated 2026-08-17. Whether the stable build is downloadable, and on what date, is not verified from a primary source.
2. **End-to-end WAL replay on a real Zotero 10 database.** `apps/obsidian/src/services/database/service.test.ts:53-67` proves that the clone copies the `-wal` file, but it writes the literal string `"wal"`, not a real WAL. The claim that `node:sqlite` opens the clone with `mode=ro` and replays a genuine Zotero 10 WAL is **reasoned from SQLite semantics, not measured**. Run one manual check against a live Zotero 10 data directory before trusting it in a release.
3. **`immutable=1` against a WAL-mode database.** SQLite is expected to skip locking and read the main file only. That behaviour is documented by SQLite, not verified here against `node:sqlite` and a Zotero 10 file.
4. **Consistency of an `immutable` read during a checkpoint.** Reasoned as a small risk in Section 2.4; not measured.
5. **`Zotero.Reader._readers` and `getByTabID` at runtime.** Both symbols exist in Zotero 10's `reader.js`, but that file changed by 252 lines. ZotLit's reader integration (`apps/zotero/src/notify/active-reader.ts`, `src/menus/reader-*.ts`) should be exercised live with the `/zotero-rdp-debug` skill against a Zotero 10 build.
6. **`Zotero.getString` keys.** `xpcom/zotero.js` shows some `getString` call sites moving to Fluent IDs. ZotLit calls `Zotero.getString`; which key it passes, and whether that key still exists, was not audited.
7. **Global schema 44's "search-condition-groups gate".** The commit message names a gate. What it gates, and whether it affects any field ZotLit reads, was not investigated — but the field and item-type sets are provably identical, so the risk is low.
8. **The official page's accuracy.** Three items it attributes to Zotero 10 already shipped in 9.0.3: the plugin FTL registration fix, the plugin `prefs.js` cache fix, and (as an unlisted implication) the local-API Host header check and `Zotero-Allowed-Request` handling. Treat its "new in 10" framing as approximate and confirm against the source diff.

---

## 7. Sources

**Source checkouts (authoritative).**

- `~/repo/zotlit-repo/zotero-10` at tag `10.0.0` (`22f08d1ced`, 2026-08-17).
- `~/repo/zotlit-repo/zotero` at tag `9.0.3` (`451d96a824`, 2026-05-06).
- Both share history; all diffs are `git diff 9.0.3 HEAD -- <path>` inside the `zotero-10` checkout.

Files cited:

| Path | Used for |
| --- | --- |
| `resource/schema/userdata.sql` | Schema version headers, all DDL |
| `resource/schema/system.sql`, `triggers.sql` | Version headers (both unchanged) |
| `chrome/content/zotero/xpcom/db.js` | WAL, locking mode, checkpointing, vacuum |
| `chrome/content/zotero/xpcom/schema.js` | Migration steps 126-129, `_maxCompatibility`, backfill |
| `chrome/content/zotero/xpcom/utilities_internal.js` | `normalizeForSearch`, `normalizeForSearchStorage` |
| `chrome/content/zotero/xpcom/data/tags.js` | `nameNormalized` insert path |
| `chrome/content/zotero/xpcom/data/item.js`, `creators.js` | Sibling normalized-column insert paths |
| `chrome/content/zotero/xpcom/data/searchConditions.js` | `COALESCE(...Normalized, ...)` read pattern |
| `chrome/content/zotero/xpcom/zotero.js` | Backfill scheduling, UndoHistory wiring |
| `chrome/content/zotero/zoteroPane.js` | Removed collection getters, menu contexts |
| `chrome/content/zotero/xpcom/pluginAPI/menuManager.js` | Descriptor-copy fix |
| `chrome/content/zotero/xpcom/fulltext.js` | FTS5 / `fulltext.sqlite` |
| `chrome/content/zotero/xpcom/server/server.js`, `server_localAPI.js` | Host check, allowed-request header, `Zotero-Server-ID` |
| `chrome/content/zotero/xpcom/dataDirectory.js`, `profile.js` | Data-directory and profile resolution |
| `chrome/content/zotero/xpcom/annotations.js` | Colour palette constant |
| `app/config.sh`, `app/scripts/fetch_xulrunner` | Gecko version, `strictCompatibility` patching |
| `defaults/preferences/zotero.js` | New vacuum and undo preferences |

**GitHub (via `gh api`).**

- `zotero/zotero-schema` blobs at `62e983a2e575fe9b9a3677ad7c9772080b67a1e4` (version 42) and `70c3aa98627413d6a30dca955886eafbde085ce9` (version 44), compared programmatically.
- `zotero/zotero` commits `e13e85b2e5` ("Fix plugin FTL registration (#5896)") and its 9.0-branch cherry-pick `5a745fcc9a`; `fa9a54b773` / `3db96c9444` (plugin `prefs.js` fix).

**Official documentation.**

- `https://www.zotero.org/support/dev/zotero_10_for_developers` — fetched 2026-08-18, page states "Last Updated 2026-08-06".
- `https://www.zotero.org/support/dev/zotero_8_for_developers` — background, already summarized in `zotero9_dev.md`.
- `https://www.zotero.org/support/dev/client_coding/direct_sqlite_database_access` — quoted in `zotero9_dev.md` §4.3; still authoritative.

**ZotLit code.**

`apps/obsidian/src/services/database/{read-source,service}.ts`, `apps/obsidian/src/lib/constants.ts`, `apps/obsidian/src/services/settings/schema.ts`, `apps/obsidian/src/services/zotero-pref/service.ts`, `apps/obsidian/src/services/pandoc/bibliography.ts`, `apps/zotero/package.json`, `apps/zotero/src/menus/{collection,item}.ts`, `apps/zotero/src/lib/l10n.ts`, `packages/db/drizzle/{schema.ts,ZOTERO_MIGRATION.md}`, `packages/db/src/lib/{zt-attach,zt-path}.ts`, `packages/db/src/queries/tags.ts`, `packages/item-lookup/src/{engine,tokenizer}.ts`, `packages/protocol/src/{source-id,version}.ts`, `packages/zotero-types/zotero-schema`.
