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

- **Field-name completion in `EtaSuggest`** — `it.title`, `it.citekey`, `it.creators`, `it.tags`, etc. Needs Stage 5 helper type definitions to drive the suggestion list.
- `**template-edited` event** on `TemplateService` (nanoevents) — add when a live-preview consumer (annot view) needs to re-render on template edits. Today one-shot renders rely on the vault watcher refreshing template content and the render-time mtime+size check invalidating compiled functions.
- **Async render path** (`renderAsync`) — only if a consumer ever needs `await`-able rendering; Stage 1 is sync end-to-end.

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


