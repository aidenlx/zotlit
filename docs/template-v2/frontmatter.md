# Frontmatter

ZotLit manages frontmatter fields on your literature notes. Each field has a key, an expression, a merge strategy, and a declared language.

## System-managed fields

These fields are always written by ZotLit and cannot be overridden by user configuration:

| Field | Source | Description |
|-------|--------|-------------|
| `zotero-key` | `zt.indexedKey` | The indexed item key (e.g. `"ABC12345"` or `"ABC12345g12345"` for group libraries) |
| `citekey` | `zt.citationKey` | The citation key. Only written when the item has a citation key. |
| `zotero-atchs` | attachment scope | Attachment keys for attachment-scoped updates. Missing or empty means all attachments. |

## User-configurable fields

Configured in Settings > Templates > Frontmatter.

- **Key**: The YAML property name to write.
- **Expression**: Produces the value (Liquid or JavaScript).
- **Language**: Which language the expression evaluates in (Liquid or JavaScript).
- **Merge strategy**: How ZotLit handles that property when refreshing an existing note.

### Liquid expressions (default)

Liquid expressions are typed value-expressions -- they return real types (arrays, numbers, strings) directly, not rendered text. They use the same filter vocabulary as templates (see [Syntax](syntax.md)).

```
zt.title                                -> "My Paper Title"
zt.authors | join: ", "                 -> "Jane Smith, Bob Jones"
zt.tags | map: "name"                   -> ["methodology", "review"]
zt.collections | collection_paths       -> ["Project/Reading", "Research"]
zt.date.year                            -> 2023
```

Note that `zt.authors | join: ", "` differs from how you'd write the same list inside a template body: a frontmatter expression evaluates to the joined string value itself, rather than interpolating that string into surrounding text.

### JavaScript expressions

JavaScript expressions require the **JavaScript Templates** gate to be enabled (see [JavaScript Templates](javascript-templates.md)). Any valid JavaScript expression works, with the full note context available as `zt`:

```
zt.authors.map(c => c.fullName)   -> ["Jane Smith", "Bob Jones"]
zt.tags.map(t => t.name)          -> ["methodology", "review"]
zt.date?.year                     -> 2023
```

The return value is serialized to YAML automatically -- strings, numbers, arrays, objects, and `null` all work.

### Gate interaction

- With JavaScript Templates **off**: JavaScript fields are inert -- they are not evaluated. Any note write that depends on inert JavaScript fields fails with a typed error naming those fields. Existing notes are not touched.
- With JavaScript Templates **on**: Both Liquid and JavaScript fields evaluate normally.
- A field's language is permanent metadata -- the gate never reinterprets an expression. A Liquid field always evaluates as Liquid regardless of the gate.

### Default user fields

Out of the box, ZotLit configures these user fields:

| Key | Expression | Language | Merge |
|-----|-----------|----------|-------|
| `title` | `zt.title` | Liquid | Replace |
| `related` | `zt.relatedItems \| note_links` | Liquid | Replace |
| `collections` | `zt.collections \| collection_paths` | Liquid | Replace |

The default `related` field mirrors Zotero's Related panel. The `note_links` filter maps each related item to its `noteLink` result, falling back to `zt-error:<indexedKey>` when a link cannot be resolved (path collision, recursive filename resolution, or template error), so the failure is visible in frontmatter rather than silently dropped. Manage related-item links in Zotero; ZotLit refreshes this field from Zotero data.

The default `collections` field lists the paths (e.g. `"Project/Reading"`) of the Zotero collections the item belongs to. Manage collection membership in Zotero; ZotLit refreshes this field from Zotero data.

### Reserved keys

The following keys are reserved and cannot be used in user field configuration:

- `zotero-key` (system-managed)
- `citekey` (system-managed)
- `zotero-atchs` (system-managed)
- `zotero-note-key`, `zotero-lastmod` (owned by [imported notes](note-import.md#imported-note-structure), not the literature note itself)

Attempting to use a reserved key is rejected at configuration time.

### Validation

The settings UI validates:

- **Empty key** -- rejected
- **Empty expression** -- rejected
- **Reserved key** -- rejected
- **Duplicate key** -- rejected

Expression syntax errors are detected when you save the setting. Runtime errors (e.g. accessing a property on `null`) surface per-field at note-create time -- the failing field is skipped and reported, but remaining fields still evaluate.

## Merge on update

When you run "Update literature note", ZotLit updates only the frontmatter keys it manages:

1. **System fields** (`zotero-key`, `citekey`, `zotero-atchs`) are refreshed from ZotLit.
2. **User-configured fields** are re-evaluated and then applied using their merge strategy.
3. **Unmanaged keys** (any frontmatter key not in the managed set -- e.g. `aliases`, `tags`, `cssclasses`) are preserved. The update never touches keys it does not own.

The "Overwrite literature note" command uses the same frontmatter behavior. It fully replaces the note body, but it still preserves frontmatter keys that ZotLit does not manage.

### Merge strategies

Each user-configured field chooses one of three merge strategies:

| Strategy | Behavior | Use it for |
|----------|----------|------------|
| Replace | ZotLit writes the newly generated value each time. Existing values for this key are replaced. | Fields that should always match Zotero or your expression, such as `title`, `year`, or `DOI`. |
| Append arrays | ZotLit keeps the existing array values and appends new generated array values. Manual additions remain. If the existing value is blank, ZotLit writes the generated value. If the existing value is not an array, ZotLit keeps the existing value. | Array fields where you may add values manually, such as `tags`, `aliases`, or custom lists. |
| Keep existing | ZotLit writes the generated value only when the field is blank. Once the field has a value, ZotLit leaves it alone. | Fields you want ZotLit to initialize, then edit by hand, such as `status`, `rating`, or a custom summary field. |

Blank values are treated like missing values for `Append arrays` and `Keep existing`. In practice, this means an absent field, `null`, an empty string, an empty array, or an empty object can be filled by ZotLit.

If an expression returns `undefined`, ZotLit leaves that field untouched for every strategy. If an expression returns `null`, ZotLit writes YAML `null` where the selected strategy allows a write.

## `zotero-atchs` field

The `zotero-atchs` frontmatter key is managed by ZotLit:

- **Missing or empty** -> all attachments are included when updating.
- **Present with keys** -> scoped to those specific attachments.

Do not add this key as a custom frontmatter field. ZotLit writes or removes it as needed.
