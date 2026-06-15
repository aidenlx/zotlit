# Stage 5 — NoteFeatures + Citation Finishers: Handoff

## Goal

Design and implement Stage 5 of the ZotLit v2 migration: **NoteFeatures (create + update) + citation finishers**. This is the largest remaining alpha-blocking stage. See `MIGRATION.md` §4 Stage 5 for the full description.

## Key architectural decisions (settled)

### Template vocabulary: `zt.*` prefix, CSL-JSON-inspired

v2 templates offer the same feature set as v1 but with a new vocabulary using the `zt.*` prefix (`zt.title`, `zt.containerTitle`, `zt.citationKey`, `zt.creators`). Running v1 templates directly in v2 requires a compat layer that is deferred to post-alpha.

- `zt.*` prefix (not v1's `it.*`) to clearly distinguish the new contract.
- **Eta `varName` changed from `"it"` to `"zt"` globally.** All templates use `zt.*` as the data root. The `directIncludeDataPlugin` in `eta.ts` references `config?.varName`, which picks this up.
- CSL-JSON is inspiration, not a 1-to-1 mirror — annotations, attachments, collections etc. have no CSL-JSON counterpart and use Zotero-native names.
- camelCase throughout so templates write `zt.containerTitle`, not `zt["container-title"]`.
- Eliminates v1's `toHelper()` Proxy layer and the `HelperExtra` builder complexity.

### Creator shape: flat array with `{family, given, literal, role}`

Research: Zotero's `itemToCSLJSON` and BBT both use role-keyed arrays (`author: [{family, given}]`, `editor: [...]`). For templates, role-keyed arrays are hostile — template authors would need to know all possible CSL role keys.

Decision: flat `creators` array. Each entry has `family`/`given` (two-field mode) or `literal` (institutional/single-name, Zotero `fieldMode=1`). `role` uses Zotero's creator type names (`"author"`, `"editor"`, `"bookAuthor"`, etc.) — familiar camelCase, not CSL's hyphenated roles.

### Field naming: Zotero canonical with 2 CSL renames

Only two fields renamed from Zotero canonical:
- `abstractNote` → `abstract`
- `publicationTitle` → `containerTitle`

All other fields keep their Zotero canonical name (`DOI`, `volume`, `pages`, `publisher`, etc.). Item-type-specific aliases (`blogTitle`, `studio`, `label`, etc.) are normalized to their canonical form via `FIELD_ALIASES` (generated from the Zotero schema). Both the canonical and renamed names are accessible as direct properties on `zt.*` (e.g., both `zt.publicationTitle` and `zt.containerTitle` work). All fields are flat on `zt.*` — no separate `fields` sub-object.

### No new DB query needed

The existing `getItemsByKey`/`getItemsByID` queries fetch everything the template mapper needs. `itemToTemplateData` is a thin post-processing layer on the existing `Item` type. Tags, attachments, and annotations are separate queries used only when building the full template context (note-create), not for citations.

### Citation pipeline is slim for alpha

v1's `insertCitation` fetched attachments, notes, tags, and built a full `HelperExtra` just to render `[@citekey]`. v2 passes `{items: TemplateItemData[]}` to the cite template; no heavy fetches.

### Frontmatter: JS expression evaluation, not template rendering

v1 rendered YAML frontmatter via an Eta template (`zt-field.eta.md`), which forced users to handle YAML formatting and escaping manually. v2 replaces this with a structured system:

- **System-managed fields** (hardcoded in code, never exposed in user settings):
  - `zotero-key` — from `zt.indexedKey`
  - `citekey` — from `zt.citationKey`
- **Conditionally written field**:
  - `zt-attachments` — array of attachment keys. Only written when explicitly scoping to specific attachments. Missing or empty array → all attachments. Backward compat: reads v1 numeric item IDs, migrates to keys on first update.
- **User-configurable fields**: list of `{key, expr}` pairs in settings. Each `expr` is a JS expression evaluated via `new Function("zt", "return " + expr)` with the template data in scope. Returns actual JS values (strings, arrays, numbers, null). Serialized to YAML via Obsidian's `stringifyYaml()`.
- **Reserved key validation**: user field expressions using `zotero-key`, `citekey`, or `zt-attachments` as the key are rejected at config save time.
- **Default user fields**: `[{ key: "title", expr: "zt.title" }]`.

### Template data shapes

**Top-level template context consistency**: `zt` is always an object at the top level — no template receives a raw array as `zt`.

| Template | `zt` shape | Notes |
|----------|-----------|-------|
| `note` | `NoteTemplateContext` (see below) | `fileLink` NOT top-level — per-attachment only |
| `content` (was `annots`) | full `NoteTemplateContext` (same `zt` as `note`) | Renders the `%%zt-managed%%` region; default body = annotation loop, but full context lets users move `zt.backlink`/etc. into the refreshable region. Markers code-injected, not in the file. |
| `annotation` | `TemplateAnnotation` | Single annotation, carries `parentItem` and `parentAttachment` |
| `cite` / `cite2` | `{ items: TemplateItemData[] }` | Each item is full `TemplateItemData` with `citekey` alias |

**`NoteTemplateContext`** (the `zt` object for the note template — `TemplateItemData` extended with runtime fields):
```ts
type NoteTemplateContext = TemplateItemData & {
  // Runtime-computed at app layer
  backlink: string;                      // Zotero deep link to the literature item
  annotations: TemplateAnnotation[];     // flat list from all (or scoped) attachments
  attachments: TemplateAttachment[];     // all attachments for this item
  tags: string[];                        // flat tag names
  authors: TemplateCreator[];            // convenience: creators filtered to primaryCreatorType
  authorsShort: string;                  // formatted short author string (e.g. "Smith et al.")
}
```

**`TemplateItemData`** (existing in `packages/db/src/lib/zt-template-item.ts`):
- All Zotero fields as flat properties. `citationKey` is canonical; `citekey` supported as alias.
- `creators: TemplateCreator[]`, `key`, `indexedKey`, `itemType`, `dateModified`, etc.

**`TemplateAnnotation`** (new, thin mapping from DB `Annotation`):
```ts
interface TemplateAnnotation {
  // Passed through from DB Annotation
  key: string;
  libraryID: number;
  type: string;               // "highlight" | "note" | "image" | "ink" | "underline" | "text"
  text: string | null;
  comment: string | null;
  color: string | null;       // hex color, e.g. "#ffd400"
  pageLabel: string | null;
  authorName: string | null;
  isExternal: boolean;
  dateAdded: Temporal.Instant;
  dateModified: Temporal.Instant;

  // Runtime-computed at app layer
  imgEmbed: string;           // image excerpt embed string, e.g. "![[image.png]]"; empty if not image annotation
  backlink: string;           // Zotero deep link to this annotation, e.g. "zotero://open/...?annotation=KEY"

  // Parent references (same object shared across annotations from the same item/attachment)
  parentItem: TemplateItemData;
  parentAttachment: TemplateAttachment;
}
```
Drops internal-only fields from DB `Annotation`: `itemID`, `parentItemID`, `parentKey` (redundant with `parentAttachment.key`), `sortIndex`, `position`.

**`TemplateAttachment`** (new):
```ts
interface TemplateAttachment {
  key: string;
  filename: string | null;   // resolved from parseAttachmentPath
  contentType: string | null; // MIME type
  linkMode: string;           // "imported_file", "linked_file", etc.
  fileLink: string;           // resolved vault-relative link, computed at app layer
}
```

**`TemplateCreator`** (existing):
```ts
interface TemplateCreator {
  family: string;
  given: string;
  literal: string | null;
  role: string;
}
```

### Multi-attachment behavior

Zotero hierarchy: Literature Item → Attachment Item (PDF/EPUB/etc.) → Annotation Item.

- **All attachments included by default** — no attachment selection UI for alpha.
- `zt.annotations` is a flat list across all attachments. Each annotation carries `parentAttachment` so templates can group/filter by source.
- `zt.attachments` exposed as top-level `TemplateAttachment[]` on the note context.
- **`zt-attachments` frontmatter scoping**: missing or empty → all attachments at update time (including newly added ones). Present with keys → scoped to those specific attachments.
- **Backward compat**: `zt-attachments` values that are numeric strings (v1 item IDs) are resolved to attachments by ID, then migrated to string keys on first update.
- **Attachment selection UI deferred to post-alpha.**

### Template changes from v1

**Removed:**
- `zt-field.eta.md` — replaced by JS expression frontmatter config (see above).
- `zt-colored.eta.md` — dead code in v2. Its v1 job (coloring text during Zotero note import) is now handled by `renderAnnotationMark()` in NoteParser with CSS variables, `data-color` attributes, and `<mark>`/`<u>` tags.

**Kept (updated to v2 `zt.*` syntax):**

`zt-note.eta.md`:
```
# <%= zt.title %>

[Zotero](<%= zt.backlink %>) <%= zt.attachments.map(a => a.fileLink).filter(Boolean).join(" ") %>

<%~ include("content", zt) %>
```
The H1 + backlink/attachments line stay **outside** the managed region (static; refreshed only by `overwrite-note`). `include("content", zt)` passes the **full** `NoteTemplateContext` (not `{ annotations }`) and its output is auto-wrapped with `%%zt-managed%%` markers by the `eta.ts` include rewrite — the marker text is **not** in this file.

`zt-content.eta.md` (renamed from `zt-annots.eta.md`; default body = annotation loop only, full context so a user can drop `zt.backlink`/`zt.attachments`/etc. into the refreshable region; **no marker text in the file**):
```
<% for (const annotation of zt.annotations) { %>
<%~ include("annotation", annotation) %>
<% } %>
```

`zt-annot.eta.md`:
```
> [!note] Page <%= zt.pageLabel %>
> 
> <%= zt.imgEmbed %><%= zt.text %>
<% if (zt.comment) { %>

---

<%= zt.comment %>
<% } %>
```

`zt-cite.eta.md`:
```
[<%= zt.items.filter(c => c.citationKey).map(c => `@${c.citationKey}`).join("; ") %>]
```

`zt-cite2.eta.md`:
```
<%= zt.items.filter(c => c.citationKey).map(c => `@${c.citationKey}`).join("; ") %>
```

### Settings changes

- `template.filename` default updated: `<%= zt.citationKey ?? zt.DOI ?? zt.title ?? zt.key %>` (no `.md` extension — code appends it).
- Migration rule: replace exact v1 default string with v2 default.
- New setting for user frontmatter fields (list of `{key, expr}` pairs).

## Current progress

### Phase A — DONE

1. **Research** — Studied Zotero's `itemToCSLJSON` (field mappings, role-keyed creator arrays, date-parts), BBT's CSL export (wraps Zotero, adds `citation-key`), v1 template helpers (Proxy-heavy, DB-column vocabulary). All design decisions settled.

2. **`FIELD_ALIASES` generated** — Extended `packages/zotero-types/scripts/generate-fields.ts` to read the `baseField` property from the Zotero schema JSON and emit a `FIELD_ALIASES: Record<string, string>` map (58 entries: `blogTitle→publicationTitle`, `studio→publisher`, etc.). Regenerated `packages/zotero-types/src/fields.ts`.

3. **`TemplateItemData` type + `itemToTemplateData` mapper** — `packages/db/src/lib/zt-template-item.ts`. Converts `Item` → flat template object: normalizes aliases via `FIELD_ALIASES`, exposes the CSL aliases (`abstract`, `containerTitle`, `citekey`) as explicit typed properties reading their canonical source field, converts creators to `{family, given, literal, role}`, parses dates via `parseItemDate`. 9 tests passing in `zt-template-item.test.ts`.

### Phase B design — DONE

4. **Full template design completed.** All decisions documented above: `varName` change, template data shapes, frontmatter system, multi-attachment behavior, template file updates, removed templates.

### Phase B implementation — DONE (steps 5–9, 12–14)

Scope decision: implemented the core + db-layer mappers. The frontmatter expression system (step 10) and the full `NoteTemplateContext` builder (step 11) are **deferred to Phase C**, where their only caller (note-create) exists.

5. **Eta `varName` → `"zt"`** — set in the `ObsidianEta` constructor config (`eta.ts`); `directIncludeDataPlugin` picks it up via `config.varName`. Also updated the `EtaSuggest` autocomplete insert text to `"= zt. "` (`editor/suggest.ts`).
6. **Template files updated to v2 `zt.*` syntax** — `zt-note`, `zt-content` (renamed from `zt-annots`), `zt-annot`, `zt-cite`, `zt-cite2` now match the design above. Deleted `zt-field.eta.md` and `zt-colored.eta.md`; pruned `field`/`colored` from `CANONICAL_NAMES` and `EMBEDDED_DEFAULTS` in `defaults.ts` (`toFilename`/`fromFilename` need no change — they key off the set).
7. **`citekey` alias** — added to `TemplateItemData` (`zt-template-item.ts`) as an explicit typed property reading `allFields.citationKey`; mirrors the `containerTitle`/`abstract` pattern. Both `citationKey` and `citekey` resolve. The three CSL aliases (`abstract`, `containerTitle`, `citekey`) are each a typed property reading its canonical source field directly — the canonical names stay accessible through the `...allFields` spread, so both names work without an intermediate rename map.
8–9. **`TemplateAnnotation` + `TemplateAttachment` types and db-layer mappers** — new files `packages/db/src/lib/zt-template-annot.ts` and `zt-template-attach.ts`, exported from `packages/db/src/index.ts`. Mappers (`annotationToTemplateData`, `attachmentToTemplateData`) return the pass-through subset; runtime fields (`imgEmbed`, `backlink`, `fileLink`, `parentItem`, `parentAttachment`) are `Omit`ted and filled at the app layer in Phase C. `attachmentToTemplateData` derives `filename` from `parseAttachmentPath` and resolves `linkMode` via `LINK_MODE` (`"unknown"` fallback).
12. **`template.filename` default** — now `<%= zt.citationKey ?? zt.DOI ?? zt.title ?? zt.key %>` (no `.md`) in `schema.ts`. Migration (`migrate.ts`): the exact v1 default string (`V1_DEFAULT_FILENAME`) is dropped so the v2 default applies; customized values carry over untouched.
13. **`editor-suggest.ts` cite call** — changed `render("cite", [{ citekey }])` to `render("cite", { items: [{ citationKey }] })` to match the v2 `{ items }` context and the template's `c.citationKey` filter. **Note:** this is the minimal shape fix; building a full `TemplateItemData` (with a DB fetch) is the Phase E `insertCitation` pipeline (step 19), not done here.
14. **Tests** — `service.test.ts` migrated to `zt.*` and the new `{ annotations }` / `{ attachments }` shapes; added a `citekey`-alias test (`zt-template-item.test.ts`) and a new `zt-template-attach.test.ts` (filename/linkMode derivation). Existing `migrate.test.ts` "drops values equal to legacy defaults" now also exercises the v1→v2 filename fallthrough. All pass; typecheck + oxlint + oxfmt clean.

### Prior research (from earlier sessions)

- **v1 NoteFeatures fully mapped.** Create: item → attachments → attachment selection → notes → `HelperExtra` per attachment → template render → file write. Update: parse `metadataCache.sections` for annotation block IDs → diff against DB → CodeMirror in-place edits + `vault.append()` → frontmatter update. Citation: item → citekey → `HelperExtra` → render cite template → `editor.replaceRange()`.

- **zotero-better-notes sync reviewed.** Full-content overwrite (not incremental), MD5-based change detection, timestamp-based conflict resolution. Key takeaway: full section re-render is a viable KISS approach for annotation updates.

- **Annotation update vs note update are separate problems.** Stage 4's flat inline marks are for Zotero note import only. Obsidian-side literature note creation uses callout/template structure.

- **v1 multi-attachment flow mapped.** v1 prompts user to select one attachment, stores selection in frontmatter (`zt-attachments`) and localStorage. v2 replaces with "all attachments by default" — see multi-attachment decisions above.

### What exists in v2 already

- `NoteIndex` (Stage 2) — `{itemKey → file[]}`, `{citekey → file[]}` only. The dead `{annotKey → block[]}` map + per-annotation block-ID parsing were removed in Phase D; `getBlocksFor`, `BlockInfo`, annot-block regexes, `formatItemKey`, and block test cases are gone. `itemKey`/`citekey` contributions and `ITEM_KEY_GROUP_ID_PATTERN` remain.
- `ItemLookup` (Stage 3) — MiniSearch-based item search, used by editor-suggest and quick-switch.
- `NoteParser` (Stage 4) — Turndown converter for Zotero HTML → Obsidian MD. Citation rule is a passthrough awaiting Stage 5.
- `TemplateService` (Stage 1) — `render(name, data)` and `renderString(source, data)`. Feature-specific helpers deferred to Stage 5.
- Stage 3 editor-suggest `selectSuggestion` renders `template.render("cite", [{ citekey }])` — Stage 5 replaces with full `insertCitation` pipeline.
- Stage 3 quick-switch opens existing note on hit; miss → `BaseNotice`. Stage 5 wires the create-arm.
- **`ZoteroPrefService`** (added after Stage 5, `apps/obsidian/src/services/zotero-pref/`) — reads Zotero's `prefs.js` once on init (and re-reads on setting change) into a `fullName → value` map; exposes `get(name)` and typed `baseAttachmentPath` / `dataDir` getters **synchronously**, plus `state`/`resolvedProfileDir`/`on("changed")`. Setting `zotero.profile-dir` (nullable string; `null` ⇒ auto-detect the default profile via `profiles.ini`). Like `DatabaseService`, `ready` always resolves — read failures leave it `degraded` with an empty map. Registered in `services/build.ts` as `zoteroPref` (now **before** `db`). `zoteroPref.baseAttachmentPath` is the prefix `parseAttachmentPath` (`zt-attach.ts`) omits for `LinkedBasePath { relative }` attachments (mirrors `Zotero.Attachments.resolveRelativePath`); `zoteroPref.dataDir` is the resolved Zotero data directory (see follow-on below).

## Follow-on (post-Stage-5): profile-based DB path resolution — DONE

Discovery: Zotero stores its data directory in the **profile's `prefs.js`** (`extensions.zotero.useDataDir` + `extensions.zotero.dataDir`), defaulting to `~/Zotero`; `zotero.sqlite` is always `<dataDir>/zotero.sqlite`. So the manual data-dir setting was redundant — Zotero already knows the path.

**Decisions (user-confirmed):** (a) **remove** `zotero.data-dir` entirely (not keep as override); (b) **simple** auto-detect — `useDataDir && dataDir ? dataDir : ~/Zotero` (no legacy in-profile / mtime tie-break). Faithful to Zotero `dataDirectory.js:40-46,83-84`.

**Implemented (this session):**
- `ZoteroPrefService.dataDir` getter — resolves the data dir from prefs (`useDataDir`/`dataDir`), default `~/Zotero`; empty map (loading/degraded) ⇒ default. `@see`-pinned to zotero@9.0.3.
- `DatabaseService` now **depends on `ZoteroPrefService`** (`{ settings, zoteroPref }`): computes `join(zoteroPref.dataDir, "zotero.sqlite")`, awaits `zoteroPref.ready` on load, refreshes on the pref `"changed"` event. Auto-refresh still from settings. `build.ts` registers `zoteroPref` before `db`.
- **`zotero.data-dir` removed** from `settings/schema.ts` (key, default, `resolveZoteroDataDir`), the v0 migration map (`migrate.ts`), and `note-feature/service.ts` (now reads `zoteroPref.dataDir`).
- Settings-tab `database.ts`: the data-dir row (browse/reset) is gone; its DB status line + refresh button moved into a read-only **"Zotero database"** row showing the resolved sqlite path (updates on pref `"changed"`). Profile-dir row is the user knob. Messages renamed `settings_db_data_dir_*` → `settings_db_file_*`; profile-dir desc notes it determines the DB location.
- **profiles.ini parsing rewritten onto `@std/ini`** (`jsr:@std/ini@0.225.2`, app-local dep in `apps/obsidian/package.json`). `prefs-file.ts` now exports: `parseZoteroProfiles(content)` — enumerates **all** `[ProfileN]` sections (`{name, path, isRelative, isDefault}`) in file order, skipping `[General]`; `selectDefaultProfile(profiles)` — `Default=1` wins, else last profile; `resolveProfileDir(root, profile)` — absolute dir. Replaced the hand-rolled `parseProfilesIni`/`ProfileEntry`. Verified against the real two-profile `~/Library/Application Support/Zotero/profiles.ini`.

**Verified:** `pnpm lint` (0 errors, tsgo typechecks whole tree), `pnpm format:fix` clean, 260 obsidian tests pass (rewrote `database/service.test.ts` with a `FakeZoteroPref` double; new `parseZoteroProfiles`/`selectDefaultProfile`/`resolveProfileDir` tests; settings/migrate tests swapped off the removed key).

**Profile-picker UI — DONE (follow-up session):**
- `ZoteroPrefService.listProfiles()` (async) wraps `parseZoteroProfiles` + `resolveProfileDir` into `ZoteroProfileInfo[]` (`{name, dir, isDefault}`), returning `[]` on a missing/unreadable `profiles.ini`.
- Settings-tab profile-dir row (`database.ts`) is now a **dropdown** instead of path-display + reset/browse buttons: "Auto-detect default profile" first (→ `RESET_SETTING`, stores `null`), one option per profile (value = resolved dir, "(default)" suffix on the default), then "Choose folder…" last (sentinel `"\0browse"`, opens the folder dialog via `browseForProfileDir`). A manually-browsed dir not in the list gets its own option (empty-string sentinel `PROFILE_AUTO` = auto). Description still shows the resolved `prefs.js` path + loading/degraded status.
- Messages: removed `settings_db_profile_dir_auto`/`settings_db_profile_dir_browse`/`settings_db_reset`; added `settings_db_profile_auto`/`settings_db_profile_default` (`{name}` param)/`settings_db_profile_unnamed`/`settings_db_profile_browse`.
- Verified: typecheck clean, `pnpm lint` 0 errors, `pnpm format:fix` clean, 260 obsidian tests pass.

## What didn't work / what to avoid

- **Don't port v1's `HelperExtra` builder.** Proxy-heavy, attachment-centric data structure coupling template rendering to the full DB fetch pipeline. Replaced by `itemToTemplateData` + thin `TemplateAnnotation`/`TemplateAttachment` mappings.
- **Don't port v1's `toHelper()` / `withDocItemHelper()` / `withCreatorHelper()` Proxy wrappers.** The CSL-inspired normalization replaces them with a plain mapping function.
- **Don't over-fetch for citations.** The slim pipeline (`{items: TemplateItemData[]}`) is the alpha target.
- **Don't separate `zt.fields` from `zt.*`.** All fields are flat direct properties — no sub-object. Template authors should have one access pattern.
- **Don't render YAML frontmatter via Eta templates.** Users shouldn't handle YAML escaping. Use JS expression evaluation + `stringifyYaml()`.
- **Don't use `zt-colored.eta.md`.** NoteParser's `renderAnnotationMark()` handles colors with CSS variables and semantic `data-color` attributes — superior to v1's inline `<mark style>` approach.
- **Don't store numeric item IDs in frontmatter.** Use stable Zotero item keys. Read numeric IDs for backward compat, migrate to keys on first update.
- **Don't always write `zt-attachments` to frontmatter.** Missing/empty means "all attachments" — only write when explicitly scoping.
- **Don't port v1's per-annotation block-ID diffing / `EditorState` incremental merge for update.** The overwrite model re-renders the whole `%%zt-managed%%` region wholesale via `vault.process`. Block IDs only ever served v1's diffing (gone) plus a not-in-alpha jump-to-annotation feature; emitting them now is speculative infra and clutters every callout with opaque `^…` strings.
- **Don't put `%%zt-managed%%` marker text in any `.eta.md`.** Markers are code-injected (shared constants) around the `content` render so a template author can't delete/duplicate/misplace them. The eta files stay marker-free.
- **Don't read `zt-attachments` in alpha.** Nothing writes it (no selection UI), so a reader would be parsing a key with no writer — same anti-pattern as the block IDs. Always use all attachments until the selection UI lands.
- **Don't block-replace frontmatter on update/overwrite.** Key-level merge only (managed keys overwrite, unmanaged keys like `aliases`/`tags` preserved) — even Overwrite must not nuke hand-added metadata.

## Next steps

### Phase B: Implementation — DONE except 10–11 (see "Phase B implementation" above)

Steps 5–9, 12–14 are complete. Steps 10 and 11 were deferred to Phase C because their only consumer is the note-create flow:

10. **Implement frontmatter expression system** — new setting for user field list, expression evaluator using `new Function`, reserved key validation, `stringifyYaml` serialization. Add `zt-attachments` backward compat (read numeric IDs, migrate to keys). *(Deferred → Phase C.)*

11. **Define full note template context** — `TemplateItemData` + `tags`, `annotations`, `attachments`, `backlink`, `authors`, `authorsShort`. Built at app layer in note-create flow. Fetch all attachments and their annotations (no selection modal). The base shapes (`TemplateAnnotation`/`TemplateAttachment` + db mappers) already exist from steps 8–9; this step adds the runtime fields and the `NoteTemplateContext` assembly. *(Deferred → Phase C.)*

### Phase C: Note create — DONE

15. **`NoteFeatures.create(item)`** — fetch item → `itemToTemplateData()` → fetch tags/attachments/annotations → map via `annotationToTemplateData`/`attachmentToTemplateData` and add runtime fields (`imgEmbed`, `backlink`, `fileLink`, `parentItem`, `parentAttachment`) → build full `NoteTemplateContext` (step 11) → render filename → evaluate frontmatter expressions (step 10) → render note template → `vault.create()`. Wire into quick-switch create-arm. **Steps 10 and 11 land here.** When computing `TemplateAttachment.fileLink`, resolve `linked_file` paths via `zoteroPref.baseAttachmentPath` (`LinkedBasePath`) — inject `zoteroPref` into `NoteFeatures`.

**Implemented (this session)** in `apps/obsidian/src/services/note-feature/`:
- `service.ts` — `NoteFeatures` service (DI-registered in `build.ts` as `noteFeatures`; deps: template, db, noteIndex, zoteroPref, settings, plugin, app). `create(item)` and `renderCitation(items)`.
- `context.ts` — pure `buildNoteContext()` (step 11): assembles `NoteTemplateContext` from DB rows + resolver callbacks. `parentItem`/`parentAttachment` shared by reference; `authors` filtered to `primaryCreatorType`; `authorsShort` via existing `creatorSummary` (item-lookup).
- `frontmatter.ts` — step 10: `parseFrontmatterFields` (JSON-string setting), `buildFrontmatter` (system fields `zotero-key`/`citekey` + optional `zt-attachments` + evaluated user fields via `new Function`), `findReservedKey`. Reserved keys dropped defensively.
- `backlink.ts` — `itemBacklink` (`zotero://select/...`), `annotationBacklink` (`zotero://open/...`), `groupIDFromIndexedKey`.
- `file-link.ts` — `attachmentAbsPath` + `attachmentFileLink` (`[name](file://…)`); resolves storage / linked-absolute / linked-base (via `zoteroPref.baseAttachmentPath`).
- `types.ts` — `NoteTemplateContext`, `FrontmatterField`.
- Setting `note.frontmatter-fields` added to `settings/schema.ts` as a **typed, deeply-`readonly` array** of `{key, expr}` (valibot `v.readonly()`; default `[{ key: "title", expr: "zt.title" }]`). This is the first non-primitive setting: the schema's value guard was widened from `SettingsPrimitive` to a recursive JSON `SettingsValue` (`readonly` array / index branches so `v.readonly()` values stay assignable). `data.json` already round-trips arbitrary JSON, so storage was never the limit — only the self-imposed type guard. `buildFrontmatter` drops reserved/empty keys at build time; settings-tab UI is **deferred** (edit via data.json for now).
- Wired into `quick-switch/modal.ts` create-arm (miss → `toast.promise(create)` → open).
- Tests: `backlink.test.ts`, `frontmatter.test.ts`, `file-link.test.ts`, `context.test.ts` (24 cases). Full suite 259 pass; lint + format clean.

**Known alpha limitations (noted in code):** `imgEmbed` is `""` (image-excerpt import is Stage 9); `fileLink` is a plain `file://` link (in-vault embed optimization deferred).

### Phase D: Note update — DONE

**Mechanism chosen: managed-region overwrite, not v1 block-ID diffing.** A marker-delimited region in the note body is re-rendered and overwritten wholesale on update; everything outside it is preserved. This replaces v1's per-annotation `EditorState` diff entirely (no incremental merge, no preserving hand-edits *inside* the region). Updates use `app.vault.process` (body) + `app.fileManager.processFrontMatter` (frontmatter) — **no CodeMirror editor**.

**The managed region**
- Rendered by the renamed `content` template (was `annots`); see "Template changes from v1" above for the new shapes.
- Wrapped by markers **`%%zt-managed%%` … `%%/zt-managed%%`** (Obsidian comments: invisible in reading view, not indexed in `metadataCache.sections`, so located by scanning raw file text).
- Markers are **injected by code, never written in any `.eta.md`** — shared `MARKER_START`/`MARKER_END` constants in `apps/obsidian/src/lib/constants.ts`. `note.eta.md` positions the region with `<%~ include("content", zt) %>`; the `eta.ts` include rewrite (extend `directIncludeDataPlugin.processFnString`, keyed on the canonical name `"content"`) auto-wraps that include's output. The update splice renders `content` directly and wraps with the **same** constants → create and update produce byte-identical boundaries (no diff churn).
- Markers are **unconditional** — emitted even with zero annotations — so a note created before any highlights exist stays updatable. No default placeholder text inside an empty region.

**Implemented in this session**
- `apps/obsidian/src/services/template/defaults.ts` now registers canonical `content`; `zt-annots.eta.md` was renamed to `zt-content.eta.md`. `zt-note.eta.md` includes `content` with the full `NoteTemplateContext`.
- `apps/obsidian/src/lib/constants.ts` exports `MARKER_START` and `MARKER_END`; `apps/obsidian/src/services/template/eta.ts` imports them and exports `formatManagedRegion()`. The direct-include Eta rewrite still passes include data directly and now wraps only `include("content", ...)` in the managed markers.
- `NoteFeatures.update(file, indexedKey)` resolves the DB item from `zotero-key` (`KEY` → library 1, `KEYgGROUPID` → lookup via `getLibraries()`), rebuilds the full note context, refreshes frontmatter, and replaces the first managed region with `vault.process`. Missing region leaves the body unchanged and returns `bodyUpdated: false`; duplicate regions replace the first and warn-log the count.
- `NoteFeatures.overwrite(file, indexedKey)` resolves the same context, refreshes frontmatter, and replaces the Markdown body with a fresh `note` render while preserving the existing YAML frontmatter block. No filename rename.
- `apps/obsidian/src/services/note-feature/actions.ts` registers palette commands `update-note` and `overwrite-note` with `editorCheckCallback`, gated on the active editor file having valid `zotero-key` frontmatter. `overwrite-note` uses Obsidian `ConfirmationModal` + `setWarning`; `apps/obsidian/package.json` already has `minAppVersion: 1.13.1`, so the 1.13.0 API is covered.
- `zt-main.ts` wires `addNoteFeatureActions(this, { noteFeatures })`.
- `NoteIndex` block-ID infrastructure removed: no `getBlocksFor`, no block maps, no `BlockInfo`, no annot-block regexes, no `formatItemKey` re-export, and block-only tests removed.
- Messages added in `messages/en.json` for update/overwrite command names, toasts, confirmation modal, and cancel button. Paraglide was recompiled.
- `apps/obsidian/src/services/database/service.test.ts` fake `ZoteroPrefService` now exposes `databasePath`, matching the real service getter so the full test suite works after the profile-based DB path change.

**Frontmatter merge** (`processFrontMatter`, same for both commands):
1. Build the managed record: system `zotero-key`/`citekey` + evaluated `note.frontmatter-fields`.
2. For each managed key, scalars replace the old value.
3. If both existing and fresh values are arrays, concatenate and `Set`-dedupe.
4. Unmanaged keys (`aliases`, `tags`, `cssclasses`, etc.) are preserved because only managed keys are assigned.

Implementation note: `mergeManagedFrontmatter()` is local because the needed behavior is only scalar replace + array union; it uses `@std/collections` `distinct()` for the array de-dupe.

Consequence accepted: array-valued managed fields are **union/append-only** (concat+`distinct` never removes) — a value dropped in Zotero lingers until an Overwrite. Desired for `tags`/`aliases`; documented for Zotero-sourced array fields. `zt-attachments` is **excluded** from the managed set (it is scope *input*, not output).

**Shared constants follow-up:** `FRONTMATTER_ZOTERO_KEY`, `FRONTMATTER_CITEKEY`, `FRONTMATTER_ATTACHMENTS`, `MARKER_START`, and `MARKER_END` now live in `apps/obsidian/src/lib/constants.ts`. `note-index/parse.ts`, `note-feature/frontmatter.ts`, `template/eta.ts`, and related tests import those constants and use computed values instead of hard-coded YAML field-name or marker literals. `INDEXED_KEY` now lives in `apps/obsidian/src/services/note-index/key.ts`, so parser code and note update resolution share the indexed-key regex without importing from `parse.ts`. `apps/obsidian/AGENTS.md` now documents the constants convention.

**Verified after constants follow-up:** `pnpm --filter @zotlit/obsidian typecheck`; `pnpm --filter @zotlit/obsidian exec vitest run src/services/note-index/parse.test.ts src/services/note-index/service.test.ts src/services/note-feature/frontmatter.test.ts`; `pnpm --filter @zotlit/obsidian exec vitest run src/services/template/service.test.ts`; targeted `oxfmt --check` over the touched files.

**Block IDs dropped** — complete.

**Update feedback**: plain success toasts via `toast.promise` ("Literature note updated." / "Literature note overwritten."); no add/update counts (meaningless under wholesale overwrite). Missing marker success copy is "Frontmatter updated. No managed region found."

**Deferred to post-alpha** (land together with the attachment-selection UI that *writes* the key — planned as whitelist + blacklist): `zt-attachments` scoping read, v1 numeric-ID→key migration, and v1 backward-compat. **Alpha = always all attachments** for create, update, and overwrite; the key is never read. A v1 note's stale numeric `zt-attachments` is an unmanaged key → preserved as harmless dead metadata.

**Verified after Phase D:** `pnpm --filter @zotlit/obsidian typecheck`; `pnpm --filter @zotlit/obsidian lint`; `pnpm --filter @zotlit/obsidian exec oxfmt --check .` from `apps/obsidian`; `pnpm --filter @zotlit/obsidian test` (20 files, 268 tests).

### Phase E: Citation finishers — steps 19–20 DONE; 18 deferred

18. **Wire citation resolution in `parseNote`** — the DB→embedded→sentinel citekey chain. Parsers (`parseCitation`, `parseCitationData`, `parseItemUri`) already exist from Stage 4. **DEFERRED:** `parseNote` has no consumer yet (the Zotero note-import flow is not wired in v2). Adding the `citationResolver` now would be speculative dead code. Land it with the import flow; the turndown `citation` rule (`lib/turndown/index.ts`) still passes the span through and is the injection point.
19. **Replace Stage 3 `selectSuggestion`** — DONE. Both citation paths now render through `NoteFeatures.renderCitation([{ citationKey }])` (single slim render path). `CitationSuggestDeps` swapped `template` → `noteFeatures`.
20. **Add `zotlit:insert-citation` command** — DONE. `views/citation-suggest/insert-modal.ts` (`InsertCitationModal` popup, reuses `ItemLookup`, inserts at cursor via `editor.replaceSelection`); registered in `citation-suggest/register.ts` with `editorCallback`. New message `command_insert_citation_name`.

### Phase F: Commands & wiring

21. **Commands**: DONE. `update-note` + `overwrite-note` are palette-only, `editorCheckCallback`-gated on the active Markdown editor file having `zotero-key`; see Phase D for behavior. `insert-citation` already DONE (Phase E, step 20). Editor/file context-menu entries deferred post-alpha (palette only).
22. **Quick-switch create-arm**: DONE in Phase C (miss → `toast.promise(create)` → open).

## Key references

| What | Where |
|------|-------|
| Migration plan | `MIGRATION.md` §4-5 |
| Stage 3 spec | `STAGE3_CITATION_SUGGEST.md`, `STAGE_3_1_SEARCH.md` |
| v1 NoteFeatures | `/Users/aidenlx/repo/zotlit-repo/zotlit-v1/app/obsidian/src/note-feature/` |
| v1 template helpers | `.../services/template/helper/{item,creator,annot}.ts` |
| v1 update logic | `.../note-feature/update-note.ts` |
| v1 citation suggest | `.../note-feature/citation-suggest/basic.ts` |
| v1 default templates | `.../services/template/defaults/zt-*.ejs` |
| v1 attachment selection | `.../components/atch-suggest.ts` (`cacheAttachmentSelect`, `chooseAnnotAtch`) |
| v1 attachment persistence | `.../services/note-index/utils.ts` (`getAtchIDsOf`), `.../services/template/frontmatter.ts` |
| Stage 4 NoteParser | `apps/obsidian/src/services/note-parser/index.ts` |
| Stage 4 mark parsers | `packages/db/src/lib/zt-note-mark.ts`, `zt-color.ts` |
| Stage 4 colored mark rendering | `apps/obsidian/src/services/note-parser/index.ts` → `renderAnnotationMark()` |
| Template item type + mapper | `packages/db/src/lib/zt-template-item.ts` (tests: `zt-template-item.test.ts`) |
| Template annotation type + mapper | `packages/db/src/lib/zt-template-annot.ts` |
| Template attachment type + mapper | `packages/db/src/lib/zt-template-attach.ts` (tests: `zt-template-attach.test.ts`) |
| Generated field aliases | `packages/zotero-types/src/fields.ts` → `FIELD_ALIASES` |
| Field alias generator | `packages/zotero-types/scripts/generate-fields.ts` |
| TemplateService | `apps/obsidian/src/services/template/service.ts` |
| Eta config + plugins | `apps/obsidian/src/services/template/eta.ts` |
| Template defaults registry | `apps/obsidian/src/services/template/defaults.ts` |
| v2 default templates | `apps/obsidian/src/services/template/defaults/zt-*.eta.md` |
| DB Annotation type | `packages/db/src/lib/zt-annot.ts` |
| DB Attachment type + path parser | `packages/db/src/lib/zt-attach.ts` |
| Zotero pref service (prefs.js reader, sync `baseAttachmentPath`) | `apps/obsidian/src/services/zotero-pref/service.ts` |
| prefs.js / profiles.ini parsers (`@std/ini`; `parseZoteroProfiles`/`selectDefaultProfile`/`resolveProfileDir`) | `apps/obsidian/src/services/zotero-pref/prefs-file.ts` (tests: `prefs-file.test.ts`) |
| Zotero profile enumeration (source) | `/Users/aidenlx/repo/zotlit-repo/zotero/chrome/content/zotero/xpcom/profile.js:45-70`; data dir resolution `.../dataDirectory.js:40-46,83-84` |
| DB annotation queries | `packages/db/src/queries/annotations.ts` |
| DB attachment queries | `packages/db/src/queries/attachments.ts` |
| Settings schema | `apps/obsidian/src/services/settings/schema.ts` |
| NoteIndex frontmatter parsing | `apps/obsidian/src/services/note-index/parse.ts` |
| Citation editor suggest | `apps/obsidian/src/views/citation-suggest/editor-suggest.ts` |
| Zotero `itemToCSLJSON` | `/Users/aidenlx/repo/zotlit-repo/zotero/chrome/content/zotero/xpcom/utilities/utilities_item.js:51-239` |
| Zotero schema (CSL mappings) | `/Users/aidenlx/repo/zotlit-repo/zotero/resource/schema/global/schema.json` → `csl` key |
