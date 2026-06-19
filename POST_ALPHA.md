# ZotLit v2 post-alpha plan

Extracted from `[MIGRATION.md](./MIGRATION.md)` after alpha (Stages 0–8) shipped.

## 1. Zotero note import (Stage 9)

The first post-alpha stage. Wires the Stage-4 `NoteParser` into a Zotero-initiated import flow with citation resolution, embedded-image resolution, and customizable output.

### 1.1 Import flow

- **Trigger from Zotero, not Obsidian UI.** No command-palette import command, modal, or in-vault note picker. The companion initiates import the same way open/update do today: Zotero context menus → `obsidian://zotlit/…` → Obsidian protocol handler → orchestrator (v1: `note-feature/note-import/index.ts`). Extend the existing library-item menus and/or add child-note menus; a dedicated protocol action is fine if import needs its own verb, but the entry point stays on the Zotero side.
- Alpha-quality output is the fixed Stage-4 format: Zotero note HTML → Obsidian Markdown with inline annotation marks.
- Make import output customizable. Zotero Better Notes enhances native Zotero notes (not a separate source type), so compatibility belongs in this importer: fixed parser as baseline, extension points for Better Notes' enhanced HTML and user-controlled Markdown output.

### 1.2 Embedded image resolution

Already implemented in Stage 8. Remaining: wire the import flow to construct `NoteEmbeddedImageDeps` (`db.client`, `libraryID`, `AttachmentPathContext`, prepared `AttachmentImportService` handle) and pass it into `parseNote`.

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

Core companion surface ships: `apps/zotero` pushes events over HTTP, Obsidian listens via `LiveUpdateService`, and Zotero menus launch `obsidian://zotlit/{open,update}` links. Remaining gaps are below.


| Feature                        | v1 source                          | Notes                                                                                                                                                                                                                                                                            |
| ------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~Server (HTTP listener)~~     | `services/server/service.ts`       | **(done)** `LiveUpdateService` (`services/live-update/service.ts`): Hono `POST /notify`, validates `@zotlit/protocol` events, drives annot-view reader follow. Settings live under `server.*`.                                                                                   |
| ~~Protocol handlers~~          | `note-feature/protocol/service.ts` | **(partial)** `obsidian://zotlit/{open,update}` handlers in `services/protocol/register.ts`; Zotero menus in `apps/zotero/src/menus/`. Stage 9 note import extends this pattern (Zotero menu → protocol → Obsidian orchestrator), not an Obsidian import UI. `export` (always create fresh) and batch `update-many` / `export-many` remain future work. Wire contract: `packages/protocol/src/url.ts`. |
| ~~Setting-tab `server` group~~ | `setting-tab/`                     | **(done)** "Live updates" sub-page (`setting-tab/live-updates.ts`): `server.enabled`, `server.port`, `server.hostname`.                                                                                                                                                          |
| ~~`apps/zotero` companion~~    | —                                  | **(MVP done)** Menus (library open/update, reader open), HTTP notify (`item/update`, `reader/active`, `reader/annot-select`), prefs pane. Release pipeline still in `apps/zotero/DEFERRED.md`.                                                                                   |
| ~~`bg:notify`~~                | —                                  | **(dropped)** DB refresh is fs.watch; open/update/export flows use `obsidian://` links; live reader state uses HTTP notify.                                                                                                                                                      |
| Topic-import                   | `note-feature/topic-import/`       | Tag-driven auto-create; not yet ported (see §2.1)                                                                                                                                                                                                                                |
| Companion release              | —                                  | First user-installable XPI + `update.json` CI — see `apps/zotero/DEFERRED.md`                                                                                                                                                                                                    |


### 2.1 Topic-import (v1 reference)

A "subscribe a note to a Zotero tag" workflow: attach a `#zt-topic/<name>` tag to a note, flip the status-bar toggle, and every item subsequently **added** in Zotero auto-generates a Markdown note tagged with that topic. Lets the user collect literature under one Zotero subject and have it land in the vault automatically.

v1 lives in `app/obsidian/src/note-feature/topic-import/` (~267 lines, an `@ophidian/core` `Service` across 4 files):

- **Topic detection** (`service.tsx` + `utils.ts`) — listens to `workspace.on("file-open")` + `metadataCache.on("changed")`, runs `getAllTags(cache)`, keeps the tags prefixed `#zt-topic/`. A zustand store holds `topics: string[]` + `activeTopic`. A note may carry several topic tags.
- **Status-bar UI** (`status.tsx`) — `ImportingStatus` checkbox. No topic → "no topic", disabled; one → `#name`; many → a `Menu` to pick which topic before watching. Checking it pins `activeTopic`. **Watching locks the topic**: while `watching`, `onFileOpen` returns early so switching notes doesn't change the subscribed topic.
- **Auto-create** (`service.tsx onload` + `create-note.tsx`) — subscribes to the server's `bg:notify` event carrying `INotifyRegularItem` (`{ event: "regular-item/update", add[], modify[], trash[] }`, `lib/protocol/src/bg.ts`). On an `add` while a topic is active, `untilDbRefreshed` waits for the local DB to catch up (Zotero pushes before fs-watch refresh), then `createNote` renders each new item through the template, injecting the topic as a tag (`renderNote(extra, ctx, { tags: [currTopic] })`).

Data flow: Zotero notifier → HTTP push → server `bg:notify` → `TopicImport`. **Companion-dependent**: without the `apps/zotero` push there is no `add` signal to subscribe to, which is why it sits post-alpha.

**v2 porting note:** v1's `bg:notify` + `regular-item/update` were **dropped** in v2 (see the table row above) — DB refresh is now fs.watch and live state uses HTTP `/notify`. A v2 port must drive the auto-create leg off `LiveUpdateService` `item/update` events instead, with topic detection/UI carried over largely intact.

## 3. Annot view follow-ups

Deferred from Stage 8.

- **Annotation merging** — v1's `mergeAnnots` / `mergeTags`. Combine annotations from multiple attachments or deduplicate across updates. The Zotero-side reader annotation context-menu item ("Merge Annotations") is scaffolded but commented out in `apps/zotero/src/menus/reader-annotation.ts` (FTL `zotlit-menu-reader-annot-merge` retained); re-enable it here when the feature returns.
- ~~**Zotero-reader follow mode**~~ — **(done)** Annot view follow modes (`note` / `reader` / `linked`) in `views/annot-view/`, driven by `LiveUpdateService` reader pushes; reader-selected annotations highlight in follow mode. v1 **"Jump to note"** remains unbuildable — its block-ID index was removed as dead infra in Stage 5.

## 4. Template service follow-ups

Post-Stage 1 enhancements, not alpha-blocking.

- **Template engine extraction → `@zotlit/templates`** — **(done)** The Eta renderer
  lives in `packages/templates` (`TemplateEngine extends Eta`), Obsidian-free, with
  `buildNoteContext` moved into `@zotlit/db`. `apps/obsidian`'s `TemplateService` is
  now a thin host adapter (vault scan + watcher push + `setAutoTrim`). See §4.2 for
  the design decisions that the code alone doesn't explain. The **hosted template
  playground/preview** (an `apps/` editor over a real Zotero DB via sqlite-wasm) was
  the motivation but is **not built** — this work shipped the extraction plus a
  portability proof only (the package Vitest suite, `packages/templates/src/index.test.ts`,
  passes with **no Obsidian mock**). Playground app, sqlite-wasm wiring, and editor UI
  remain follow-up.
- **Field-name completion in `EtaSuggest`** — `it.title`, `it.citekey`, `it.creators`, `it.tags`, etc. Needs Stage 5 helper type definitions to drive the suggestion list.
- `**template-edited` event** on `TemplateService` (nanoevents) — add when a live-preview consumer (annot view) needs to re-render on template edits. Today one-shot renders rely on the vault watcher refreshing template content and the render-time mtime+size check invalidating compiled functions.
- **Async render path** (`renderAsync`) — only if a consumer ever needs `await`-able rendering; Stage 1 is sync end-to-end.

### 4.1 v1 template syntax compat layer (deferred)

A one-shot detector/transformer that keeps a user's **v1** template files rendering under the v2 engine, so upgraders aren't silently broken. v2 made several intentional, non-back-compatible template changes; none are migrated today. Deferred until there is demand from real upgraders — until then these are hard breaks documented for users, not shims.

Known v1→v2 breaks the compat layer would cover:

- **Variable prefix** — v1 `it.*` → v2 `zt.*` (`varName` changed globally).
- **Field names** — v1 raw Zotero field names → v2 CSL-inspired (`abstractNote` → `abstract`, `publicationTitle` → `containerTitle`, flat `zt.*` with no `fields` sub-object).
- **Default-template filenames** — the prefix changes from v1 `zt-*` to v2 `zotlit-*`, and the engine uses one uniform `zotlit-<name>.eta.md ↔ <name>` rule (scanner `^zotlit-([A-Za-z0-9-]+)\.eta\.md$`, no abbreviations), so every v1 filename is unrecognized: `zt-note` → `zotlit-note`, `zt-annots`/`zt-annot` → `zotlit-content`/`zotlit-annotation` (`annots`→`content` was Stage 5; `annot`→`annotation` de-abbreviates in the extraction), `zt-cite`/`zt-cite2` → `zotlit-cite`/`zotlit-cite2`. Removed entirely: `zt-field.eta.md`, `zt-colored.eta.md`.
- **`eta-prf` fork syntax** — any template relying on fork-only behavior not covered by upstream `eta@^4`.

### 4.2 Template engine extraction — design notes (done)

Rationale the shipped code doesn't surface, kept for the playground follow-up and future maintainers.

- **Name mode, not file mode.** Eta resolves a template two ways: *file mode* (set both `resolvePath` + `readFile` → resolve a path, read fs, cache by filepath) and *name mode* (the `eta/core` default → plain `templatesSync.get(name)` against templates preloaded via `define(name, source)`). The old `ObsidianEta` hand-rolled file mode (`resolveTemplatePath`, `completeTemplatePath`, `dirContainsPath`, `filepathCache`, `views`, a `render` override). Every default template only does `include("content", …)` / `include("annotation", …)` — **bare names, no relative paths** — so file mode bought nothing. Dropping it is why all that path-resolution machinery, the `node:path/posix` dependency, and the `@`-prefix special case are gone. The engine holds its own `Map<name, source>` (eta's `Cacher` stores compiled fns, not source) so `setAutoTrim` can recompile every registered template from source.
- **Freshness is push, not poll.** The old `CompileSnapshot` mtime+size polling is gone. The Obsidian watcher pushes: create/modify → `define(name, source)`; delete → re-`define` the package default if the name is canonical, else `remove(name)`; rename = drop old + define new.
- **A broken override fails loudly, never silently falls back.** `#defineTemplate` records the compile error and `remove()`s the template from the engine — it does **not** install the package default in its place. So `render(name)` throws, and a parent template that `include()`s the broken name throws too (eta can't resolve it) rather than rendering the default and hiding the breakage. The package default is used only when there is genuinely no override (`#useDefault`, called from the initial scan and the delete/rename-away path), which is a no-override condition, not error recovery. The setting-tab row shows the override path plus the compile error and states that rendering will fail until fixed.
- **tsdown-built, four entrypoints.** The package builds with tsdown (`exports: true` + `unbundle: true`, matching `@zotlit/db`'s built-dist convention) into `./dist/*.mjs`, exposing four entrypoints: `.` (the host-agnostic engine — `TemplateEngine`, `formatBlockquote`), `./constants` (the `autoTrimSchema` valibot schema and the `AutoTrim` type derived from it), `./obsidian` (the Obsidian seam — `MARKER_START`/`MARKER_END`, `formatManagedRegion`, and the opt-in `managedRegionPlugin`), and `./frontmatter` (`evalFrontmatterFields` + `FrontmatterField`). The `.eta` defaults stay raw source: `tsdown.config.ts`'s `customExports` re-adds the `./defaults/*` → `./defaults/*.eta` wildcard that auto-export generation otherwise drops, so `?raw` imports (`import note from "@zotlit/templates/defaults/note?raw"`) resolve through it unchanged.
- **`autoTrimSchema` is the single source of truth for `AutoTrim`.** The valibot union lives on `./constants`; `AutoTrim` is `v.InferOutput<typeof autoTrimSchema>`, and the obsidian settings schema reuses `autoTrimSchema` directly for `template.auto-trim-{leading,trailing}` instead of redeclaring the literal union. `valibot` therefore joins `eta` as a runtime dep (already a dep of `@zotlit/db` and the obsidian app). The engine entrypoint imports only the `AutoTrim` **type** from `./constants`, so that import is erased at build and importing `.` pulls no valibot at runtime; valibot loads only for value-level consumers of `./constants` (the settings schema).
- **Managed-region wrap is an opt-in plugin, not baked into the engine.** The engine bakes in only the generic `includeDataPlugin` (eta-4 spreads `include()` data into the parent object; v1 templates pass arrays through `include()`, so it restores direct passthrough) — host-agnostic. The Obsidian-specific `include("content")` → `formatManagedRegion(...)` wrap ships as `managedRegionPlugin` on the `./obsidian` entrypoint, alongside `MARKER_START`/`MARKER_END` + `formatManagedRegion` (`lib/constants.ts` no longer defines the markers). The obsidian app passes it via the engine's `plugins` constructor arg (`new TemplateEngine([false, false], [managedRegionPlugin])`); `TemplateEngine` prepends `includeDataPlugin`, so the wrap — which rewrites that plugin's emitted `include` arrow — runs after it. **Consequence:** a host-agnostic consumer (the playground) omits the plugin and renders `include("content")` verbatim, or loads it for exact Obsidian behaviour. Chosen over a generic `transformInclude` hook: the seam is a plain eta plugin the consumer composes, and the engine never names `content` or the markers.
- **`buildNoteContext` is portable.** Moved into `@zotlit/db` (`lib/zt-note-context.ts`). Its Obsidian-specific bits (`fileLink`, `imgEmbed`) are injected resolvers on `NoteContextInput`, so the playground supplies its own. The engine never sees DB types — only the plain `zt` object.
- **Frontmatter is a value-producing mini-engine, also extracted.** `evalFrontmatterFields` + the `FrontmatterField` type moved into `@zotlit/templates` (`src/frontmatter.ts`, exposed as the `./frontmatter` entrypoint) so the playground can preview frontmatter the same way it renders the body. It stays a bare `new Function` evaluator rather than routing through `Eta.render` because it returns typed values (numbers/arrays stay intact) instead of a stringified render. It types `zt` as plain `object` — no `NoteTemplateContext`, no generic — so the package never imports DB types. The app-side `note-feature/frontmatter.ts` remains the composition layer: it pre-filters `RESERVED_KEYS`, injects system fields (`zotero-key`/`citekey`), handles attachment scope, and owns `mergeManagedFrontmatter` (the Obsidian `processFrontMatter` update path). The single-field `evalFrontmatterField` is a private helper, not exported — the playground will want the multi-field form; re-export if a single-expr caller (e.g. live per-row preview, §5) materializes.
- **Feature-owned defaults stayed in `apps/obsidian`.** `DEFAULT_NOTE_FILENAME` + `DEFAULT_FRONTMATTER_FIELDS` relocated to `note-feature/defaults.ts` (per the template-service boundary); the `zotlit-<name>.eta.md ↔ <name>` scanner, the `zotlit-` prefix, and the `.md` extension are an Obsidian-vault convention the package knows nothing about.

## 5. Setting-tab enhancements

Deferred from Stage 6.

- **Live template preview** — render a sample item through the active template in-tab.
- **Frontmatter field preview + validation** — evaluate each `{key, expr}` against a sample item inside `FrontmatterFieldModal`; surface compile/runtime errors beyond today's key-level checks.
- **Template preview view** — standalone template preview as an `ItemView` (distinct from the in-tab preview above).
- **Item details view** — inspector-style view showing resolved item data.

## 6. Note feature follow-ups

Deferred from Stage 5.

- `**zt-attachments` frontmatter field** — read/write scoping + v1 numeric-ID migration. Lands with the attachment selection UI.

### 6.1 Alt-mode secondary citation — **(done)**

Insert a **secondary** (narrative/in-prose) citation alongside the default **primary** one: primary renders bracketed (`cite` template → `[@key]`), secondary renders bare (`cite2` template → `@key`) for "as @author shows…" prose.

Migrated from v1 (`note-feature/citation-suggest/`):

- **Render switch** — `NoteFeatures.renderCitation` (`services/note-feature/service.ts`) takes a `secondary` arg selecting `"cite2"` vs `"cite"`. Single chokepoint both insertion paths share.
- **Editor-suggest trigger** (`views/citation-suggest/editor-suggest.ts`) — a **trailing `/`** in the query (stripped before searching) sets `#secondary`, read in `selectSuggestion`. Instruction: "/ ↵".
- **Insert-modal trigger** (`views/citation-suggest/insert-modal.ts`) — **Shift+Enter** via `Keymap.isModifier(evt, "Shift")` on `onChooseSuggestion`'s evt. Instruction: "⇧↵".

The `cite2` template was already registered, shipped a default (`defaults/zt-cite2.eta.md`), is user-editable, and migrates from v1; no new settings needed.

## 7. PDF outline parser

v1 ships `getPDFOutline` / `getCachedOutlineKeys` but never calls them — no API, server, or view consumer. Don't port until the annot view (or another feature) actually consumes an outline; then it lands as its own stage.

Source: `services/pdf-parser/service.ts`.

## 8. Polish & tuning

Known issues carried from alpha.

- **Citation suggester styling** — the current citation item row in editor-suggest and quick-switcher has styling issues.
- **ItemLookup fuzzy search tuning** — MiniSearch scoring is functional but not well tuned; empirical bench/tuner work is planned (`packages/item-lookup/TODOS.md`).

## 9. Stage order (suggested)

Priority tiers rather than a strict linear sequence:


| Tier                             | Items                                                                                | Rationale                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| **A — next up**                  | Zotero note import (§1), polish (§8)                                                 | Closest to ready; import has parsers shipped, polish is incremental           |
| **B — user-facing enhancements** | Annotation merging (§3), note feature follow-ups (§6), setting-tab enhancements (§5) | Each is self-contained, can land independently                                |
| **C — template DX**              | Template service follow-ups (§4)                                                     | Nice-to-have; unblocks authoring ergonomics                                   |
| **D — companion follow-ups**     | Topic-import, protocol export/batch, companion release (§2)                          | Core server + companion + open/update protocol ship; remainder is incremental |
| **E — speculative**              | PDF outline (§7)                                                                     | No consumer exists yet                                                        |


