# ZotLit v2 post-alpha plan

Extracted from [`MIGRATION.md`](./MIGRATION.md) after alpha (Stages 0–8) shipped.

## 1. Zotero note import (Stage 9)

The first post-alpha stage. Wires the Stage-4 `NoteParser` into a user-facing import flow with citation resolution, embedded-image resolution, and customizable output.

### 1.1 Import flow

- Add the import command/UI. Alpha-quality output is the fixed Stage-4 format: Zotero note HTML → Obsidian Markdown with inline annotation marks.
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
3. **Sentinel** — `` `${key}?` `` — truthy, survives the default `cite` template's `filter(lit => !!lit.citekey)`, renders a visible greppable `[@KEY?]`.

**Embedded map** is URI-keyed (each entry's `itemData.id` is the full library-qualified URI). Build `Map<uri, itemData>`, resolve a citation by walking its `uris` for the first hit. Sits on the same `<div>` as `data-schema-version` — `parseNoteSchema(root).container.getAttribute("data-citation-items")` reaches it. Needs a small valibot schema.

**Cross-library cites** resolve via the embedded leg only (snapshot citekey, not live BBT data).

### 1.4 Open items

- `locator` (`citationItem.locator`, e.g. `"62"`) is parsed but unconsumed — Pandoc wants `[@key, p. 62]`; render-stage decision.
- `suppress-author` (Pandoc `-@key`) is a parser gap: re-add `properties` to `CitationSchema` in `zt-note-mark.ts`.
- Cite-template vocabulary (CSL-JSON field names recommended); normalizing the DB leg to CSL needs an `itemToCSLJSON`-equivalent.

## 2. Companion-dependent features

Require `apps/zotero` companion plugin or the localhost server.

| Feature | v1 source | Notes |
| --- | --- | --- |
| Server (HTTP listener) | `services/server/service.ts` | localhost relay for Zotero ↔ Obsidian |
| Protocol handlers | `note-feature/protocol/service.ts` | `zotero://open\|update\|export` |
| Topic-import | `note-feature/topic-import/` | Tag-driven auto-create; uses `bg:notify` |
| Setting-tab `server` group | `setting-tab/` | Depends on the server service |
| `apps/zotero` companion | — | Not yet scoped; v1 protocol compatible with v2's eventual server |
| `bg:notify` evaluation | — | May be unnecessary once server + fs.watch cover all refresh/export/open flows |

## 3. Annot view follow-ups

Deferred from Stage 8.

- **Annotation merging** — v1's `mergeAnnots` / `mergeTags`. Combine annotations from multiple attachments or deduplicate across updates.
- **Zotero-reader follow mode** — v1's `zt-reader` follow + details view; the view always tracks the active literature note. "Jump to note" is unbuildable — its block-ID index was removed as dead infra in Stage 5.

## 4. Template service follow-ups

Post-Stage 1 enhancements, not alpha-blocking.

- **Field-name completion in `EtaSuggest`** — `it.title`, `it.citekey`, `it.creators`, `it.tags`, etc. Needs Stage 5 helper type definitions to drive the suggestion list.
- **`template-edited` event** on `TemplateService` (nanoevents) — add when a live-preview consumer (annot view) needs to re-render on template edits. Today one-shot renders rely on the vault watcher refreshing template content and the render-time mtime+size check invalidating compiled functions.
- **Async render path** (`renderAsync`) — only if a consumer ever needs `await`-able rendering; Stage 1 is sync end-to-end.

## 5. Setting-tab enhancements

Deferred from Stage 6.

- **Live template preview** — render a sample item through the active template in-tab.
- **Frontmatter field preview + validation** — evaluate each `{key, expr}` against a sample item inside `FrontmatterFieldModal`; surface compile/runtime errors beyond today's key-level checks.
- **Template preview view** — standalone template preview as an `ItemView` (distinct from the in-tab preview above).
- **Item details view** — inspector-style view showing resolved item data.

## 6. Note feature follow-ups

Deferred from Stage 5.

- **`zt-attachments` frontmatter field** — read/write scoping + v1 numeric-ID migration. Lands with the attachment selection UI.
- **Alt-mode secondary citation** — alternate citation insertion mode.

## 7. PDF outline parser

v1 ships `getPDFOutline` / `getCachedOutlineKeys` but never calls them — no API, server, or view consumer. Don't port until the annot view (or another feature) actually consumes an outline; then it lands as its own stage.

Source: `services/pdf-parser/service.ts`.

## 8. Polish & tuning

Known issues carried from alpha.

- **Citation suggester styling** — the current citation item row in editor-suggest and quick-switcher has styling issues.
- **ItemLookup fuzzy search tuning** — MiniSearch scoring is functional but not well tuned; empirical bench/tuner work is planned (`packages/item-lookup/TODOS.md`).

## 9. Stage order (suggested)

Priority tiers rather than a strict linear sequence:

| Tier | Items | Rationale |
| --- | --- | --- |
| **A — next up** | Zotero note import (§1), polish (§8) | Closest to ready; import has parsers shipped, polish is incremental |
| **B — user-facing enhancements** | Annot view follow-ups (§3), note feature follow-ups (§6), setting-tab enhancements (§5) | Each is self-contained, can land independently |
| **C — template DX** | Template service follow-ups (§4) | Nice-to-have; unblocks authoring ergonomics |
| **D — companion** | Server, protocol, topic-import, companion plugin (§2) | Blocked on `apps/zotero` scoping |
| **E — speculative** | PDF outline (§7) | No consumer exists yet |
