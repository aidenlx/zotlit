# Frontmatter

v2 replaces v1's template-based frontmatter rendering with a structured **JS expression** system. Instead of writing YAML inside an Eta template, you configure `{key, expr}` pairs in settings. Each expression is evaluated against the template data and serialized to YAML automatically.

## System-managed fields

These fields are always written by ZotLit and cannot be overridden by user configuration:

| Field | Source | Description |
|-------|--------|-------------|
| `zotero-key` | `zt.indexedKey` | The indexed item key (e.g. `"ABC12345"` or `"ABC12345g12345"` for group libraries) |
| `citekey` | `zt.citationKey` | The citation key. Only written when the item has a citation key. |

## User-configurable fields

User fields are a list of `{key, expr}` pairs configured in Settings > Templates > Frontmatter.

Each `expr` is a JavaScript expression evaluated with the full note context available as `zt`. All item fields and properties like `authors`, `authorsShort`, `backlink`, `annotations`, and `attachments` are accessible:

```
zt.title                                         -> "My Paper Title"
zt.authors.map(c => c.fullName)                   -> ["Jane Smith", "Bob Jones"]
zt.DOI                                           -> "10.1234/example"
zt.tags.map(t => t.tag.name)                     -> ["methodology", "review"]
zt.date?.year                                    -> 2023
```

Any valid JavaScript expression works. The return value is serialized to YAML automatically -- strings, numbers, arrays, objects, and `null` all work.

### Default user fields

Out of the box, ZotLit configures one user field:

| Key | Expression |
|-----|------------|
| `title` | `zt.title` |

### Reserved keys

The following keys are reserved and cannot be used in user field configuration:

- `zotero-key` (system-managed)
- `citekey` (system-managed)
- `zt-attachments` (reserved for future attachment scoping)

Attempting to use a reserved key is rejected at configuration time.

### Validation

The settings UI validates:

- **Empty key** -- rejected
- **Empty expression** -- rejected
- **Reserved key** -- rejected
- **Duplicate key** -- rejected

Expression syntax errors are detected when you save the setting. Runtime errors (e.g. accessing a property on `null`) surface per-field at note-create time -- the failing field is skipped and reported, but remaining fields still evaluate.

## Frontmatter merge on update

When you run "Update literature note", frontmatter is merged at the key level:

1. **System fields** (`zotero-key`, `citekey`) are overwritten with current values.
2. **User-configured fields** are re-evaluated and overwritten.
3. **Array values**: if both the existing and new values are arrays, they are concatenated and deduplicated (union). This means values you add manually to an array field are preserved.
4. **Unmanaged keys** (any frontmatter key not in the managed set -- e.g. `aliases`, `tags`, `cssclasses`) are **preserved**. The update never touches keys it doesn't own.

Consequence: array-valued managed fields are union/append-only. A value removed in Zotero will linger in the frontmatter until you use "Overwrite literature note". This is intentional for fields like `tags` where manual additions should survive updates.

The "Overwrite literature note" command also uses key-level merge for frontmatter -- it does **not** nuke hand-added metadata. Only the note body (outside the YAML block) is fully replaced.

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

v2 separates these: expressions produce **values**, and serialization is handled automatically. Users never write YAML directly.

## `zt-attachments` field

The `zt-attachments` frontmatter key is reserved for future attachment scoping:

- **Missing or empty** -> all attachments are included when updating.
- **Present with keys** -> scoped to those specific attachments.

For v2 alpha, nothing reads or writes this field. A v1 note with numeric `zt-attachments` values is treated as an unmanaged key and preserved as-is.
