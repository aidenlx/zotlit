# Frontmatter

v2 replaces v1's template-based frontmatter rendering with a structured **JS expression** system. Instead of writing YAML inside an Eta template, you configure frontmatter fields in settings. Each field has a key, an expression, and a merge strategy. The expression is evaluated against the template data and serialized to YAML automatically.

## System-managed fields

These fields are always written by ZotLit and cannot be overridden by user configuration:

| Field | Source | Description |
|-------|--------|-------------|
| `zotero-key` | `zt.indexedKey` | The indexed item key (e.g. `"ABC12345"` or `"ABC12345g12345"` for group libraries) |
| `citekey` | `zt.citationKey` | The citation key. Only written when the item has a citation key. |
| `zt-attachments` | attachment scope | Attachment keys for attachment-scoped updates. Missing or empty means all attachments. |

## User-configurable fields

User fields are configured in Settings > Templates > Frontmatter.

- **Key**: The YAML property name to write.
- **Expression**: A JavaScript expression that produces the value.
- **Merge strategy**: How ZotLit handles that property when refreshing an existing note.

Each `expr` is a JavaScript expression evaluated with the full note context available as `zt`. All item fields and properties like `authors`, `authorsShort`, `backlink`, `annotations`, `attachments`, and `collections` are accessible:

```
zt.title                                         -> "My Paper Title"
zt.authors.map(c => c.fullName)                   -> ["Jane Smith", "Bob Jones"]
zt.DOI                                           -> "10.1234/example"
zt.tags.map(t => t.tag.name)                     -> ["methodology", "review"]
zt.collections.map(c => c.name)                   -> ["Reading", "Research"]
zt.date?.year                                    -> 2023
```

Any valid JavaScript expression works. The return value is serialized to YAML automatically -- strings, numbers, arrays, objects, and `null` all work.

### Default user fields

Out of the box, ZotLit configures these user fields:

| Key | Expression | Merge strategy |
|-----|------------|----------------|
| `title` | `zt.title` | Replace |
| `related` | `zt.relatedItems.map((item) => item.noteLink()).filter(Boolean)` | Replace |
| `collections` | `zt.collections.map((c) => c.name)` | Replace |

The default `related` field mirrors Zotero's Related panel. Manage related-item links in Zotero; ZotLit refreshes this field from Zotero data.

The default `collections` field lists the names of the Zotero collections the item belongs to. Manage collection membership in Zotero; ZotLit refreshes this field from Zotero data.

### Reserved keys

The following keys are reserved and cannot be used in user field configuration:

- `zotero-key` (system-managed)
- `citekey` (system-managed)
- `zt-attachments` (system-managed)

Attempting to use a reserved key is rejected at configuration time.

### Validation

The settings UI validates:

- **Empty key** -- rejected
- **Empty expression** -- rejected
- **Reserved key** -- rejected
- **Duplicate key** -- rejected
- **Missing merge strategy** -- rejected

Expression syntax errors are detected when you save the setting. Runtime errors (e.g. accessing a property on `null`) surface per-field at note-create time -- the failing field is skipped and reported, but remaining fields still evaluate.

## Frontmatter merge on update

When you run "Update literature note", ZotLit updates only the frontmatter keys it manages:

1. **System fields** (`zotero-key`, `citekey`, `zt-attachments`) are refreshed from ZotLit.
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

## v1 comparison

v1 rendered frontmatter through a `zt-field.eta.md` template. Users wrote raw YAML inside the template and had to handle escaping manually:

```eta
title: "<%= it.title %>"
citekey: "<%= it.citekey %>"
```

This approach had several problems:

- Users had to know YAML escaping rules (quoting strings with colons, handling multi-line values).
- Array values required manual YAML formatting.
- No validation of the output -- a template typo produced invalid YAML silently.
- The template mixed data logic with serialization concerns.

v2 separates these: expressions produce **values**, merge strategies decide how those values update existing notes, and serialization is handled automatically. Users never write YAML directly.

## `zt-attachments` field

The `zt-attachments` frontmatter key is managed by ZotLit:

- **Missing or empty** -> all attachments are included when updating.
- **Present with keys** -> scoped to those specific attachments.

Do not add this key as a custom frontmatter field. ZotLit writes or removes it as needed.
