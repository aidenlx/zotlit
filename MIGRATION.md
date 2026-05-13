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
- `packages/shared` with `nanoevents`, `Temporal`, `log-formatter`.
- Settings schema already covers v1 keys: `log.*`, `zotero.*`, `citation.*`, `note.literature-folder`, `server.*`, `template.*`, `img-excerpt.*` (UI for most still missing).

## 2. Architectural deltas

| Concern         | v1                                                                                    | v2 target                                                                                  |
| --------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Monorepo        | Rush.js, `app/*` + `lib/*`                                                            | Turborepo + pnpm, `apps/*` + `packages/*`                                                  |
| DI              | `@ophidian/core` `this.use(Class)` + `@calc`/`@effect` decorators                     | `ServiceContainer.use({ key: factory })` + settings event subscribers                      |
| UI              | Preact + `@preact/compat`                                                             | **Preact** via `@preact/preset-vite` (added when stage 7 lands)                            |
| State mgmt      | jotai atoms + zustand stores                                                          | **zustand only** (no jotai); plain hooks unless state must persist outside the render tree |
| Search          | FlexSearch in worker                                                                  | Native `prepareFuzzySearch` / `prepareSimpleSearch` (`pickSearchFn` ≤10k items)            |
| SQLite          | `better-sqlite3` (gated by `install-guide`)                                           | `node:sqlite` (no install-guide)                                                           |
| Workers         | Node worker + iframe + web worker                                                     | Single-threaded                                                                            |
| Better BibTeX   | ATTACH v0/v1 db                                                                       | Native `citationKey` field only (pre-v1 BBT users lose lookup)                             |
| Events          | `vault.trigger("zotero:*")` globals                                                   | Per-service nanoevents emitters                                                            |
| Logging         | log4js                                                                                | LogTape (already migrated)                                                                 |
| i18n            | Hardcoded                                                                             | Paraglide `m.*`                                                                            |
| Notices         | `new Notice()`                                                                        | `BaseNotice` / `toast.promise`                                                             |
| Template engine | `eta-prf` (fork)                                                                      | Upstream `eta@^4` (no fork needed)                                                         |
| Item cache      | Per-library in-memory `Map<id, RegularItemInfo>` populated alongside FlexSearch index | Dropped — see §3                                                                           |

### 2.1 Why the item cache is dropped

v1 kept a denormalized item map per library inside the worker (`lib/db-worker/src/modules/{search-index,item-fetcher,item-builder}.ts`) so the FlexSearch index and the citation suggester could read items without paying worker-IPC + SQL cost. v2 drops it because:

- The cache was populated as a side-effect of building the FlexSearch index — and search is dropped.
- No worker thread → no IPC round-trip to amortize. `node:sqlite` is synchronous and fast on the main thread.
- Drizzle relational queries (`findMany({ with: { creators, fields, tags } })`) replace `ItemBuilder` denormalization in a single query.
- Cache invalidation around refresh was a v1 bug source. With no cache, "is this stale?" is never a question — every read hits the latest opened DB.

**Mitigation for suggesters (stage 3):** load the candidate list once per suggester open (`items.findMany` per library), then run `prepareFuzzySearch` over the in-memory array for every keystroke. Replicates "in-RAM during interaction" without a long-lived global.

## 3. Scope decisions

### 3.1 Alpha launch blockers

- Literature note **create + update** flows
- **Citation suggesters** (editor + popup + quick-switch)
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
- jotai — zustand only
- `bg:notify`-driven DB refresh — fs.watch covers it

## 4. Stage order to alpha

Each stage produces a shippable plugin; queries are added in the stage that first consumes them.

| #   | Stage                                                                  | New queries                                                                                                | Notes                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | (done) Settings, Logging, DatabaseService Stage 1, `queries/libraries` | —                                                                                                          | —                                                                                                                                                                           |
| 1   | (done) **Template service**                                            | —                                                                                                          | `apps/obsidian/src/services/template/`: upstream `eta@^4`, embedded defaults, vault watcher, mtime+size compile invalidation, auto-pair, EtaSuggest                         |
| 2   | **NoteIndex**                                                          | —                                                                                                          | Obsidian metadata index: `{itemKey → file[]}`, `{annotKey → block[]}`, `{citekey → file[]}`                                                                                 |
| 3   | **Citation suggesters**                                                | `items` (by IDs, by keys, by library list), `citekey`                                                      | Native `prepareFuzzySearch`/`prepareSimpleSearch`; plain Obsidian DOM (no React); editor suggester + popup modal + quick-switch wiring                                      |
| 4   | **NoteParser**                                                         | `attachments`, `notes`, `annotations` (+ `json-columns.ts` custom type for `position`/`sortIndex`), `tags` | Turndown + Zotero HTML rules                                                                                                                                                |
| 5   | **NoteFeatures (create + update)**                                     | —                                                                                                          | Commands: insert citation, update note, overwrite-update, quick-switch; port v1 `update-note.ts` incremental annotation merge using CodeMirror `EditorState`                |
| 6   | **Setting-tab groups**                                                 | —                                                                                                          | `note`, `citation`, `template`, `img-excerpt` (skip `server`)                                                                                                               |
| 7   | **Citekey-click**                                                      | —                                                                                                          | Editor monkey-patch using NoteIndex + existing `citekey` query                                                                                                              |
| 8   | **PDF outline parser**                                                 | —                                                                                                          | Port `services/pdf-parser/`: `pdfjs-dist` + `idb` cache keyed by path + mtime                                                                                               |
| 9   | **Annot view + img-cache importer** _(alpha blocker)_                  | refine `annotations`/`attachments` shape if needed                                                         | First Preact + zustand surface; integrates PDF outline from stage 8; drag-insert annotations to editor; image-cache copy/symlink with mtime-skip + symlink-fallback-to-copy |
| →   | **v2 alpha ships**                                                     |                                                                                                            |                                                                                                                                                                             |

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

**Stage 2 — NoteIndex**

- `apps/obsidian/src/services/note-index/service.ts`: `getNotesFor(item)`, `getBlocksFor({file?, item?})`, `getBlocksIn(file)`, `reload()`. Listens to `metadataCache.on("changed"|"deleted"|"resolved")`.

**Stage 3 — Citation suggesters**

- `packages/db/src/queries/{items,citekey}.ts` + tests.
- `apps/obsidian/src/services/citation-suggest/{editor,popup,core}.ts`: `EditorSuggest<Item>` (triggers `[[@`, `【@`), `SuggestModal`, shared candidate-loader.
- Score across `title`, `creators`, `date`, `citekey` with field boosts from `mx-repo/sources.ts:searchBestField` pattern; v1 weights to map: title × 100 → boost ≈ +0.5, creators/date × 5 → +0.05.

**Stage 4 — NoteParser**

- `packages/db/src/queries/{attachments,notes,annotations,tags}.ts` + `json-columns.ts` + tests.
- `apps/obsidian/src/services/note-parser/service.ts`: `normalizeNotes`, `turndown` with Zotero rules (citation/highlight placeholders → re-render via template after DB resolution).

**Stage 5 — NoteFeatures**

- `apps/obsidian/src/services/note-features/{create,update,actions}.ts`. Port v1 `update-note.ts` (incremental merge via CodeMirror `EditorState`, attachment-grouped sections, regex `isAnnotBlock`).

**Stage 6 — Setting-tab groups**

- `apps/obsidian/src/setting-tab/groups/{note,citation,template,img-excerpt}.ts`. Mirror `groups/database.ts` pattern (SettingGroup + DisposableStack subscriber).

**Stage 7 — Citekey-click**

- `apps/obsidian/src/services/citekey-click/service.ts`. Monkey-patches `getClickableTokenAt` / `triggerClickableToken`; resolves `@citekey` via NoteIndex + `queries/citekey`; falls back to NoteFeatures.create on miss.

**Stage 8 — PDF outline parser**

- `apps/obsidian/src/services/pdf-parser/service.ts`: `getPDFOutline(pdfPath, force?)`, `getCachedOutlineKeys()`. `idb`-backed cache keyed by path + mtime.

**Stage 9 — Annot view + img-cache importer**

- `apps/obsidian/src/services/annot-view/`: Preact view (registered via `@preact/preset-vite`); zustand store (`AnnotViewStore`); drag-insert handler; reactive sync to active file + Zotero reader focus.
- `apps/obsidian/src/services/img-cache/service.ts`: deferred queue with `import()` / `flush()` / `cancel()`; platform-aware default (symlink on Unix, copy on Windows); mtime skip; symlink → copy fallback on permission error.
- Vite config: add `@preact/preset-vite`; add `preact` and `zustand` to workspace catalog.

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
- All user-facing strings go through Paraglide `m.*` (`messages/{en,zh}.json`). Use `/i18n-ui-text` skill for Obsidian house-style copy and `/paraglide-i18n` skill for JSON/runtime mechanics.
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
