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
- `NoteIndex` (metadata-cache indices for `zotero-key` and `citekey`). The annotation block-ID index is removed in Stage 5 — see §4.1 Stage 5.
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
- **Annotation side-panel view** (with image-cache importer)
- **Setting-tab groups** for everything except `server`

### 3.2 Deferred (companion-dependent or post-alpha)

- **PDF outline parser** (`services/pdf-parser/`) — v1 ships `getPDFOutline` / `getCachedOutlineKeys` but **never calls them**: no API, server, or view consumer references the service (it is only `this.use()`-registered). Don't port until the annot view (or another feature) actually consumes an outline; then it lands as its own stage.
- `services/server/` (HTTP listener on localhost)
- ~~`services/protocol/`~~ **(done)** Obsidian-side handlers for `obsidian://zotlit/{open,update,export}` (wire contract in `packages/protocol/src/url.ts`; Zotero-side menu links + Obsidian-side handlers both ship). `open` = open-or-create, `update` = update-or-create, `export` = always create fresh. Source-id filtering rejects links from a non-configured Zotero install. Batch variants (`zotlit/update-many`, `zotlit/export-many`) remain future work.
- `topic-import/` (tag-driven auto-create; uses `bg:notify`)
- Setting-tab `server` group
- `apps/zotero` companion plugin itself
- Template preview view, item details view
- **Setting-tab live preview/validation** (post-alpha, Stage 6 §4.1 follow-ups): in-tab template preview (renders a sample item), and frontmatter-field expression preview + validation in `FrontmatterFieldModal` (evaluate `expr` against a sample item; surface compile/runtime errors beyond today's key-level checks).
- Zotero note import (HTML → Markdown) — companion-independent single stage. Alpha keeps the current fixed Zotero note HTML → Obsidian Markdown format; the same stage later adds configurable import output and Zotero Better Notes compatibility.
- **Template service follow-ups** (post-Stage 1 enhancements, not alpha-blocking):
  - Field-name completion in `EtaSuggest` (`it.title`, `it.citekey`, `it.creators`, `it.tags`, ...) — needs Stage 5 helper type definitions to drive the suggestion list.
  - `template-edited` event on `TemplateService` (nanoevents) — add when a live-preview consumer (Stage 8 annot view) actually needs to re-render on template edits; today one-shot renders rely on the vault watcher refreshing template content and the render-time mtime+size check invalidating compiled functions.
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
| 2   | (done) **NoteIndex**                                                   | —                                                                                                          | Obsidian metadata index: `{itemKey → file[]}`, `{citekey → file[]}` (block-ID `{annotKey → block[]}` map removed in Stage 5 — dead infra)                                                                                                                                                                                                                                             |
| 3   | (done) **Citation suggesters + quick-switch**                          | `items` (by library, lean shape)                                                                           | Headless `ItemLookup` service (MiniSearch cache + scoring) + editor-suggest + quick-switch register-funcs. See [`STAGE3_CITATION_SUGGEST.md`](./STAGE3_CITATION_SUGGEST.md) and [`STAGE_3_1_SEARCH.md`](./STAGE_3_1_SEARCH.md).                                                                                                         |
| 4   | (done) **NoteParser**                                                  | —                                                                                                          | Turndown converter + Zotero HTML rules; payload-only annotation marks; schema gate. Mark/color parsing lives in `@zotlit/db` (`zt-note-mark`, `zt-color`). Citation DB leg + `cite` render deferred to the Zotero note import stage; note image embeds resolved in Stage 9 via the Stage-8 `AttachmentImportService`.                         |
| 5   | (done) **NoteFeatures (create + update) + citation finishers**         | —                                                                                                          | Commands: `update-note`, `overwrite-note`, popup `Insert citation`. Note update uses a **managed-region overwrite** (marker-delimited `%%zt-managed%%` region re-rendered wholesale via `vault.process` + `processFrontMatter`), **not** v1's block-ID/`EditorState` incremental merge. Replace Stage-3 editor-suggest `selectSuggestion` with full `insertCitation` pipeline. Wire quick-switch's create-arm via NoteFeatures.create. See §4.1 Stage 5. |
| 6   | (done) **Setting-tab (declarative 1.13)**                              | —                                                                                                          | Clean Obsidian 1.13 declarative `getSettingDefinitions()`; hub + sub-pages (replaces v1 radix sub-tabs); covers `note`, `citation`, `template`, `attachment`, plus declarative ports of `database`/`logging` (skip `server`). See §4.1 Stage 6.                                                                                           |
| 7   | **(done) Citekey-click**                                               | `getItemIDByCitekey`                                                                                        | Editor monkey-patch using NoteIndex + `queries/citekey`                                                                                                                                                                                                                                                                                  |
| 8   | **(done)** **Annot view + attachment import** _(alpha blocker)_ | `getAttachmentByKey`, `getAnnotViewAttachments`, `getAnnotViewAnnotations`                                 | Attachment import **shipped** (`AttachmentImportService` coordinator + `lib/` helpers + settings + note create/update/overwrite wiring; reflink+copy, size+mtime skip, `file://` URI fallback when disabled). React 19.2 + jotai `ItemView` UI **wired to live DB** (per-leaf `createStore()` + `<Provider>`, real `AnnotActions`, two purpose-built queries, view-owned resolve chain). Templated drag-insert **shipped**; annotation merging and Zotero-reader follow mode deferred — see §4.1 Stage 8. (PDF outline deferred — see §3.2.) |
| →   | **v2 alpha ships**                                                     |                                                                                                            |                                                                                                                                                                                                                                                                                                                                         |
| 9   | **Zotero note import** _(post-alpha)_                                  | maybe `index-items` if citation resolution needs it                                                        | Wire Zotero note HTML → Obsidian Markdown import. Start from the fixed Stage-4 NoteParser output, then make the import output customizable and compatible with Zotero Better Notes' enhanced native-note HTML. Resolve note citations in this stage because `parseNote` has no import-flow consumer before it.                              |

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
- `apps/obsidian/src/services/note-index/parse.ts`: pure frontmatter and annotation block-ID parsing/diff helpers. Block-ID parsing mirrors v1 syntax and uses `arkregex` typed captures. **(Stage 5 removes the block-ID half — `getBlocksFor`, `BlockInfo`, the annot-key regexes, `diffBlocks`/`formatItemKey`/`addSectionBlocks`, and the `blocks` field — as dead infra with no feature consumer; `zotero-key`/`citekey` parsing stays.)**
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
- **Known gaps:** (1) The current citation item row in editor-suggest and quick-switcher has styling issues. (2) Fuzzy search is functional but not well tuned — scoring/heuristics still need empirical bench work (`packages/item-lookup/TODOS.md`).

**Stage 4 — NoteParser (done)**

Converts Zotero 9 note HTML → Obsidian Markdown, resolving annotation excerpts to flat inline marks. Citation resolution is **deferred to the Zotero note import stage** because `parseNote` has no import-flow consumer yet; note image embeds resolved in **Stage 9** via the Stage-8 `AttachmentImportService`. No DB queries this stage — annotation marks are payload-only.

- **Converter** — `apps/obsidian/src/lib/turndown/`: `createNoteTurndown(Turndown, options?)` builds a fresh `TurndownService` (Obsidian `htmlToMarkdown` base + Zotero body rules: math, bare-`<pre>` code, styled strike, sub/sup/underline, colored spans, a single `embeddedImage` rule for all `img[data-attachment-key]`, and citation passthrough). The SPAN-only `annotationExcerpt` rule takes an injectable replacement via `options.annotationExcerpt`.
- **Mark/color parsing (DOM-free)** — `packages/db/src/lib/zt-note-mark.ts` (valibot + `URLPattern` payload parsers) and `zt-color.ts` (annotation/highlight/text color → palette name), re-exported from `@zotlit/db`.
- **DOM glue + schema gate** — `apps/obsidian/src/lib/turndown/parse.ts`: `parseNoteSchema` (gated at schema v6, sees through the `znv1` storage wrapper), `parseCitation` / `parseAnnotation`.
- **Orchestrator** — `apps/obsidian/src/services/note-parser/index.ts`: `parseNote({ Turndown }, html)` runs the schema gate (below-v6 → Paraglide `note_parser_legacy_format_callout`; no container → `""`), injects the highlight/underline resolver (→ linked `<mark>` / `<u>` with theme-overridable CSS-variable colors and a `zotero://open/` backlink), and collapses blank-line runs. No DB/template deps this stage; the signature grows them in the Zotero note import stage with citations.

_Key decisions (vs v1):_

- **Annotations are flat inline marks, payload-only.** v1's `[!note]` callout + `zt-annot` template is **dropped**. Text, color, page label, annotation key, and attachment URI all come from the `data-annotation` payload — no DB lookup, no template. The mark's inner text is the **span's** text (preserves edits made in Zotero's note editor), not the DB annotation text (v1 silently discarded those edits).
- **Structure-agnostic conversion.** Zotero serializes annotations flat (one `<p>`, comment inline after the citation — no block structure), and the excerpt wrapper is user-customizable, so each mark resolves **in place** and the surrounding `<p>`/blockquote/`<br>`/comment text converts through the base rules. v1's `<p>`-level walker assumed a block structure that doesn't exist.
- **Colors via CSS variables.** `var(--zotlit-hl-{name}, {hex})` — works standalone (hex fallback) yet a snippet/theme can override the variable without `!important`. `annotationColorToName` maps Zotero's reader palette; an unmapped hex falls back to inline hex with no `data-color`. ZotLit injects `.zotlit-hl::before/::after` quotation marks.
- **`zotero://open/` backlink** (format-agnostic — PDF/EPUB/snapshot): `…/items/{attachmentKey}?page={label}&annotation={key}`. A malformed attachment URI drops the link but keeps the mark.
- **Parsing split.** Pure valibot + `URLPattern` payload parsing → `@zotlit/db` (node-testable); DOM glue (attribute reads, schema-container lookup) → obsidian; pure converter → `lib/turndown`; stateful orchestration → `services/note-parser`.

_References:_ Zotero 9.0.3 source at `/Users/aidenlx/repo/zotlit-repo/zotero/` (`serializeAnnotations` in `chrome/content/zotero/xpcom/editorInstance.js`; default templates `defaults/preferences/zotero.js`); schema lineage/gating in `note-html-format-schema-report.md`; fixtures `apps/obsidian/src/lib/turndown/__fixtures__/{zt-note-example,zt-excerpt-note}.html`.

**Stage 5 — NoteFeatures (create + update) + citation finishers (done)**

Full design and progress: [`docs/stage-5-note.md`](./docs/stage-5-note.md). Highlights:

- **Template vocabulary** — `zt.*` prefix (not v1's `it.*`), CSL-JSON-inspired field names, camelCase throughout. `varName` changed from `"it"` to `"zt"` globally. All Zotero fields are flat on `zt.*` (no `fields` sub-object); two CSL renames (`abstractNote` → `abstract`, `publicationTitle` → `containerTitle`). Type aliases (`abstract`, `containerTitle`, `citekey`) are explicit typed properties on `TemplateItemData`. `FIELD_ALIASES` (58 entries) generated from the Zotero schema in `packages/zotero-types/src/fields.ts`.
- **Template data types and mappers** — `packages/db/src/lib/`: `zt-template-item.ts` (`TemplateItemData` + `itemToTemplateData`), `zt-template-annot.ts` (`TemplateAnnotation` + `annotationToTemplateData`), `zt-template-attach.ts` (`TemplateAttachment` + `attachmentToTemplateData`). Creators as flat `{family, given, literal, role}` array.
- **Frontmatter** — JS expression evaluation via `new Function("zt", "return " + expr)`, not template rendering. System-managed fields (`zotero-key`, `citekey`) + user-configurable `{key, expr}` pairs in `note.frontmatter-fields` setting. Reserved key validation. `zt-attachments` read/write **deferred to post-alpha** (land with the attachment selection UI).
- **`NoteFeatures` service** (`apps/obsidian/src/services/note-feature/`): `create(item)` (full context build → filename render → frontmatter eval → note template render → `vault.create`), `update(file, indexedKey)` (managed-region overwrite via `vault.process` + frontmatter merge via `processFrontMatter`), `overwrite(file, indexedKey)` (full body replace behind `ConfirmationModal`). `renderCitation(items)` for the slim cite pipeline.
- **Managed region** — `%%zt-managed%%` … `%%/zt-managed%%` markers (shared constants in `lib/constants.ts`). `content` template (renamed from `annots`) renders the region; markers are code-injected via the `eta.ts` include rewrite, never in `.eta.md` files. Frontmatter merge is key-level (managed keys overwrite, arrays union+dedup, unmanaged keys preserved).
- **Default templates updated** to v2 `zt.*` syntax: `zt-note`, `zt-content` (renamed from `zt-annots`), `zt-annot`, `zt-cite`, `zt-cite2`. Removed: `zt-field.eta.md`, `zt-colored.eta.md`.
- **Commands** — `update-note`, `overwrite-note` (palette-only, `editorCheckCallback`-gated on `zotero-key`). `insert-citation` (popup `SuggestModal` via `InsertCitationModal`).
- **Citation finishers** — Stage-3 editor-suggest `selectSuggestion` replaced with `NoteFeatures.renderCitation`. Quick-switch create-arm wired (miss → `toast.promise(create)` → open).
- **NoteIndex cleanup** — block-ID infrastructure removed (`getBlocksFor`, `BlockInfo`, annot-block regexes, `formatItemKey`, block tests).
- **Follow-on (done)** — `ZoteroPrefService` reads Zotero's `prefs.js` for `dataDir` + `baseAttachmentPath`; `DatabaseService` derives sqlite path from prefs (removed `zotero.data-dir` setting); profiles.ini parsing via `@std/ini`; profile-picker dropdown in settings tab.
- **Deferred** — `zt-attachments` scoping + v1 numeric-ID migration (post-alpha, with attachment selection UI); `parseNote` citation resolution (Stage 9, with import flow); alt-mode secondary citation.

**Stage 6 — Setting-tab (declarative 1.13, done)**

Clean Obsidian 1.13-only declarative settings via `getSettingDefinitions()` (no `display()`); `minAppVersion` is already 1.13.1. The old imperative `setting-tab/groups/{database,logging}.ts` + `section.ts` are removed.

- **Bridge.** `ZotLitSettingTab` overrides `getControlValue(key)` → `settings.current?.[key]` and `setControlValue(key, value)` → `settings.update({ [key]: value })`, so declarative `control` keys bind 1:1 to the flat dot-notation `SettingsService` schema (settings do not live on `plugin.settings`). Verified end-to-end in the running app: toggling a control writes the sparse override to `data.json`.
- **Information architecture** (replaces v1's radix sub-tabs with native sub-pages). Hub (no top heading): default library, literature-note folder, two citation-suggester toggles. Sub-pages (`type: 'page'`): **Zotero database**, **Templates** (with a nested **Frontmatter** sub-page), **Attachments**, **Logging**. The standalone Notes page is gone — its only content was the frontmatter list, now nested under Templates.
- **Declarative-first.** Simple booleans/strings/folders are `control` definitions; reactive rows are `render` callbacks returning cleanup (profile picker, db-file status + refresh, read-mode active-line, dynamic library dropdown, log-level off-sentinel, the two auto-trim `false|"nl"|"slurp"` dropdowns). Log open/export are `action` rows whose `disabled` predicate auto-reevaluates off the `log.to-file` toggle.
- **Frontmatter fields** (`note.frontmatter-fields`) live on the **Frontmatter** sub-page under Templates: a `type: 'list'` with add/edit via the native `FrontmatterFieldModal` (key + expr; reserved/empty/duplicate key validation), `onDelete`, and a header **Reset to default** button. Defaults come from the shared `DEFAULT_FRONTMATTER_FIELDS` reference and are detected by identity — with no override the `SettingsService` snapshot *is* that frozen array — so default rows render as the genuine defaults (not an empty list with one tacked on) and reset stays disabled until customized. Mutations persist through `SettingsService`; the tab re-renders from a `subscribe` watch **scoped to that one key** (the shared debounced `this.update()`), so the handlers request no update themselves and scalar `control` edits never rebuild the tab or steal focus from inline inputs.
- **Templates** carry a redesigned eject feature: per-template eject / open / reset (reset behind `ConfirmationModal`) + eject-all, driven by `EMBEDDED_DEFAULTS`/`CANONICAL_NAMES`/`toFilename` writing into the template folder (no `TemplateService` change — its vault watcher picks up ejected files). Ejected state = vault-file existence; the tab rebuilds on `.eta.md` vault create/delete/rename via a debounced `this.update()`.
- **Module layout.** `setting-tab/{index,context,database,logging,templates,frontmatter,frontmatter-modal}.ts`. i18n keys under `settings_*` / `notice_template_*` / `action_cancel`; orphaned group-heading, log-button, and Notes-page keys removed.
- **Removed settings.** `template.update-overwrite` and `template.update-annot-block` dropped — block-ID/overwrite-gating infra was removed in Stage 5 and v0 values are no longer migrated. `attachment.folder-path` empty is treated as the default folder (`ensureAttachmentFolder` relaxed to `!folderPath`).
- **Post-alpha follow-ups.** (1) Live **template preview** — render a sample item through the active template in-tab (see the deferred template-preview view in §3.2 / §5). (2) **Frontmatter field preview + validation** — evaluate each `{key, expr}` against a sample item inside `FrontmatterFieldModal` to show the resolved value and surface compile/runtime errors; today validation is key-level only (empty/reserved/duplicate/empty-expr) and the JS `expr` is first compiled at note-create time.

**Stage 7 — Citekey-click (done)**

- `apps/obsidian/src/services/citekey-click/service.ts`: `CitekeyClick extends Service<void>` (deps `{ app, noteIndex, noteFeatures, db, settings }`, registered in `services/build.ts` after `noteFeatures`). On `workspace.onLayoutReady` (and each `layout-change` until it lands once), it loads the first markdown leaf and wraps two **live prototype** methods via `monkey-around`'s `around` (co-operative, removable uninstall): `Editor.getClickableTokenAt` and `MarkdownEditView.triggerClickableToken`. Disposal flips a `#disposed` guard so a late `onLayoutReady` can't reinstall.
- **Token detection is a line regex, not a CodeMirror syntax-tree walk.** `parse.ts` `citationAtOffset(line, offset)` (pure, arkregex typed capture) finds the `@citekey` spanning the click: `@` not preceded by a word char or `.` (so `a@b.com` / `me@host` are ignored), key running until a bracket/`;`/`,`/whitespace. Covers `[@key]`, `[@key, p. 3]` (→ `@key`), `[@a; @b]`, `-@key`, and bare `@key`. This sidesteps adding `@codemirror/language` (the v1 `hmd-barelink` approach) — the native click handler's DOM gating (`.cm-underline` + `.cm-link`) already requires the token to render clickable, so reimplementing Obsidian's token classifier bought nothing.
- **Resolution.** `getClickableTokenAt`: native first, else build a synthetic `internal-link` token — indexed citekey (`NoteIndex.getNotesByCitekey`, alphabetical first per v1 TODO) → token `text` is the note path (native opens it); unindexed → token carries a `citekey: "zotero"` marker. `triggerClickableToken` intercepts the marker and runs create-then-open: re-check the index (race), then resolve the Zotero item via `getItemIDByCitekey` (configured `zotero.citation-library`, default user library) → `getItemsByID` → `NoteFeatures.create` (`toast.promise`) → `openLinkText`. Misses surface `notice_citekey_not_found`; a not-ready DB surfaces `notice_citekey_db_unavailable`.
- `packages/db/src/queries/citekey.ts` — `getItemIDByCitekey(db, libraryID, citekey)` (+ async): filters `itemData` on `fieldsCombined.fieldName = "citationKey"`, `itemDataValue.value = citekey`, and a live (`deletedItem: false`) item in the library; returns the `itemID` or `null`. Native BBT citationKey field only (per §2). Exported from `@zotlit/db`.
- Private Obsidian API typing in `src/typings/obsidian-ex.d.ts`: `ClickableToken`, `Editor.getClickableTokenAt`, `MarkdownView.editMode?`, `MarkdownEditView.triggerClickableToken`.

**Stage 8 — Annot view + attachment import** _(done)_

_Attachment import (done):_

- `apps/obsidian/src/services/attachment-import/service.ts`: `AttachmentImportService extends Service<void>`. `prepare(notePath)` reads settings, resolves the attachment folder (skipped when import is disabled), and returns an `AttachmentImport` handle (the internal `AttachmentImportBatch`) with `resolveEmbed(sourcePath, vaultName) → string` (records pending pair, returns embed string) and `flush() → Promise<{copied, skipped}>`. Registered in `services/build.ts` before `noteIndex`; injected into `NoteFeatures`. No queue/cancel — dropping the handle abandons pending pairs via GC.
- `packages/db/src/lib/zt-path.ts`: `resolveAnnotCachePath(annotation, ctx)` (annotation `{ key, type }` + `AnnotCachePathContext { dataDir, groupID }`) returns the annotation cache source path, or `null` for annotation types Zotero never caches an image for (only `image`/`ink` do) — the "is there a cache image" rule lives here, so callers can't build a path for a non-cacheable annotation; `attachmentAbsPath(attachment, ctx)` + `AttachmentPathContext` moved here from `note-feature/file-link.ts` — resolves any Zotero attachment (storage, linked-absolute, linked-base) to an absolute on-disk path. Exported via the dedicated `@zotlit/db/path` entry (depends on `node:path`, so it stays out of `index.ts`).
- `packages/db/src/queries/attachments.ts`: `getAttachmentByKey(db, key, libraryID)` added (shares the find-options with `getAttachmentsByParents`) for the embedded-image lookup.
- `apps/obsidian/src/lib/reflink.ts`: extracted from `services/database/read-source.ts`. Platform-aware clonefile (macOS `cp -c`, Linux `COPYFILE_FICLONE_FORCE`) with fallback to regular `copyFile`.
- `apps/obsidian/src/lib/copy-attachments.ts`: `copyAttachments(items: {source, dest}[])` — stats source+dest, skips when dest matches (size + mtimeMs), otherwise reflinks/copies. Pure `node:fs`, no Obsidian API.
- `apps/obsidian/src/lib/ensure-folder.ts`: `ensureAttachmentFolder(app, folderPath, sourcePath?)` — `null` folder resolves to Obsidian's default via `getAvailablePathForAttachment()`.
- `apps/obsidian/src/lib/markdown-link.ts`: `syntheticFile(filePath)` — a `TFile` stand-in (built off `TFile.prototype` so it passes `instanceof`, populating only `path`/`name`/`basename`/`extension`) so the service can call Obsidian's **native** `fileManager.generateMarkdownLink` for an attachment that isn't created/indexed yet. Not a full reimplementation — only the four fields Obsidian reads are populated.
- Settings: `attachment.folder-path: string | null` (default `null` = Obsidian default folder), `attachment.import: boolean` (default `true`). Disabled → `file://` URIs to Zotero's data dir. Enabled → reflink+copy into vault. The old `img-excerpt.*` keys + `resolveImgExcerptImport`/`ImgExcerptImport` are removed. Migration: `imgExcerptImport !== false` → `attachment.import: true` (`false` → `false`); `imgExcerptPath` → `attachment.folder-path`.
- Destination naming: flat under the resolved folder. Annotation cache: `{annotKey}.png`. Note embeds: `{attachmentKey}-{filename}`.
- `NoteContextInput` gained `imgEmbed: (annotation, parentAttachment) → string` (parallel to `fileLink`); `buildNoteContext` fills `TemplateAnnotation.imgEmbed`. `NoteFeatures.create`/`update`/`overwrite` now `prepare()` a handle, build the context with the `imgEmbed` resolver (annotation cache path → `resolveEmbed`), and `flush()` after writing. The filename render uses a no-op `resolveEmbed: () => ""` so it records no pairs.

_Annot view UI + live wiring (done):_

- **Two purpose-built queries** — `packages/db/src/queries/annot-view.ts` (exported from `@zotlit/db`): `getAnnotViewAttachments(db, itemKey, libraryID)` (joins `items.key → itemAttachments.parentItemID`, counts annotations per attachment) and `getAnnotViewAnnotations(db, attachmentItemID, libraryID)` (ordered by `sortIndex`, **tags embedded** via the `itemAnnotations → itemTags → tags` relation). Each projects only the columns the view renders; the inferred row shape **is** the exported type (`AnnotViewAttachment` / `AnnotViewItem`) — no `Pick`, no dependency on the full `Annotation`/`Attachment` interfaces. Both sync on `db.client`.
- `apps/obsidian/src/views/annot-view/` — React 19.2 view mounted via `createRoot`. Module layout:
  - `view.tsx` — `AnnotationView extends ItemView`: per-leaf `createStore()` on `#store`, `<Provider store={this.#store}>` wraps the tree; `contentEl.addClass("zt-root")` scopes Tailwind preflight; `onClose` calls `#root.unmount()`. View-owned orchestration (no new service): deps `{ app, db, zoteroPref }` injected per-leaf via `registerAnnotView`. **Resolve chain:** active markdown file → `itemKeyFromFrontmatter` (note-index pure import, no `getItemsByKey`) → `getAnnotViewAttachments` → pick active attachment (persisted per item key via `app.loadLocalStorage`/`saveLocalStorage`, default first) → `getAnnotViewAnnotations`. Library ID resolved from a cached `getLibraries` lookup. Subscribes in `onOpen` / tears down in `onClose`: `db.on("changed")`, `workspace.on("active-leaf-change")`, `metadataCache.on("changed")` (only for the active file). **Empty states:** no frontmatter key → "not a literature note"; key present but no attachments → "no attachments available".
  - `store.ts` — atoms hold db-owned types: `attachmentsAtom: AnnotViewAttachment[] | null`, `attachmentIDAtom`, `annotationsAtom: AnnotViewItem[] | null`, `itemKeyAtom`, `groupIDAtom`, derived `activeAttachmentAtom`. The narrow `AnnotItem`/`AtchItem`/`DocItem`/`TagItem` interfaces and the `docAtom`/`tagsAtom`/`followAtom` atoms are removed.
  - `AnnotView.tsx` — `AnnotView` root (toolbar + list), `Toolbar` (collapse + refresh), `AttachmentSelector` (native `<select>` hidden when ≤1 attachment, shows `(annotCount) filename`), `AnnotList` (CSS `@container` masonry via `columns-*` breakpoints). Details and Follow concepts removed entirely.
  - `Annotation.tsx` — `Annotation` card (icon draggable header, colored `<blockquote>` excerpt, comment, tags); `Excerpt` switches on `annotationTypeToName(type)` (highlight/underline/text → `<p>`, image → `<img>`); `PageLabel` renders page label as a `zotero://open/` anchor when a backlink is available. The `⋮` button and right-click both open the more-options menu.
  - `actions.tsx` — `AnnotActions` interface (`onMoreOptions`, `onDragStart`, `onRefresh`, `getImgSrc`, `getBacklink`) + `AnnotActionsContext`. `createAnnotActions(deps)` replaces the old `mockAnnotActions`: `getImgSrc` → `resolveAnnotCachePath` (`@zotlit/db/path`) → `Platform.resourcePathPrefix` resource URL with cachebust (placeholder SVG when uncached), `getBacklink` → `annotationOpenUri`, `onMoreOptions` → Obsidian `Menu` (**Copy backlink**, **Copy annotation text** — omitted for image annotations), `onRefresh` → `db.refresh()` via `toast.promise`. `onDragStart` is injected by the view (templated drag-insert — see `drag-insert.ts` below).
  - `drag-insert.ts` — `createDragInsertHandler(deps)` builds the `onDragStart` handler (mirrors v1's `drag-insert.ts`). On drag start it renders the dragged annotation through the **`annotation`** template into the `text/plain` payload (Obsidian inserts it natively on drop) via `NoteFeatures.renderAnnotationForDrag(indexedKey, key, importHandle)`, and tags the drag with a custom `zotlit-annot-drag` MIME = `timeStamp`. On `workspace.on("editor-drop")` whose tag matches, it `flush()`es the annotation's image excerpt into the vault; cleared on `dragend`. Falls back to plain text when the DB/import handle isn't ready. The view pre-prepares one `AttachmentImport` handle per active literature note (async, in `#resolveAndLoad`) so the render stays synchronous; `renderAnnotationForDrag` records **only** the dragged annotation's image (gated `imgEmbed` resolver in `NoteFeatures.#buildContext`).
  - `register.ts` — `registerAnnotView(plugin, { app, db, zoteroPref, noteFeatures, attachmentImport })`: `registerView`, `addCommand` (`"open-annot-view"`), `addRibbonIcon` (`"highlighter"`). `activateView` opens/reveals in the right sidebar leaf.
  - `style.css` — view-specific styles imported from `register.ts`.
- Vite config: no plugin needed (esbuild handles JSX from tsconfig). `react`, `react-dom`, `jotai` added to `apps/obsidian/package.json` `dependencies`; `@types/react`, `@types/react-dom` to `devDependencies`.

_Templated drag-insert (done):_ see `drag-insert.ts` + `NoteFeatures.renderAnnotationForDrag` above.

_Deferred (post-alpha):_

- **Annotation merging** — v1's `mergeAnnots` / `mergeTags`.
- **Zotero-reader follow mode** + template-preview Details (v1's `zt-reader` follow and details view; the view always tracks the active literature note). "Jump to note" is unbuildable — its block-ID index was removed as dead infra in Stage 5.

**Stage 9 — Zotero note import**

- Add the import flow for Zotero native notes using the Stage-4 `NoteParser`. Alpha-quality import output is the fixed current parser format: Zotero note HTML → Obsidian Markdown with inline annotation marks.
- Make import output customizable in this same stage. Zotero Better Notes enhances native Zotero notes rather than replacing them with a separate source type, so compatibility belongs in this importer: preserve the fixed parser as the baseline, then add extension points for Better Notes' enhanced native-note HTML and user-controlled Markdown output.
- **Note embedded image resolution** — the resolver is **already implemented** (Stage 8 attachment-import work): `parseNote` accepts an optional `embeddedImage: NoteEmbeddedImageDeps` (`{ client, libraryID, pathContext, resolveEmbed }`), and `resolveEmbeddedImage` does the sync DB lookup per `<img data-attachment-key>` (`getAttachmentByKey`) → `attachmentAbsPath` → `resolveEmbed(sourcePath, "{attachmentKey}-{filename}")`, falling back to raw `<img>` HTML when the attachment or its path is unresolved. **Remaining for this stage:** wire the import flow to construct `NoteEmbeddedImageDeps` (resolve `db.client`, the note's `libraryID`, the `AttachmentPathContext`, and a prepared `AttachmentImportService` handle) and pass it into `parseNote`.
- **Note citation resolution** lands here. The `citation` rule ships as a pass-through in Stage 4; resolving it belongs with the import flow because the citekey chain only feeds `template.render("cite", …)`, and `parseNote` has no consumer before import. The parsers are already shipped (`parseCitation` → `@zotlit/db` `parseCitationData` / `parseItemUri`); only the orchestrator wiring is new.
- **`parseNote` signature** — `ParseNoteDeps` is currently `{ Turndown, embeddedImage? }` (the image leg, shipped in Stage 8). The citation leg grows it with `db`/`template`, where `db: NodeDatabaseClient | null` is resolved at the call site (`db.state === "ready" ? db.client : null`) so a degraded DB is a normal embedded-fallback path, not a throw. Declare the `TurndownService` global in `src/typings/obsidian-ex.d.ts`.
- **Citekey chain** per cited item — DB → embedded → sentinel: (1) **DB** `IndexedItem.citationKey` from the index-items query (`queries/index-items.ts`), **not** `getItemsByKey` (its shape doesn't carry `citationKey`); resolve only against the note's own `libraryID`. (2) **Embedded** `data-citation-items[uri].itemData["citation-key"]` (standard CSL-JSON). (3) **Sentinel** `` `${key}?` `` — truthy, so it survives the default `cite` template's `filter(lit => !!lit.citekey)` and renders a visible, greppable `[@KEY?]`.
- **Embedded map is URI-keyed**, not key-keyed: each entry's `itemData.id` is the full library-qualified URI (identical to `uris[0]`); build `Map<uri, itemData>` and resolve a citation by walking its own `uris` for the first hit (avoids same-key-different-library collisions). It sits on the **same** `<div>` as `data-schema-version`, so `parseNoteSchema(root).container.getAttribute("data-citation-items")` reaches it — no extra query. Needs a small valibot schema (sibling of the mark schemas).
- **Cross-library cites resolve via the embedded leg only.** A citation `ref` may point at a group library that the same-library DB query can't see; it falls through to the embedded CSL snapshot, which always travels with the note. No per-`ref` group remap. Trade-off: cross-library cites get the snapshot citekey, not live BBT data.
- **Open items.** `locator` (`citationItem.locator`, e.g. `"62"`) is parsed but unconsumed — Pandoc wants `[@key, p. 62]` (distinct from CSL `page`, the article's range); render-stage decision. `suppress-author` (Pandoc `-@key`) is a **parser** gap: re-add `properties` to `CitationSchema` in `zt-note-mark.ts`. Cite-template vocabulary (CSL-JSON field names recommended, since the embedded leg is already CSL) is decided with the template; normalizing the DB leg to CSL needs an `itemToCSLJSON`-equivalent. Each source normalizes to a per-item shape whose citekey property is named `citekey`.

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
| **Deferred** PDF outline parser | `services/pdf-parser/service.ts`                                                                                      |
| Annot view                    | `note-feature/annot-view/{view,store,drag-insert,more-options}.tsx`                                                     |
| Attachment import              | `services/zotero-db/img-import/service.ts` (feature-set reference only; v2 design is a fresh coordinator, not a port)    |
| **Deferred** Server           | `services/server/service.ts`                                                                                            |
| Protocol handlers             | `note-feature/protocol/service.ts`                                                                                      |
| **Deferred** Topic-import     | `note-feature/topic-import/`                                                                                            |
| Zotero note import            | `note-feature/note-import/index.ts`                                                                                     |
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

- **Citation suggester styling.** The current citation item row rendered in editor-suggest and quick-switcher has styling issues.
- **ItemLookup fuzzy search tuning.** MiniSearch scoring is functional but not well tuned; empirical bench/tuner work is planned (`packages/item-lookup/TODOS.md`).
- `apps/zotero` companion migration — not yet scoped. v1 protocol is compatible with v2's eventual server, so v1's companion can keep working against v2 during the deferral window.
- Whether `bg:notify` is needed at all once the server lands (fs.watch already covers DB refresh; `bg:notify` only retains value for export/open flows).
