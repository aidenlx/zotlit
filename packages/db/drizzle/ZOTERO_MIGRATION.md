# Tracking the upstream Zotero schema

This package introspects a real Zotero SQLite database via `drizzle-kit introspect`. To know when the snapshot is stale, you need to know how Zotero versions and migrates its own schema.

## The `version` table

Zotero stores per-subsystem version counters in a single `version(schema TEXT PK, version INT)` table. Defined in `zotero/resource/schema/userdata.sql` and accessed exclusively through `Zotero.Schema.getDBVersion(schema)` / `_updateDBVersion(schema, version)` in `chrome/content/zotero/xpcom/schema.js`.

| `schema` key    | What it tracks                                                                                 | Affects DDL?                                              |
| --------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `userdata`      | Last applied step in `_migrateUserDataSchema`. Tables/columns/indexes/FKs.                     | **Yes**                                                   |
| `system`        | `system.sql` — itemTypes/fields/creatorTypes table structure (rows are reseeded each upgrade). | Rarely                                                    |
| `triggers`      | `triggers.sql` — FK-emulating triggers.                                                        | Triggers only (drizzle-kit sqlite introspect skips these) |
| `compatibility` | Bumped manually when a step breaks older clients. Coarse "breaking change" flag.               | Indirectly                                                |
| `globalSchema`  | Bundled `schema.json` (item type definitions). JSON content, not SQL.                          | No                                                        |
| `delete`        | `deleted.sql` cleanup migration progress.                                                      | No                                                        |
| `repository`    | Unix ts of last successful translator/style repo update.                                       | No                                                        |
| `lastcheck`     | Unix ts of last _attempted_ repo check.                                                        | No                                                        |
| `translators`   | mtime of bundled translators dir (skip-reinstall optimization).                                | No                                                        |
| `styles`        | mtime of bundled CSL styles dir.                                                               | No                                                        |

For drizzle introspection, only `userdata` matters in practice. `system` and `triggers` are worth a glance but rarely move.

## How Zotero migrates

### SQL file headers carry the canonical version

Each `.sql` file in `zotero/resource/schema/` starts with `-- N` on line 1. `_getSchemaSQLVersion(schema)` parses that integer (`schema.js:2160`).

```
userdata.sql  -- 125
system.sql    -- 32
triggers.sql  -- 18
```

### Fresh DB: `_initializeSchema()` (`schema.js:2209`)

Runs `system.sql` → `userdata.sql` → `triggers.sql` as raw `executeSQLFile`, then writes the three header versions into `version`, applies the bundled global schema, inserts the user library, and stamps `compatibility = _maxCompatibility`.

### Existing DB: `updateSchema()` (`schema.js:92`)

1. Read `userdata` and `compatibility` from the DB.
2. If `compatibility > _maxCompatibility` → throw `IncompatibleVersionException` (DB is from a newer Zotero).
3. If `userdata < SQL header version` and not a "minor" upgrade → forced backup of the DB.
4. In a single transaction:
   - `_updateSchema('system')` — re-runs `system.sql` if its header advanced (system tables are mostly idempotent reseeds).
   - `_migrateUserDataSchema(fromVersion)` — see below.
   - `_updateSchema('triggers')` — re-runs `triggers.sql` if its header advanced.
   - `_updateCustomTables()` — rebuilds the `*Combined` views.

### `_migrateUserDataSchema` (`schema.js:2739`) — the only place tables/columns change

Imperative, hand-coded ladder:

```js
for (let i = fromVersion + 1; i <= toVersion; i++) {
  if (i == 80) {
    /* DDL for step 80 */ await _updateCompatibility(1);
  }
  if (i == 81) {
    /* DDL for step 81 */
  }
  // ...
  if (i == 125) {
    /* DDL for step 125 */
  }
}
await _updateDBVersion("userdata", toVersion);
```

Each step block is the diff from `i-1` to `i`. Some steps call `_updateCompatibility(N)` to bump the breaking-change counter (currently up to 7). Steps below 76 are unsupported (Zotero refuses to upgrade pre-2.1 DBs).

There is no down migration. Zotero is upgrade-only.

## What this means for our drizzle snapshot

### The marker to track is `userdata`

Snapshot directories are named `<timestamp>_userdata_<N>/` (e.g. `20260509071212_userdata_125`). `userdata` is the only counter that reliably reflects DDL changes — Zotero release versions don't, since patch releases often ship with no schema bump.

### Re-introspect when…

- `userdata` advanced — guaranteed table/column change. Re-run `drizzle-kit introspect` and review the diff against the previous snapshot's `migration.sql`.
- `compatibility` advanced — read the corresponding `_updateCompatibility(N)` block in `_migrateUserDataSchema` to understand the breaking change.
- `system` advanced — usually only reseeded data, but skim `system.sql`'s git diff for new columns.

### Diffing upstream

To list what changed between two userdata versions, scan the case bodies in `_migrateUserDataSchema`:

```bash
# In the zotero submodule:
git log --oneline -- chrome/content/zotero/xpcom/schema.js \
  | grep -i "userdata\|migration"
```

Or just read `chrome/content/zotero/xpcom/schema.js:2739` and look at the `if (i == N)` blocks between your previous and current `userdata` value.

### Pre-introspect check

Before `drizzle-kit introspect`, query the source DB and compare against the last snapshot's recorded value. Skip the introspect if unchanged.

```ts
const row = client.get<{ version: number }>(
  "SELECT version FROM version WHERE schema = 'userdata'",
);
```
