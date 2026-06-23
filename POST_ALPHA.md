# ZotLit v2 post-alpha plan

Extracted from `[MIGRATION.md](./MIGRATION.md)` after alpha (Stages 0–8) shipped. Shipped work lives in git history and stage docs; this file tracks only what remains.

## 1. Zotero note import (Stage 9)

The first post-alpha stage. Wires the Stage-4 `NoteParser` into a Zotero-initiated import flow with citation resolution, embedded-image resolution, and customizable output.

### 1.1 Import flow

- **Trigger from Zotero, not Obsidian UI.** No command-palette import command, modal, or in-vault note picker. The companion initiates import the same way open/update do today: Zotero context menus → `obsidian://zotlit/…` → Obsidian protocol handler → orchestrator (v1: `note-feature/note-import/index.ts`). Extend the existing library-item menus and/or add child-note menus; a dedicated protocol action is fine if import needs its own verb, but the entry point stays on the Zotero side.
- Alpha-quality output is the fixed Stage-4 format: Zotero note HTML → Obsidian Markdown with inline annotation marks.
- Make import output customizable. Zotero Better Notes enhances native Zotero notes (not a separate source type), so compatibility belongs in this importer: fixed parser as baseline, extension points for Better Notes' enhanced HTML and user-controlled Markdown output.

### 1.2 Embedded image resolution

Stage-4 parser support ships; wire the import flow to construct `NoteEmbeddedImageDeps` (`db.client`, `libraryID`, `AttachmentPathContext`, prepared `AttachmentImportService` handle) and pass it into `parseNote`.

### 1.3 Citation resolution

- `citation` rule ships as pass-through in Stage 4; resolving it belongs here because the citekey chain only feeds `template.render("cite", …)`.
- Parsers already shipped (`parseCitation` → `@zotlit/db` `parseCitationData` / `parseItemUri`); only orchestrator wiring is new.
- `ParseNoteDeps` grows from `{ Turndown, embeddedImage? }` with a `db`/`template` leg. Degraded DB (`db.state !== "ready"`) → fallback path, not a throw.
- Declare `TurndownService` global in `src/typings/obsidian-ex.d.ts`.

**Citekey chain** per cited item — DB → embedded → sentinel:

1. **DB** — `IndexedItem.citationKey` from `queries/index-items.ts` (not `getItemsByKey`); resolve only against the note's own `libraryID`.
2. **Embedded** — `data-citation-items[uri].itemData["citation-key"]` (standard CSL-JSON).
3. **Sentinel** — ``${key}?`` — truthy, survives the default `cite` template's `filter(lit => !!lit.citekey)`, renders a visible greppable `[@KEY?]`.

**Embedded map** is URI-keyed (each entry's `itemData.id` is the full library-qualified URI). Build `Map<uri, itemData>`, resolve a citation by walking its `uris` for the first hit. Sits on the same `<div>` as `data-schema-version` — `parseNoteSchema(root).container.getAttribute("data-citation-items")` reaches it. Needs a small valibot schema.

**Cross-library cites** resolve via the embedded leg only (snapshot citekey, not live BBT data).

### 1.4 Open items

- `locator` (`citationItem.locator`, e.g. `"62"`) is parsed but unconsumed — Pandoc wants `[@key, p. 62]`; render-stage decision.
- `suppress-author` (Pandoc `-@key`) is a parser gap: re-add `properties` to `CitationSchema` in `zt-note-mark.ts`.
- Cite-template vocabulary (CSL-JSON field names recommended); normalizing the DB leg to CSL needs an `itemToCSLJSON`-equivalent.

## 2. Companion-dependent features

| Feature | v1 source | Notes |
| --- | --- | --- |
| Topic-import | `note-feature/topic-import/` | Tag-driven auto-create; not yet ported (see §2.2) |
| Companion release | — | First public release cut and Obsidian community-plugin listing. Release pipeline ships (`pnpm release`, `.github/workflows/{ci,release}.yml`, Zotero update manifests on `zotero-release`) — see `CONTRIBUTING.md` and `docs/CI_SETUP.md`. |

### 2.1 Protocol batch update (shipped)

Initial land `55c7d60`; polish through `b7d2de4`. v1 source: `note-feature/protocol/service.ts` → v2 `services/note-feature/batch-update.ts` + `views/batch-update-modal.ts`.

- **Transport** — `obsidian://zotlit/update-many?items=<id,…>&source-id=<hash>`. Zotero **Update** on a multi-selection sends one link; when the URL exceeds 2000 chars it falls back to `PATCH /literature-notes` on the first `notify-url` target (Zotero progress window reports send outcome).
- **Orchestrator** — `runBatchUpdate` batch-updates/creates literature notes through the per-item `NoteFeatures` path (no batch DB query). Classifies ids into update / create / not-found; branches on actionable count: 0 → notice, 1 → single-item handler, ≥2 → modal.
- **Modal UX** — loading phase runs chunked classification behind a determinate bar (cancel stays responsive on large batches); confirm checklist; run phase with per-item progress, live failure panel, keep-open warning, and outcome summary.
- **Consistency** — `DatabaseService.acquireRead()` pins the client across classify/run; batch create uses `suffix()` for collision-free filenames.
- **HTTP path** — `LiveUpdateService` acks 204 immediately and defers the `update-many` emit past the response flush.
- **Dropped** — v1 `export-many` (always-create); use update for in-place refresh.

Stage 9 note import extends the same single-item pattern (Zotero menu → protocol → Obsidian orchestrator).

### 2.2 Topic-import (v1 reference)

A "subscribe a note to a Zotero tag" workflow: attach a `#zt-topic/<name>` tag to a note, flip the status-bar toggle, and every item subsequently **added** in Zotero auto-generates a Markdown note tagged with that topic.

v1 lives in `app/obsidian/src/note-feature/topic-import/` (~267 lines, an `@ophidian/core` `Service` across 4 files):

- **Topic detection** (`service.tsx` + `utils.ts`) — listens to `workspace.on("file-open")` + `metadataCache.on("changed")`, runs `getAllTags(cache)`, keeps the tags prefixed `#zt-topic/`. A zustand store holds `topics: string[]` + `activeTopic`. A note may carry several topic tags.
- **Status-bar UI** (`status.tsx`) — `ImportingStatus` checkbox. No topic → "no topic", disabled; one → `#name`; many → a `Menu` to pick which topic before watching. Checking it pins `activeTopic`. **Watching locks the topic**: while `watching`, `onFileOpen` returns early so switching notes doesn't change the subscribed topic.
- **Auto-create** (`service.tsx onload` + `create-note.tsx`) — subscribes to the server's `bg:notify` event carrying `INotifyRegularItem` (`{ event: "regular-item/update", add[], modify[], trash[] }`, `lib/protocol/src/bg.ts`). On an `add` while a topic is active, `untilDbRefreshed` waits for the local DB to catch up, then `createNote` renders each new item through the template, injecting the topic as a tag.

**v2 porting note:** v1's `bg:notify` + `regular-item/update` were dropped — DB refresh is fs.watch and live state uses HTTP `/notify`. A v2 port must drive the auto-create leg off `LiveUpdateService` `item/update` events instead, with topic detection/UI carried over largely intact.

## 3. Annot view follow-ups

- **Annotation merging** — v1's `mergeAnnots` / `mergeTags`. Combine annotations from multiple attachments or deduplicate across updates. The Zotero-side reader annotation context-menu item ("Merge Annotations") is scaffolded but commented out in `apps/zotero/src/menus/reader-annotation.ts` (FTL `zotlit-menu-reader-annot-merge` retained); re-enable it here when the feature returns.

## 4. Template service follow-ups

- **Template playground** — hosted editor over a real Zotero DB via sqlite-wasm (`apps/`). The `@zotlit/templates` extraction shipped; playground app, sqlite-wasm wiring, and editor UI remain.
- **User-facing template docs** — drafted in `docs/template-v2/` (syntax, data reference, frontmatter, defaults, migration); wire into the website.
- **Field-name completion in `EtaSuggest`** — `zt.title`, `zt.citekey`, `zt.creators`, `zt.tags`, etc. Needs template type definitions to drive the suggestion list.
- **`template-edited` event** on `TemplateService` (nanoevents) — add when a live-preview consumer (annot view) needs to re-render on template edits.
- **Async render path** (`renderAsync`) — only if a consumer ever needs `await`-able rendering.

### 4.1 v1 template syntax compat layer (deferred)

A one-shot detector/transformer that keeps a user's **v1** template files rendering under the v2 engine. Deferred until there is demand from real upgraders — until then these are hard breaks documented in `docs/template-v2/migration.md`, not shims.

Known v1→v2 breaks the compat layer would cover:

- **Variable prefix** — v1 `it.*` → v2 `zt.*` (`varName` changed globally).
- **Field names** — v1 raw Zotero field names → v2 CSL-inspired (`abstractNote` → `abstract`, `publicationTitle` → `containerTitle`, flat `zt.*` with no `fields` sub-object).
- **Default-template filenames** — v1 `zt-*` → v2 `zotlit-*` (`zt-note` → `zotlit-note`, `zt-annots`/`zt-annot` → `zotlit-content`/`zotlit-annotation`, `zt-cite`/`zt-cite2` → `zotlit-cite`/`zotlit-cite2`; removed: `zt-field`, `zt-colored`).
- **`eta-prf` fork syntax** — any template relying on fork-only behavior not covered by upstream `eta@^4`.

## 5. Setting-tab enhancements

Deferred from Stage 6.

- **Live template preview** — render a sample item through the active template in-tab.
- **Frontmatter field preview + validation** — evaluate each `{key, expr}` against a sample item inside `FrontmatterFieldModal`; surface compile/runtime errors beyond today's key-level checks.
- **Template preview view** — standalone template preview as an `ItemView` (distinct from the in-tab preview above).
- **Item details view** — inspector-style view showing resolved item data.

## 6. Note feature follow-ups

### 6.1 Multi-attachment behavior

Zotero hierarchy: Literature Item → Attachment Item (PDF/EPUB/etc.) → Annotation Item.

**Alpha (shipped):**

- **All attachments by default** — create, update, and overwrite always include every attachment; no selection UI; `zt-attachments` is never read.
- **`zt.annotations`** — flat list across all attachments; each annotation carries `parentAttachment` so templates can group/filter by source.
- **`zt.attachments`** — top-level `TemplateAttachment[]` on the note context.
- **`zt-attachments` is scope input, not managed output** — excluded from the managed frontmatter set (union/append-only merge does not apply).

**Post-alpha (land together):**

- **`zt-attachments` scoping** — missing or empty → all attachments at update time (including newly added ones). Present with keys → scoped to those specific attachments. Read/write wiring lands with the selection UI below.
- **v1 backward compat** — `zt-attachments` values that are numeric strings (v1 item IDs) are resolved to attachments by ID, then migrated to string keys on first update. Stale v1 values left unread in alpha remain as harmless unmanaged metadata until then.
- **Attachment selection UI** — v1 reference: `atch-suggest.ts` (`cacheAttachmentSelect`, `chooseAnnotAtch`). Port as whitelist + blacklist that writes `zt-attachments`; deferred from alpha.

## 7. PDF outline parser

v1 ships `getPDFOutline` / `getCachedOutlineKeys` but never calls them — no API, server, or view consumer. Don't port until the annot view (or another feature) actually consumes an outline; then it lands as its own stage.

Source: `services/pdf-parser/service.ts`.

## 8. Polish & tuning

- **Citation suggester styling** — the current citation item row in editor-suggest and quick-switcher has styling issues.

### 8.1 ItemLookup bench/tuner

MiniSearch scoring is functional but not well tuned. Build an empirical bench/tuner harness in `packages/item-lookup/bench/` to tune `ScoringConfig` against a real Zotero corpus (today: `/Users/aidenlx/repo/zotlit-repo/1287.zotero.migrated.sqlite`; future: §9 common testing DB).

**Shipped foundation** (commit `5d58e28`, `feat/search`):

- `@zotlit/item-lookup` package with injectable `scoring?: ScoringConfig`; `DEFAULT_SCORING` exported. `buildIndex` signature unchanged — nothing index-time is tunable.
- Knobs: `boosts` (per-field MiniSearch boost), `recencyMaxBoost`, `recencyHalfLifeDays`, `exactYearBonus`, `fuzzy: (term) => number`, `prefix: boolean` — see `packages/item-lookup/src/engine.ts`.
- Obsidian service uses hardcoded `DEFAULT_SCORING` (not surfaced to view consumers). CJK segmenter stays in `apps/obsidian/src/services/item-lookup/chs-segmenter.ts`.
- Internal `src/jieba.ts` wraps `jieba-wasm` (devDep only; not in package exports) for bench/tests inside the monorepo.

**Settled decisions**

| Question | Settled |
| --- | --- |
| Bench location | `packages/item-lookup/bench/` (inside the package, not a new workspace) |
| jieba public export? | No — internal `src/jieba.ts` only |
| Wasm path plumbing? | No — jieba-wasm node entry handles it |
| Production segmenter | Unchanged — Obsidian probes `cm-chs-patch` via `getChsSegmenter` |
| `ScoringConfig` shape | Flat config object, no deep-partial merge. Bench spreads overrides from `DEFAULT_SCORING`. |
| Obsidian service config | Hardcoded `DEFAULT_SCORING` |
| REPL in this stage | No — bench only (judge-set + metrics + sweep). REPL deferred. |

**Open questions** (decide before building):

1. **Judge set source.** Hand-authored `query → expected-itemKey[]` JSON is the default — small (20–50 queries), diff-friendly, intentional about edge cases. Alternatives: synthetic from title/creator combinations, or mined user logs (none collected).
2. **Metrics.** Default to all three: MRR, nDCG@10, precision@5. Single-metric tuning loses regression signal (e.g. precision up, recall down).
3. **Sweep strategy.** Grid search per knob holding others at default, tabular output. Bayesian optimisation is overkill for ~6 knobs.
4. **Report format.** `console.table` for interactive runs; markdown table under `bench/results/<config>.md` for PR diffs. Pick one to start.
5. **Corpus snapshot.** Loading 1287 items from sqlite per run is ~100ms — acceptable. Pre-snapshot to JSON only if run time becomes a bottleneck.

**Suggested order**

1. Commit initial `bench/judge-set.json` after settling judge-set format.
2. `bench/corpus.ts` — load `IndexedItem[]` via `@zotlit/db` + `NodeDatabaseClient`; skip with a clear message if sqlite is absent (same pattern as DB integration tests).
3. `bench/metrics.ts` — MRR, nDCG@K, precision@K as pure functions with unit tests on trivial inputs.
4. `bench/bench.ts` — build index once, sweep configs, emit results in the chosen report format.
5. Add `"bench"` script to `packages/item-lookup/package.json` (check `packages/scripts` for the repo's tsx pattern). Keep `bench/**` outside tsdown `entry`.

**Resources**

- Corpus loader: `getIndexedItemsByLibrary` from `@zotlit/db` + `NodeDatabaseClient` from `@zotlit/db/client/node` → `buildIndex`.
- CJK segmenter for Chinese-titled judge queries: `import { jieba } from "../jieba"` → `TokenizerOptions.chsSegmenter`.
- Synthetic edge cases: `@zotlit/item-lookup/fixtures` (`makeIndexedItem`, `makeItem`, `makeCreator`).
- Scoring rationale / Zotero `quicksearch-titleCreatorYear` parity: `search-comparison.md` at worktree root (untracked reference).

**Deferred**

- **REPL / interactive console** — typing-loop UI for eyeball tuning; add only if metric tuning hits the wall.
- **Disk-persisted index** — Omnisearch-style cache; build time on 1287 items is well under budget (`search-comparison.md` §5.4).
- **Hand pre-tuning** — recency curve, left-anchor creator boost, exact-title boost are what the bench tunes for; don't tune by hand ahead of empirical results.

## 9. Contributor testing fixtures & collaboration guide

- **Common testing Zotero database** — repo-maintained library fixture for reproducible manual and automated testing.
- **Common testing Obsidian vault** — matching vault fixture (templates, sample notes, plugin settings).
- **Dev-stack onboarding** — how to set up fixtures and run the dev stack end-to-end (release/CI docs already in `CONTRIBUTING.md` and `docs/CI_SETUP.md`).
- **[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)** — root `CHANGELOG.md` with curated release notes.
- **Conventional Commits** — shared commit-message convention for changelogs and release tooling.
