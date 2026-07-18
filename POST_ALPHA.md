# ZotLit v2 post-alpha plan

Extracted from `[MIGRATION.md](./MIGRATION.md)` after alpha (Stages 0–8) shipped. Shipped work lives in git history and stage docs; this file tracks only what remains.

## 1. Zotero note import (Stage 9)

Stages 9.0–9.3 and 9.2-CSL shipped. **9.4** (Better Notes) remains.

### 1.1 Better Notes (9.4)

Zotero Better Notes enhances native Zotero notes (not a separate source type), so compatibility belongs in this importer: fixed parser as baseline, extension points for Better Notes' enhanced HTML and user-controlled Markdown output. Requires a dedicated design pass — depends on the concrete parser extension surface from 9.0–9.3.

## 2. Companion-dependent features

| Feature | v1 source | Notes |
| --- | --- | --- |
| Topic-import | `note-feature/topic-import/` | Tag-driven auto-create; not yet ported (see §2.1) |

### 2.1 Topic-import (v1 reference)

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

## 5. Setting-tab enhancements

Deferred from Stage 6.

- **Live template preview** — render a sample item through the active template in-tab.
- **Frontmatter field preview + validation** — evaluate each `{key, expr}` against a sample item inside `FrontmatterFieldModal`; surface compile/runtime errors beyond today's key-level checks.
- **Template preview view** — standalone template preview as an `ItemView` (distinct from the in-tab preview above).

## 6. PDF outline parser

v1 ships `getPDFOutline` / `getCachedOutlineKeys` but never calls them — no API, server, or view consumer. Don't port until the annot view (or another feature) actually consumes an outline; then it lands as its own stage.

Source: `services/pdf-parser/service.ts`.

## 7. Polish & tuning

- **Citation suggester styling** — the current citation item row in editor-suggest and quick-switcher has styling issues.

### 7.1 ItemLookup bench/tuner

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

## 8. Contributor testing fixtures & collaboration guide

- **Common testing Zotero database** — repo-maintained library fixture for reproducible manual and automated testing.
- **Common testing Obsidian vault** — matching vault fixture (templates, sample notes, plugin settings).
- **Dev-stack onboarding** — how to set up fixtures and run the dev stack end-to-end (release/CI docs already in `CONTRIBUTING.md` and `docs/CI_SETUP.md`).
- **[Keep a Changelog](https://keepachangelog.com/en/1.1.0/)** — root `CHANGELOG.md` with curated release notes.
- **Conventional Commits** — shared commit-message convention for changelogs and release tooling.
