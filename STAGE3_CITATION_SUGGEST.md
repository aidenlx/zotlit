# Stage 3 — Citation suggesters & quick-switch (base spec)

Companion to [`MIGRATION.md`](./MIGRATION.md) §4, Stage 3. Validated by the
load-latency measurements in [`BENCH_STAGE3_ITEMS.md`](./BENCH_STAGE3_ITEMS.md).

This spec **supersedes** the abbreviated Stage 3 entry in `MIGRATION.md` §4.1
and **moves** the quick-switch command from Stage 5 to Stage 3. The migration
plan should be amended accordingly (see §11 below).

## 1. Scope

Stage 3 ships:

1. **`packages/db/src/queries/items.ts`** — `getItemsByLibrary(db, libraryID)`
   returning a lean `Item[]` sorted by `dateModified DESC`.
2. **`apps/obsidian/src/services/item-lookup/`** — headless `ItemLookup`
   service. Engine, scoring, and citekey ranking are superseded by
   [`STAGE_3_1_SEARCH.md`](./STAGE_3_1_SEARCH.md).
3. **`apps/obsidian/src/views/citation-suggest/`** — register function that
   wires an `EditorSuggest<SearchHit>` triggered by `[@…` / `【@…`. On select,
   inserts a citation rendered via `template.render("cite", …)` with minimal
   data.
4. **`apps/obsidian/src/views/quick-switch/`** — register function that adds
   the `zotlit:open-lit-note` command. Opens a `SuggestModal<SearchHit>`; on
   select, opens the matching literature note via `NoteIndex`, with a notice
   on miss.

Deliberately **not** in Stage 3:

- `packages/db/src/queries/citekey.ts` — moved to Stage 7 (citekey-click).
- Popup-modal `zotlit:insert-citation` command — Stage 5.
- Full citation pipeline (attachments, notes, `extraByAtch`) — Stage 5.
- Secondary-citation `alt` mode (trigger ends with `/`) — Stage 5.
- Quick-switch's create-note arm — Stage 5.

## 2. Architectural decisions

| Decision                             | Choice                                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Engine, scoring, and citekey ranking | See [`STAGE_3_1_SEARCH.md`](./STAGE_3_1_SEARCH.md).                                                          | Stage 3.1 replaces the native Obsidian search path with MiniSearch, cross-field AND search, explicit field boosts, and shared Intl.Segmenter tokenization.                                                                                                                                                                                                                                                                                                                                                                                             |
| Caching                              | **Long-lived single-slot cache** invalidated on `db.changed` and on `zotero.citation-library` setting change | Bench shows direct DB query is 230 ms p50 at 24k items, 470 ms extrapolated at 50k. Unusable for per-keystroke search. Cache holds `{libraryID, items} \| null` (only one active library, per default-library-only scope).                                                                                                                                                                                                                                                                                                                             |
| Query layer                          | **Drizzle typed query builder, prepared once with `sql.placeholder("libraryID")`**                           | Bench-verified fastest path for the items+creators stitch: 98 ms p50 vs. ~150 ms for RQB v2 with `jit: true` mapper, ~205 ms for RQB v2 without JIT. RQB v2 emits a `json_group_array` / `jsonb_object` aggregate on SQLite — single statement, but the JSON encode/decode pass on 80k creator rows costs ~50–100 ms that the cache-load step can't afford. Typed query builder also wins on readability and type-safety vs. raw `sql\`…\``. See [`packages/db/benchmark/creators-stitch.bench.ts`](./packages/db/benchmark/creators-stitch.bench.ts). |
| Suggester wiring                     | **Register functions, not services**                                                                         | `registerCitationSuggest(plugin, deps)` and `registerQuickSwitch(plugin, deps)` follow the existing `addDatabaseActions` pattern. The stateful work (cache + search) is the `ItemLookup` service; the suggesters are just plugin-API-binding glue.                                                                                                                                                                                                                                                                                                     |
| Library scope                        | **Default library only** — read from `zotero.citation-library`                                               | Matches v1. Cache holds one library at a time. Search across multiple libraries is out of scope; can be added later without changing the API.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Search async shape                   | `async search(query, opts?): Promise<SearchHit[]>`                                                           | First call lazy-loads (~230 ms), subsequent calls <1 ms. EditorSuggest and SuggestModal both await Promises natively. In-flight dedup: parallel calls share one load Promise.                                                                                                                                                                                                                                                                                                                                                                          |
| Empty query                          | Return first 50 items by recency (no search)                                                                 | Cache is already ordered `dateModified DESC` — just slice. Matches v1's `getItemsOf(50)` fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Insertion (editor)                   | `template.render("cite", [{ citekey }])` via real `zt-cite.eta.md`                                           | Default template uses only `citekey`. No stub data error path. Stage 5 enriches the data shape with attachments/notes without changing the call site.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Render                               | Shared `renderSuggestion(deps, hit, el)` between both surfaces                                               | Title + match highlights + creators/date meta + optional citekey. Lives in `services/item-lookup/render-hit.ts` next to the `SearchHit` type.                                                                                                                                                                                                                                                                                                                                                                                                          |

## 3. Module layout

```
packages/db/src/queries/
  items.ts                          # getItemsByLibrary + Item / Creator types
  items.test.ts                     # integration vs fixture sqlite

apps/obsidian/src/services/item-lookup/
  service.ts                        # ItemLookup class
  engine.ts                         # MiniSearch wrapper and SearchHit shape
  tokenizer.ts                      # Intl.Segmenter tokenizer
  render-hit.ts                     # shared renderSuggestion
  service.test.ts                   # unit, with mocked DB client
  engine.test.ts                    # engine + tokenizer integration
  tokenizer.test.ts                 # tokenizer unit coverage

apps/obsidian/src/views/citation-suggest/
  register.ts                       # registerCitationSuggest(plugin, deps)
  editor-suggest.ts                 # CitationEditorSuggest class

apps/obsidian/src/views/quick-switch/
  register.ts                       # registerQuickSwitch(plugin, deps)
  modal.ts                          # QuickSwitchModal class
```

`services/build.ts` registers `itemLookup` after `db`, `template`, `noteIndex`.
`zt-main.ts` calls `registerCitationSuggest` and `registerQuickSwitch` after
`buildServices(...)` returns, before `stack.move()`.

## 4. `packages/db/src/queries/items.ts`

### 4.1 `Item` shape

```ts
export interface Creator {
  firstName: string | null;
  lastName: string | null;
  creatorType: string;
  fieldMode: number; // 0 = fullName (firstName + lastName), 1 = nameOnly (lastName only)
}

export interface Item {
  itemID: number;
  libraryID: number;
  key: string;
  /** `key` or `key + 'g' + groupID` — pre-computed for NoteIndex lookup. */
  indexedKey: string;
  itemType: string;
  title: string | null;
  citekey: string | null;
  date: string | null;
  /** UTC instant; drives both `dateModified DESC` ordering and the
   *  Stage 3.1 recency multiplier (see STAGE_3_1_SEARCH.md §5.2). */
  dateModified: Temporal.Instant;
  creators: Creator[];
}
```

### 4.2 Query semantics

Implemented with **Drizzle's typed core query builder** (`db.select(...).from(items).leftJoin(...).where(...)`) — not raw `sql\`…\``and not RQB v2`db.query.items.findMany`. Rationale lives in §2 "Query layer". Two statements, prepared once at module init with `sql.placeholder("libraryID")` and reused on every load:

- **Items statement.** `SELECT … FROM items LEFT JOIN itemTypes LEFT JOIN groups LEFT JOIN deletedItems LEFT JOIN (itemData × itemDataValues) × 3` — one aliased pair of joins per pivoted field (`title`, `citekey`, `date`). Filter: `libraryID = ?`, `deletedItems.itemID IS NULL`, `itemTypes.typeName NOT IN ('attachment','note','annotation')`. Order: `items.dateModified DESC` so the empty-query first-50 is the recent list for free.
- **Creators statement.** `SELECT … FROM itemCreators INNER JOIN items INNER JOIN creators INNER JOIN creatorTypes` with the same `libraryID` / deleted / itemType filter as items, ordered by `(itemCreators.itemID, itemCreators.orderIndex)`. Stitched into items in JS by `itemID` (single `Map<number, Creator[]>` pass). Keeps per-item allocation flat.
- **Why two statements, not one nested RQB v2 query.** RQB v2's `db.query.items.findMany({ with: { itemCreators: {…} } })` materializes creators as an in-SQL `json_group_array(json_object(...))` aggregate; on the 24k-item / 80k-creator fixture this is ~50–100 ms slower per call than the two-statement stitch even with the JIT mapper (`jit: true`) and `.prepare()` on the RQB v2 query. See [`packages/db/benchmark/creators-stitch.bench.ts`](./packages/db/benchmark/creators-stitch.bench.ts).
- **Why prepare once.** `node:sqlite` already caches compiled statements internally, so the bench effect is < 2 ms — but `.prepare()` with `sql.placeholder("libraryID")` makes the per-call code path obvious and removes any per-invocation SQL-string rebuild from Drizzle's side.
- `indexedKey` precomputed once per item using a `libraryID → groupID` map built from `getLibraries(db)` results (one extra query at query time; result count is small).

### 4.3 Performance reference

See [`BENCH_STAGE3_ITEMS.md`](./BENCH_STAGE3_ITEMS.md). p50 ~230 ms at 24,352
items; extrapolated ~470 ms at 50k. Heap cost of one cached `Item[]`: ~20.7
MB at 24k items (~850 B/item including creators).

Query-layer comparison (no pivot, items+creators only, 24,776 items / 80,429
creators, see [`packages/db/benchmark/creators-stitch.bench.ts`](./packages/db/benchmark/creators-stitch.bench.ts)):

| variant                                           | p50 (ms) |
| ------------------------------------------------- | -------: |
| Typed query builder, built each call              |     98.3 |
| **Typed query builder, prepared once**            | **97.0** |
| RQB v2 nested `with`, built each call (jit=false) |    204.1 |
| RQB v2 nested `with`, prepared (jit=false)        |    207.1 |
| RQB v2 nested `with`, prepared (jit=true)         |    149.2 |

The ~130 ms delta between this sub-bench (~98 ms) and the §4.3 top-line
(~230 ms) is the cost of the three `itemData × itemDataValues` pivot joins.
RQB v2's JIT mapper closes most of its gap vs. raw SQL but is still ~50 ms
slower than the typed query builder on the same shape — not worth giving up
the field-by-field pivot ergonomics of `leftJoin` for.

## 5. `services/item-lookup/`

Superseded by [`STAGE_3_1_SEARCH.md`](./STAGE_3_1_SEARCH.md). The public
`ItemLookup.search(query, opts?)` API remains the same for the editor suggester
and quick-switch wiring below.

## 6. `views/citation-suggest/`

### 6.1 Register function

```ts
export function registerCitationSuggest(
  plugin: Plugin,
  deps: {
    app: App;
    lookup: ItemLookup;
    template: TemplateService;
    settings: SettingsService;
  },
): void {
  plugin.registerEditorSuggest(new CitationEditorSuggest(deps));
}
```

### 6.2 `CitationEditorSuggest` (editor-suggest.ts)

Extends `EditorSuggest<SearchHit>`. Key behaviors:

- **Trigger:** regex `/[[【]@([^\]】]*)$/` — character class of `[` and `【`,
  i.e. **single-bracket** open. Match `[@…` or `【@…` up to closing `]` / `】`
  or line end. (v1 parity; trailing `/` for alt-mode is not handled in
  Stage 3 — Stage 5 reintroduces.)
- **Toggle check:** `onTrigger` returns `null` if
  `settings.current["citation.editor-suggester"] === false`.
- **Range:** `start` = match index, `end` = cursor; if next char is `]` or
  `】`, extend `end` by one to replace the closing bracket too.
- **`getSuggestions(ctx)`:** `return lookup.search(ctx.query, { limit: 50 })`.
- **`renderSuggestion(hit, el)`:** delegate to shared `renderSuggestion`.
- **`selectSuggestion(hit)`:**
  ```ts
  if (!hit.item.citekey) {
    new BaseNotice(m.notice_no_citekey({ key: hit.item.key }));
    return;
  }
  const rendered = template.render("cite", [{ citekey: hit.item.citekey }]);
  context.editor.replaceRange(rendered, context.start, context.end);
  context.editor.setCursor(
    context.editor.offsetToPos(
      context.editor.posToOffset(context.start) + rendered.length,
    ),
  );
  ```
- **Instructions:** navigate / insert citation / dismiss (i18n).

## 7. `views/quick-switch/`

### 7.1 Register function

```ts
export function registerQuickSwitch(
  plugin: Plugin,
  deps: {
    app: App;
    lookup: ItemLookup;
    noteIndex: NoteIndex;
    settings: SettingsService;
  },
): void {
  plugin.addCommand({
    id: "zotlit:open-lit-note",
    name: m.command_open_lit_note_name(),
    callback: () => openQuickSwitch(deps),
  });
}
```

### 7.2 `QuickSwitchModal` (modal.ts)

Extends `SuggestModal<SearchHit>`. Key behaviors:

- **`getSuggestions(query)`:** `return lookup.search(query, { limit: 50 })`.
- **`renderSuggestion(hit, el)`:** delegate to shared `renderSuggestion`.
- **`onChooseSuggestion(hit, evt)`:**
  ```ts
  const files = noteIndex.getNotesByItemKey(hit.item.indexedKey);
  if (files.length === 0) {
    new BaseNotice(
      m.notice_no_literature_note({
        citekey: hit.item.citekey ?? hit.item.key,
      }),
    );
    return;
  }
  // TODO: support multi-note disambiguation (v1 parity).
  const [first] = files.sort();
  await app.workspace.openLinkText(first, "", Keymap.isModEvent(evt), {
    active: true,
  });
  ```
- **Instructions:** navigate / open note / open in new pane / dismiss (i18n).

The modal class is plain; no debounce wrapper. v1 had a 250 ms debounce
because FlexSearch lived in a Worker and IPC-round-tripped per keystroke;
with in-RAM `lookup.search` returning in <5 ms after cache warm-up, debouncing
is unnecessary.

## 8. i18n keys to add

```jsonc
// messages/{locale}.json for configured locales (currently en)
{
  "command_open_lit_note_name": "Open literature note quick switcher",

  "notice_no_literature_note": "No literature note for @{citekey}",
  "notice_no_citekey": "Selected item has no citekey: {key}",

  "instruction_navigate": "to navigate",
  "instruction_dismiss": "to dismiss",
  "instruction_insert_citation": "to insert citation",
  "instruction_open_lit_note": "to open literature note",
  "instruction_new_pane": "to open in new pane",
}
```

Command name follows Obsidian house-style sentence case. Notices end with
period. Instruction values are the _purpose_ string only — the modifier label
(`↑↓`, `↵`, `⌘↵`, `esc`) is wired in TS, not localized.

## 9. Tests

### 9.1 `packages/db/src/queries/items.test.ts`

Vitest integration against the bench fixture at
`/Users/aidenlx/repo/zotlit-repo/1287.zotero.migrated.sqlite` (overridable via
`ZOTERO_BENCH_DB`). Cover:

- Returns ~24k items for the user library, not the 1.3k the filename
  suggests.
- Trashed items excluded.
- Itemtypes `attachment`, `note`, `annotation` excluded.
- Title / citekey / date pivot returns null for missing rows, populated
  for present rows.
- Creators stitched correctly (count matches manual SQL).
- `indexedKey` is `key` for the user library (groupID null), `key + 'g' + groupID`
  for group libraries — if the fixture includes a group library; otherwise
  test the helper in isolation against a synthetic input.
- Ordered by `dateModified DESC`.

### 9.2 `services/item-lookup/service.test.ts`

Superseded by [`STAGE_3_1_SEARCH.md` §9.3](./STAGE_3_1_SEARCH.md#93-servicetestts).

### 9.3 UI view coverage

Stage 3 does not add editor-suggest, quick-switch modal, or highlight-rendering
unit tests. Those paths are thin Obsidian API bindings over the tested
`ItemLookup`, template render call, and `NoteIndex` lookup behavior; mocking the
editor and DOM rendering would cost more than it would protect at this stage.

## 10. Open questions / follow-ups

- **Per-keystroke latency at 50k items.** Bench measured load only.
  Measure MiniSearch query latency once a 50k fixture is available.
- **Multi-note disambiguation.** v1 carries a TODO; Stage 3 carries it
  forward. A secondary modal (or note-picker dropdown) is one path; doing
  nothing while users have one note per item is another.

## 11. MIGRATION.md amendments needed

When this spec lands, update `MIGRATION.md`:

- **§4 stage table row for Stage 3:** new queries column adds `items.ts`
  only (drop `citekey`); notes column expands to "quick-switch lifted from
  Stage 5; uses Obsidian-native fuzzy; long-lived cache invalidated on
  db.changed".
- **§4 row for Stage 5:** strike "quick-switch" from the commands list.
- **§4.1 Stage 3 paragraph:** replace with link to this spec.
- **§4.1 Stage 5 paragraph:** add "Replace citation-suggest `selectSuggestion`
  with full `insertCitation` pipeline (attachments + notes + alt-mode);
  add `zotlit:insert-citation` popup-modal command; add quick-switch's
  create-note arm via NoteFeatures.create."
- **§3.1:** confirm "Citation suggesters (editor + popup + quick-switch)"
  now means editor + quick-switch in Stage 3; popup-modal command in Stage 5.
