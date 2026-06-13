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
| `annots` | `{ annotations: TemplateAnnotation[] }` | Wrapped for consistency |
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
<%~ include("annots", { annotations: zt.annotations }) %>
```

`zt-annots.eta.md`:
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

3. **`TemplateItemData` type + `itemToTemplateData` mapper** — `packages/db/src/lib/zt-template-item.ts`. Converts `Item` → flat template object: normalizes aliases, applies the 2 CSL renames, converts creators to `{family, given, literal, role}`, parses dates via `parseItemDate`. 8 tests passing in `zt-template-item.test.ts`.

### Phase B design — DONE

4. **Full template design completed.** All decisions documented above: `varName` change, template data shapes, frontmatter system, multi-attachment behavior, template file updates, removed templates.

### Prior research (from earlier sessions)

- **v1 NoteFeatures fully mapped.** Create: item → attachments → attachment selection → notes → `HelperExtra` per attachment → template render → file write. Update: parse `metadataCache.sections` for annotation block IDs → diff against DB → CodeMirror in-place edits + `vault.append()` → frontmatter update. Citation: item → citekey → `HelperExtra` → render cite template → `editor.replaceRange()`.

- **zotero-better-notes sync reviewed.** Full-content overwrite (not incremental), MD5-based change detection, timestamp-based conflict resolution. Key takeaway: full section re-render is a viable KISS approach for annotation updates.

- **Annotation update vs note update are separate problems.** Stage 4's flat inline marks are for Zotero note import only. Obsidian-side literature note creation uses callout/template structure.

- **v1 multi-attachment flow mapped.** v1 prompts user to select one attachment, stores selection in frontmatter (`zt-attachments`) and localStorage. v2 replaces with "all attachments by default" — see multi-attachment decisions above.

### What exists in v2 already

- `NoteIndex` (Stage 2) — `{itemKey → file[]}`, `{annotKey → block[]}`, `{citekey → file[]}`.
- `ItemLookup` (Stage 3) — MiniSearch-based item search, used by editor-suggest and quick-switch.
- `NoteParser` (Stage 4) — Turndown converter for Zotero HTML → Obsidian MD. Citation rule is a passthrough awaiting Stage 5.
- `TemplateService` (Stage 1) — `render(name, data)` and `renderString(source, data)`. Feature-specific helpers deferred to Stage 5.
- Stage 3 editor-suggest `selectSuggestion` renders `template.render("cite", [{ citekey }])` — Stage 5 replaces with full `insertCitation` pipeline.
- Stage 3 quick-switch opens existing note on hit; miss → `BaseNotice`. Stage 5 wires the create-arm.

## What didn't work / what to avoid

- **Don't port v1's `HelperExtra` builder.** Proxy-heavy, attachment-centric data structure coupling template rendering to the full DB fetch pipeline. Replaced by `itemToTemplateData` + thin `TemplateAnnotation`/`TemplateAttachment` mappings.
- **Don't port v1's `toHelper()` / `withDocItemHelper()` / `withCreatorHelper()` Proxy wrappers.** The CSL-inspired normalization replaces them with a plain mapping function.
- **Don't over-fetch for citations.** The slim pipeline (`{items: TemplateItemData[]}`) is the alpha target.
- **Don't separate `zt.fields` from `zt.*`.** All fields are flat direct properties — no sub-object. Template authors should have one access pattern.
- **Don't render YAML frontmatter via Eta templates.** Users shouldn't handle YAML escaping. Use JS expression evaluation + `stringifyYaml()`.
- **Don't use `zt-colored.eta.md`.** NoteParser's `renderAnnotationMark()` handles colors with CSS variables and semantic `data-color` attributes — superior to v1's inline `<mark style>` approach.
- **Don't store numeric item IDs in frontmatter.** Use stable Zotero item keys. Read numeric IDs for backward compat, migrate to keys on first update.
- **Don't always write `zt-attachments` to frontmatter.** Missing/empty means "all attachments" — only write when explicitly scoping.

## Next steps

### Phase B: Implementation

5. **Change Eta `varName` to `"zt"`** — in `ObsidianEta` constructor (`apps/obsidian/src/services/template/eta.ts`). Update the `directIncludeDataPlugin` which references `config?.varName ?? "it"`.

6. **Update default template files** — apply the v2 template content listed above. Remove `zt-field.eta.md` and `zt-colored.eta.md`. Update `defaults.ts`: remove `field` and `colored` from `CANONICAL_NAMES`, `EMBEDDED_DEFAULTS`, imports, and `toFilename`/`fromFilename`.

7. **Add `citekey` alias to `TemplateItemData`** — ensure `citekey` is accessible alongside `citationKey` on the template item. Mirror the existing alias pattern (`publicationTitle`/`containerTitle`).

8. **Create `TemplateAnnotation` type + mapper** — thin mapping from `Annotation`, in `packages/db` or app layer depending on whether runtime fields (`imgEmbed`, `backlink`) are needed. Runtime fields added at app layer.

9. **Create `TemplateAttachment` type + mapper** — map `Attachment` to `{key, filename, contentType, linkMode}`. `fileLink` computed at app layer.

10. **Implement frontmatter expression system** — new setting for user field list, expression evaluator using `new Function`, reserved key validation, `stringifyYaml` serialization. Add `zt-attachments` backward compat (read numeric IDs, migrate to keys).

11. **Define full note template context** — `TemplateItemData` + `tags`, `annotations`, `attachments`, `backlink`, `authors`, `authorsShort`. Built at app layer in note-create flow. Fetch all attachments and their annotations (no selection modal).

12. **Update `template.filename` default** — new default without `.md`, migration rule for v1 default string.

13. **Update `editor-suggest.ts` call site** — change `render("cite", [{ citekey }])` to `render("cite", { items: [itemData] })` with full `TemplateItemData` and `citekey` alias.

14. **Update tests** — `service.test.ts` uses v1 data shapes. Update to match v2 templates and `zt.*` variable names.

### Phase C: Note create

15. **`NoteFeatures.create(item)`** — fetch item → `itemToTemplateData()` → fetch tags/attachments/annotations → build full context → render filename → evaluate frontmatter expressions → render note template → `vault.create()`. Wire into quick-switch create-arm.

### Phase D: Note update

16. **Decide update mechanism** — v1 block-ID approach may still work for callout-based annotations. Consider simpler section-marker approach (`%% annotations %%` delimiters). The zotero-better-notes finding (full re-render is viable) supports simplification.
17. **Implement update** — read `zt-attachments` from frontmatter to scope attachments. Missing/empty → all attachments. Either incremental merge or section overwrite. Include overwrite mode. Migrate v1 numeric IDs to keys.

### Phase E: Citation finishers

18. **Wire citation resolution in `parseNote`** — the DB→embedded→sentinel citekey chain. Parsers (`parseCitation`, `parseCitationData`, `parseItemUri`) already exist from Stage 4.
19. **Replace Stage 3 `selectSuggestion`** with `insertCitation` pipeline (slim: `{items: TemplateItemData[]}` → render cite template → editor replace).
20. **Add `zotlit:insert-citation` command** — popup `SuggestModal` reusing `ItemLookup` + `insertCitation`.

### Phase F: Commands & wiring

21. **Commands**: `update-note`, `overwrite-update-note`, `insert-citation`.
22. **Quick-switch create-arm**: on miss → `NoteFeatures.create(item)` → open result.

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
| Generated field aliases | `packages/zotero-types/src/fields.ts` → `FIELD_ALIASES` |
| Field alias generator | `packages/zotero-types/scripts/generate-fields.ts` |
| TemplateService | `apps/obsidian/src/services/template/service.ts` |
| Eta config + plugins | `apps/obsidian/src/services/template/eta.ts` |
| Template defaults registry | `apps/obsidian/src/services/template/defaults.ts` |
| v2 default templates | `apps/obsidian/src/services/template/defaults/zt-*.eta.md` |
| DB Annotation type | `packages/db/src/lib/zt-annot.ts` |
| DB Attachment type + path parser | `packages/db/src/lib/zt-attach.ts` |
| DB annotation queries | `packages/db/src/queries/annotations.ts` |
| DB attachment queries | `packages/db/src/queries/attachments.ts` |
| Settings schema | `apps/obsidian/src/services/settings/schema.ts` |
| NoteIndex frontmatter parsing | `apps/obsidian/src/services/note-index/parse.ts` |
| Citation editor suggest | `apps/obsidian/src/views/citation-suggest/editor-suggest.ts` |
| Zotero `itemToCSLJSON` | `/Users/aidenlx/repo/zotlit-repo/zotero/chrome/content/zotero/xpcom/utilities/utilities_item.js:51-239` |
| Zotero schema (CSL mappings) | `/Users/aidenlx/repo/zotlit-repo/zotero/resource/schema/global/schema.json` → `csl` key |
