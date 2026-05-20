# ZotLit v1 → v2 migration plan

Source repo: `/Users/aidenlx/repo/zotlit-repo/zotlit-v1` (Rush.js monorepo, `app/obsidian`).
Target repo: this repo (Turborepo + pnpm, `apps/obsidian`).

Companion plan referenced: [`DB_MIGRATE.MD`](../zotlit-v2/feat-db-query/DB_MIGRATE.MD) (worktree `feat-db-query`) — Stage 1 (`DatabaseService` lifecycle + `queries/libraries`) is shipped. Remaining query files are scheduled **per consuming feature** instead of as an upfront block (see §4).

## 1. Baseline (what's already in v2)

- `ServiceContainer` DI + `AsyncDisposableStack` lifecycle (`apps/obsidian/src/zt-main.ts`, `services/build.ts`, `services/service-base.ts`).
- `SettingsService` with valibot schema + legacy v0→v1 migration (`services/settings/{schema,migrate}.ts`).
- `LoggingService` via LogTape + Paraglide i18n (`@/lib/log`, `@/paraglide/messages`).
- `BaseNotice` + `toast.promise` wrappers (`@/lib/notice`, `@/lib/toast`).
- Setting-tab `database` and `logging` groups (`setting-tab/groups/`).
- `packages/db` with `createClient` + introspected drizzle schema; only `queries/libraries.ts` exists.
- `DatabaseService` (open / fs.watch / debounced refresh + `zotlit:refresh-db` command).
- `TemplateService` (Eta v4 renderer, embedded defaults, vault template watcher, editor helpers).
- `NoteIndex` (metadata-cache indices for `zotero-key`, `citekey`, and annotation block IDs).
- `packages/shared` with `nanoevents`, `Temporal`, `log-formatter`.
- Settings schema already covers v1 keys: `log.*`, `zotero.*`, `citation.*`, `note.literature-folder`, `server.*`, `template.*`, `img-excerpt.*` (UI for most still missing).

## 2. Architectural deltas

| Concern         | v1                                                                                    | v2 target                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo        | Rush.js, `app/*` + `lib/*`                                                            | Turborepo + pnpm, `apps/*` + `packages/*`                                                                                                         |
| DI              | `@ophidian/core` `this.use(Class)` + `@calc`/`@effect` decorators                     | `ServiceContainer.use({ key: factory })` + settings event subscribers                                                                             |
| UI              | Preact + `@preact/compat`                                                             | **React 19.2** via Vite's built-in JSX transform (no plugin needed for lib-CJS)                                                                   |
| State mgmt      | jotai atoms + zustand stores                                                          | **jotai only** (no zustand, no signals); per-instance via `Provider`+`createStore`; plain hooks unless state must persist outside the render tree |
| Search          | FlexSearch in worker                                                                  | MiniSearch in-process index per active library, tokenized with `Intl.Segmenter`                                                                   |
| SQLite          | `better-sqlite3` (gated by `install-guide`)                                           | `node:sqlite` (no install-guide)                                                                                                                  |
| Workers         | Node worker + iframe + web worker                                                     | Single-threaded                                                                                                                                   |
| Better BibTeX   | ATTACH v0/v1 db                                                                       | Native `citationKey` field only (pre-v1 BBT users lose lookup)                                                                                    |
| Events          | `vault.trigger("zotero:*")` globals                                                   | Per-service nanoevents emitters                                                                                                                   |
| Logging         | log4js                                                                                | LogTape (already migrated)                                                                                                                        |
| i18n            | Hardcoded                                                                             | Paraglide `m.*`                                                                                                                                   |
| Notices         | `new Notice()`                                                                        | `BaseNotice` / `toast.promise`                                                                                                                    |
| Template engine | `eta-prf` (fork)                                                                      | Upstream `eta@^4` (no fork needed)                                                                                                                |
| Item cache      | Per-library in-memory `Map<id, RegularItemInfo>` populated alongside FlexSearch index | Dropped — see §3                                                                                                                                  |

### 2.1 Why the item cache is dropped

v1 kept a denormalized item map per library inside the worker (`lib/db-worker/src/modules/{search-index,item-fetcher,item-builder}.ts`) so the FlexSearch index and the citation suggester could read items without paying worker-IPC + SQL cost. v2 drops it because:

- The cache was populated as a side-effect of building the FlexSearch index — and search is dropped.
- No worker thread → no IPC round-trip to amortize. `node:sqlite` is synchronous and fast on the main thread.
- Drizzle relational queries (`findMany({ with: { creators, fields, tags } })`) replace `ItemBuilder` denormalization in a single query.
- Cache invalidation around refresh was a v1 bug source. The broad v1 item cache is gone; Stage 3 keeps only a narrow candidate-list cache owned by `ItemLookup`, invalidated on DB/settings changes and cleared whenever the database is not ready.

**Mitigation for suggesters (Stage 3):** `ItemLookup` lazy-loads `getItemsByLibrary` into a long-lived single-slot MiniSearch index for the active citation library, deduplicates in-flight loads, and prewarms after startup/invalidation. Search uses cross-field AND matching with explicit field boosts. The cache is invalidated on `db.changed` and `zotero.citation-library` changes; while the database is loading or degraded, it is cleared and search returns `[]` instead of serving warm stale results.

## 3. Scope decisions

### 3.1 Alpha launch blockers

- Literature note **create + update** flows
- **Citation suggesters** (editor-suggest + popup modal + quick-switch). Editor-suggest and quick-switch land in Stage 3; the popup-modal `Insert citation` command and the full citation pipeline land in Stage 5.
- **Citekey-click**
- **Annotation side-panel view** (with image-cache importer + PDF outline)
- **PDF outline parser** (`services/pdf-parser/`, ported)
- **Setting-tab groups** for everything except `server`

### 3.2 Deferred (companion-dependent or post-alpha)

- `services/server/` (HTTP listener on localhost)
- `services/protocol/` (`zotero://open|update|export` handlers)
- `topic-import/` (tag-driven auto-create; uses `bg:notify`)
- Setting-tab `server` group
- `apps/zotero` companion plugin itself
- Template preview view, item details view
- Note import (HTML → md) — companion-independent; can slot in opportunistically
- **Template service follow-ups** (post-Stage 1 enhancements, not alpha-blocking):
  - Field-name completion in `EtaSuggest` (`it.title`, `it.citekey`, `it.creators`, `it.tags`, ...) — needs Stage 5 helper type definitions to drive the suggestion list.
  - `template-edited` event on `TemplateService` (nanoevents) — add when a live-preview consumer (Stage 9 annot view) actually needs to re-render on template edits; today one-shot renders rely on the vault watcher refreshing template content and the render-time mtime+size check invalidating compiled functions.
  - Async render path (`renderAsync`) — only if a consumer ever needs `await`-able rendering; Stage 1 is sync end-to-end.

### 3.3 Dropped

- `install-guide/` — replaced by `node:sqlite`
- `worker-iframe/`, `worker-web/` — single-threaded
- FlexSearch, `lib/db-worker/modules/search-index.ts`, `database.ts#search`, `item-fetcher.ts`, item cache
- BBT ATTACH (v0/v1 `.sqlite` files) — native citekey field only
- `annot-block/` — already commented out in v1
- log4js + `LogService` — replaced by LogTape
- `@ophidian/core`, `@calc`/`@effect` decorators
- `eta-prf` fork — upstream `eta@^4` covers it
- zustand, Preact, `@preact/compat`, `@preact/signals` — React 19.2 + jotai only
- `bg:notify`-driven DB refresh — fs.watch covers it

## 4. Stage order to alpha

Each stage produces a shippable plugin; queries are added in the stage that first consumes them.

| #   | Stage                                                                  | New queries                                                                                                | Notes                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | (done) Settings, Logging, DatabaseService Stage 1, `queries/libraries` | —                                                                                                          | —                                                                                                                                                                                                                                                                                                                                       |
| 1   | (done) **Template service**                                            | —                                                                                                          | `apps/obsidian/src/services/template/`: upstream `eta@^4`, embedded defaults, vault watcher, mtime+size compile invalidation, auto-pair, EtaSuggest                                                                                                                                                                                     |
| 2   | (done) **NoteIndex**                                                   | —                                                                                                          | Obsidian metadata index: `{itemKey → file[]}`, `{annotKey → block[]}`, `{citekey → file[]}`                                                                                                                                                                                                                                             |
| 3   | (done) **Citation suggesters + quick-switch**                          | `items` (by library, lean shape)                                                                           | Headless `ItemLookup` service (MiniSearch cache + scoring) + editor-suggest + quick-switch register-funcs. See [`STAGE3_CITATION_SUGGEST.md`](./STAGE3_CITATION_SUGGEST.md) and [`STAGE_3_1_SEARCH.md`](./STAGE_3_1_SEARCH.md).                                                                                                         |
| 4   | **NoteParser**                                                         | `attachments`, `notes`, `annotations` (+ `json-columns.ts` custom type for `position`/`sortIndex`), `tags` | Turndown + Zotero HTML rules                                                                                                                                                                                                                                                                                                            |
| 5   | **NoteFeatures (create + update) + citation finishers**                | —                                                                                                          | Commands: update note, overwrite-update, popup `Insert citation`. Replace Stage-3 editor-suggest `selectSuggestion` with full `insertCitation` pipeline (attachments + notes + alt-mode). Wire quick-switch's create-arm via NoteFeatures.create. Port v1 `update-note.ts` incremental annotation merge using CodeMirror `EditorState`. |
| 6   | **Setting-tab groups**                                                 | —                                                                                                          | `note`, `citation`, `template`, `img-excerpt` (skip `server`)                                                                                                                                                                                                                                                                           |
| 7   | **Citekey-click**                                                      | —                                                                                                          | Editor monkey-patch using NoteIndex + existing `citekey` query                                                                                                                                                                                                                                                                          |
| 8   | **PDF outline parser**                                                 | —                                                                                                          | Port `services/pdf-parser/`: `pdfjs-dist` + `idb` cache keyed by path + mtime                                                                                                                                                                                                                                                           |
| 9   | **Annot view + img-cache importer** _(alpha blocker)_                  | refine `annotations`/`attachments` shape if needed                                                         | First React 19.2 + jotai surface; integrates PDF outline from stage 8; drag-insert annotations to editor; image-cache copy/symlink with mtime-skip + symlink-fallback-to-copy                                                                                                                                                           |
| →   | **v2 alpha ships**                                                     |                                                                                                            |                                                                                                                                                                                                                                                                                                                                         |

### 4.1 Per-stage deliverables

**Stage 1 — Template service (done)**

- `apps/obsidian/src/services/template/`: `TemplateService`, `ObsidianEta`, path/default helpers, embedded `.eta.md` defaults, CodeMirror auto-pair extension, and `EtaSuggest`.
- Public API is intentionally low-level and sync for now: `render(name, data)` and `renderString(source, data)`. Feature-specific helpers (`renderNote`, `renderAnnot`, `renderCitation`, `renderFilename`) move to the stages that first know the DB/data shape.
- Service wiring: `TemplateService` is registered in `services/build.ts` after settings/logging; raw default imports are declared in `env.d.ts`; the Obsidian Vitest mock now covers `TFile`, `TFolder`, `Vault`, `EditorSuggest`, and `editorInfoField`.
- Dependencies live in `apps/obsidian/package.json`: `eta` plus CodeMirror state/view packages needed by the editor helpers.
- **Eta v4 references** (the v1 `eta-prf` fork is no longer needed):
  - Upstream source: `/Users/aidenlx/repo/zotlit-repo/eta-v4/` — the implementation imports from `eta/core` (no Node `fs` dep) and overrides `resolvePath` / `readFile`.
  - Analysis: `/Users/aidenlx/repo/zotlit-repo/eta-fork-analysis.md` — concludes the fork can be dropped. The only fork behavior carried forward is compile-cache freshness: v2 tracks `{mtime, size}` in a `Map` parallel to Eta's `templatesSync` cache and removes stale compiled functions before render.
  - v1 templates pass arrays through `include()`. Eta 4's default generated helper spreads include data into the parent object, so v2 patches the generated function string with a tiny plugin to pass include data through directly.

**Stage 2 — NoteIndex (done)**

- `apps/obsidian/src/services/note-index/service.ts`: `NoteIndex`, `formatItemKey`, `isLiteratureNote`, `getNotesByItemKey(indexedKey)`, `getNotesByCitekey(citekey)`, `getBlocksFor({ file?, itemKey? })`, and nanoevents `changed` / `rebuilt` subscriptions. No reload command or public `reload()` method.
- `apps/obsidian/src/services/note-index/parse.ts`: pure frontmatter and annotation block-ID parsing/diff helpers. Block-ID parsing mirrors v1 syntax and uses `arkregex` typed captures.
- Service wiring: `noteIndex` is registered in `services/build.ts` after `template` and `db`. Startup subscribes to `metadataCache.on("changed"|"deleted"|"resolved")` and `vault.on("rename"|"delete")`; it runs a synchronous initial scan when `metadataCache.initialized` is already true.
- Private Obsidian API typing: `MetadataCache.initialized` and `metadataCache.on("initialized")` are declared in `apps/obsidian/src/typings/obsidian-ex.d.ts`.
- Tests: focused parser/service Vitest coverage for initial rebuilds, no-op deltas, frontmatter item/citekey updates, item-key renames, vault renames/deletes, and `getBlocksFor` query modes.

**Stage 3 — Citation suggesters + quick-switch (done)**

Full spec: [`STAGE3_CITATION_SUGGEST.md`](./STAGE3_CITATION_SUGGEST.md). Highlights:

- `packages/db/src/queries/items.ts` — `getItemsByLibrary` returning `Item[]` as a discriminated union (`BaseItem | JournalArticleItem`) plus an `isJournalArticleItem(item)` predicate. Base shape: id, libraryID, key, indexedKey, itemType, title, citekey, date, creators. The `JournalArticleItem` variant additionally carries `publicationTitle`, `volume`, `issue`, `pages` (all `string | null`) so the suggester can render v1-style journal-article subtitles without a second query. Ordered `dateModified DESC`. `citekey.ts` is **deferred to Stage 7** (only citekey-click needs it).
- `apps/obsidian/src/services/item-lookup/` — headless `ItemLookup` service: single-slot cache `{libraryID, index: SearchIndex} | null` holding the built MiniSearch instance alongside the `Item[]`, lazy load + prewarm (`async search` resolves in <5 ms warm, ~230 ms cold per [`BENCH_STAGE3_ITEMS.md`](./BENCH_STAGE3_ITEMS.md)), in-flight dedup, invalidated on `db.changed` and on `zotero.citation-library` setting change, silent empty while loading/degraded and never serves warm cache in that state. Engine split into `engine.ts` (MiniSearch wrapper) and `tokenizer.ts` (Intl.Segmenter + optional cm-chs-patch + NFD normalize). Trigger is `[@…` / `【@…` (**single bracket** — citation syntax is Pandoc, not Obsidian wikilinks).
- `apps/obsidian/src/views/citation-suggest/` — register-func wires `EditorSuggest<SearchHit>`. `selectSuggestion` renders via `template.render("cite", [{ citekey }])` against the real `zt-cite.eta.md` (the default template only reads `citekey`, so no stub-data error path). Stage 5 swaps the call site to the full `insertCitation` pipeline.
- `apps/obsidian/src/views/quick-switch/` — register-func adds `zotlit:open-lit-note` command; opens `SuggestModal<SearchHit>` and on select opens the matching literature note via NoteIndex. Multi-note → alphabetical first (v1 parity, TODO carried). Miss → `BaseNotice`; create-arm lands in Stage 5.
- Scoring: MiniSearch BM25 with cross-field AND combine, prefix matching, and length-graduated fuzzy (`≤3: 0`, `≤5: 0.1`, else `0.2`). Field boosts `title:2.5, creators:2, date:1` — the queryable surface matches v1's `matchFields` exactly (title, creators, date). Citekey is **not** indexed as a query target: direct `[@key]` lookup is left to the citekey-click flow (Stage 7) so that fuzzy author/date queries don't get bubble noise from BBT-generated citekeys. A mild multiplicative recency bonus (`1 + 0.1 · exp(-daysElapsed/30)`, capped at 1.1×) reorders near-ties without overriding strict-relevance wins; empty-query ordering remains pure `dateModified DESC`. Title highlights are wrapped in a `renderTruncatedHighlight` window so a deep match stays in the row's CSS-ellipsis budget. See [`STAGE_3_1_SEARCH.md`](./STAGE_3_1_SEARCH.md) for the full engine spec.
- Suggestion row rendering (`apps/obsidian/src/services/item-lookup/render-hit.ts` + `views/citation-suggest/style.css`): mirrors v1's `components/item-suggest/core.ts` layout — title row, optional pill-styled citekey chip (gated on `citation.show-citekey-in-suggester`), and a journal-article-only `.meta` line containing `author (year), publication, vol(issue), pages.` All punctuation (parens around year/issue, commas between meta children, trailing period, inter-word space) is driven by CSS `::before` / `::after` pseudo-elements. No `.suggestion-aux` icon column (v1 had per-field type/user/calendar icons keyed off matched fields; v2 drops them).

**Stage 4 — NoteParser**

- `packages/db/src/queries/{attachments,notes,annotations,tags}.ts` + `json-columns.ts` + tests.
- `apps/obsidian/src/services/note-parser/service.ts`: `normalizeNotes`, `turndown` with Zotero rules (citation/highlight placeholders → re-render via template after DB resolution).

**Stage 5 — NoteFeatures (create + update) + citation finishers**

- `apps/obsidian/src/services/note-features/{create,update,actions}.ts`. Port v1 `update-note.ts` (incremental merge via CodeMirror `EditorState`, attachment-grouped sections, regex `isAnnotBlock`).
- Replace Stage-3 `views/citation-suggest/` `selectSuggestion` with the full `insertCitation` pipeline: load attachments + notes for the picked item, build `extraByAtch`, render `zt-cite.eta.md` / `zt-cite2.eta.md` with full data; reintroduce alt-mode (trigger ends with `/` → secondary citation).
- Add `zotlit:insert-citation` command — opens a popup `SuggestModal` reusing the Stage-3 `ItemLookup` and shared `renderSuggestion`; on select calls the same `insertCitation` pipeline at the editor cursor.
- Wire quick-switch's create-arm: on miss, call `NoteFeatures.create(item)` and open the result (current pane, or new pane on Mod-click).

**Stage 6 — Setting-tab groups**

- `apps/obsidian/src/setting-tab/groups/{note,citation,template,img-excerpt}.ts`. Mirror `groups/database.ts` pattern (SettingGroup + DisposableStack subscriber).

**Stage 7 — Citekey-click**

- `apps/obsidian/src/services/citekey-click/service.ts`. Monkey-patches `getClickableTokenAt` / `triggerClickableToken`; resolves `@citekey` via NoteIndex + `queries/citekey`; falls back to NoteFeatures.create on miss.

**Stage 8 — PDF outline parser**

- `apps/obsidian/src/services/pdf-parser/service.ts`: `getPDFOutline(pdfPath, force?)`, `getCachedOutlineKeys()`. `idb`-backed cache keyed by path + mtime.

**Stage 9 — Annot view + img-cache importer**

- `apps/obsidian/src/services/annot-view/`: React 19.2 view mounted via `createRoot`; jotai atoms declared at module scope with a per-leaf `createStore()` on the `ItemView` subclass and `<Provider store={this.#store}>` wrapping the tree; drag-insert handler; reactive sync to active file + Zotero reader focus.
- `apps/obsidian/src/services/img-cache/service.ts`: deferred queue with `import()` / `flush()` / `cancel()`; platform-aware default (symlink on Unix, copy on Windows); mtime skip; symlink → copy fallback on permission error.
- Vite config: no plugin needed (esbuild handles JSX from tsconfig). Add `react`, `react-dom`, `jotai` to `apps/obsidian/package.json` `dependencies`; `@types/react`, `@types/react-dom` to `devDependencies`. No catalog entries yet (single consumer).

## 5. Feature → v1 source map

For traceability during the migration; all paths under `/Users/aidenlx/repo/zotlit-repo/zotlit-v1/app/obsidian/src/`.

| v2 stage                      | v1 source                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Template                      | `services/template/` (renderer), parts of `note-feature/template-preview/` (editor helper)                              |
| NoteIndex                     | `services/note-index/service.ts`                                                                                        |
| Citation suggesters           | `components/item-suggest/`, `components/basic/modal.ts`, `note-feature/citation-suggest/`, `note-feature/quick-switch/` |
| NoteParser                    | `services/note-parser/service.ts`                                                                                       |
| NoteFeatures create           | `note-feature/service.ts` (`createNoteForDocItem`, `createNoteForDocItemFull`, `openNote`)                              |
| NoteFeatures update           | `note-feature/update-note.ts`                                                                                           |
| Setting-tab groups            | `setting-tab/{general,suggester,template,update,misc}/`                                                                 |
| Citekey-click                 | `services/citekey-click/service.ts`                                                                                     |
| PDF outline parser            | `services/pdf-parser/service.ts`                                                                                        |
| Annot view                    | `note-feature/annot-view/{view,store,drag-insert,more-options}.tsx`                                                     |
| Img-cache importer            | `services/zotero-db/img-import/service.ts`                                                                              |
| **Deferred** Server           | `services/server/service.ts`                                                                                            |
| **Deferred** Protocol         | `note-feature/protocol/service.ts`                                                                                      |
| **Deferred** Topic-import     | `note-feature/topic-import/`                                                                                            |
| **Deferred** Note import      | `note-feature/note-import/index.ts`                                                                                     |
| **Deferred** Template preview | `note-feature/template-preview/`                                                                                        |

## 6. Cross-cutting reminders

- `__DEV__` is build-time replaced; use it instead of runtime `NODE_ENV` checks.
- Library packages (`packages/db`, and any future `packages/templates` extraction) must **never** call LogTape `configure()`; they only `getLogger()`. The Obsidian app owns `configure()` via `LoggingService`.
- All user-facing strings go through Paraglide `m.*` in `messages/{locale}.json` for configured locales (currently `en`). Use `/i18n-ui-text` skill for Obsidian house-style copy and `/paraglide-i18n` skill for JSON/runtime mechanics.
- All toasts go through `BaseNotice` / `toast.promise`, never `new Notice()`.
- Use ECMAScript private fields (`#field`, `#method`) for service internals; avoid TypeScript `private`.
- Use ripgrep (`rg`) in shell commands; `grep`/`egrep`/`fgrep` are denied by a global hook.
- pnpm settings (catalog, allowBuilds, minimumReleaseAge) live in `pnpm-workspace.yaml`, not in `package.json`.
- Drizzle queries are sync (mirrors `node:sqlite`); `DatabaseService.isUpToDate()` is async only because it calls `fs.stat`.
- nanoevents event names are dash-case (`"refresh-failed"`), not camelCase.
- Use `Temporal.*` for date/time, not `Date`/date-fns/dayjs.

## 7. Open items

- `apps/zotero` companion migration — not yet scoped. v1 protocol is compatible with v2's eventual server, so v1's companion can keep working against v2 during the deferral window.
- Whether `bg:notify` is needed at all once the server lands (fs.watch already covers DB refresh; `bg:notify` only retains value for export/open flows).
