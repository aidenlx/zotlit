# Migration Guide

This guide walks through migrating custom v1 templates to v2. If you never customized your templates (using only the defaults), no action is needed -- v2 ships with updated defaults.

## Step 1: Rename template files

v2 templates use the `.eta.md` extension and a `zotlit-` prefix. Rename your custom templates:

| v1 filename | v2 filename |
|-------------|-------------|
| `zt-note.eta.md` | `zotlit-note.eta.md` |
| `zt-annots.eta.md` | `zotlit-content.eta.md` |
| `zt-annot.eta.md` | `zotlit-annotation.eta.md` |
| `zt-cite.eta.md` | `zotlit-cite.eta.md` |
| `zt-cite2.eta.md` | `zotlit-cite2.eta.md` |

Removed templates (delete if present -- they have no v2 equivalent):

- `zt-field.eta.md` -- replaced by the settings-based [frontmatter system](frontmatter.md)
- `zt-colored.eta.md` -- handled automatically by the note parser

## Step 2: Replace `it` with `zt`

The template data variable changed from `it` to `zt`. In most cases, a search-and-replace of `it.` -> `zt.` within template tags will work:

```
it.title       ->  zt.title
it.creators    ->  zt.creators
it.backlink    ->  zt.backlink
it.comment     ->  zt.comment
```

## Step 3: Update field names

Most field names stayed the same. The changes:

| v1 property | v2 property | Notes |
|-------------|-------------|-------|
| `it.citekey` | `zt.citationKey` | `zt.citekey` also works as alias |
| `it.abstractNote` | `zt.abstract` | `zt.abstractNote` also works |
| `it.publicationTitle` | `zt.containerTitle` | `zt.publicationTitle` also works |
| `it.color` | `zt.colorHex` | Hex color string |
| -- | `zt.colorName` | New: palette name (`"yellow"`, `"red"`, etc.) |
| `it.imgExcerpt` | `zt.imgEmbed` | Renamed; now `string \| null` (auto-filter handles null) |
| `it.textExcerpt` | `zt.text` | Renamed |

All other Zotero field names (`title`, `DOI`, `url`, `volume`, `issue`, `pages`, `publisher`, etc.) are unchanged.

## Step 4: Update annotation template

The annotation template structure changed to use the `bq()` blockquote helper:

```eta
<%# v1 style (no longer works) %>
[!note] Page <%= it.pageLabel %>
<%= it.imgExcerpt %><%= it.text %>

<%# v2 style %>
<% bq(() => { %>
[!note] Page <%= zt.pageLabel %>

<%= zt.imgEmbed %><%= zt.text %>
<% if (zt.comment) { %>

<%= zt.comment %>
<% } %>
<% }) %>
```

The `bq()` helper:
- Wraps all content in a Markdown blockquote (`> ` prefix per line).
- Handles empty lines and collapsing.
- Must be used with `<% %>` execute tags, not `<%~ %>` raw tags.

## Step 5: Update the content (annots) template

The template is renamed from `annots` to `content` and now receives the full context:

```eta
<%# v1: received a raw array as `it` %>
<% for (const annotation of it) { %>

<%# v2: receives full context, access annotations via zt.annotations %>
<% for (const annotation of zt.annotations) { %>
```

Update `include` calls in the note template:

```eta
<%# v1 %>
<%~ include("annots", it.annotations) %>

<%# v2 %>
<%~ include("content", zt) %>
```

## Step 6: Update citation template shapes

v1 passed `it` as a raw array:

```eta
[<%= it.filter(lit => !!lit.citekey).map(lit => `@${lit.citekey}`).join("; ") %>]
```

v2 wraps items in an object:

```eta
[<%= zt.items.filter(c => c.citationKey).map(c => `@${c.citationKey}`).join("; ") %>]
```

- `it` (array) -> `zt.items` (array inside object)
- `lit.citekey` -> `c.citationKey` (or `c.citekey`)
- Add `.filter(c => c.citationKey)` to handle items without a citekey

## Step 7: Update attachment access

v1 selected one attachment and exposed it as `it.fileLink` (a single string).

v2 includes all attachments as an array:

```eta
<%= zt.attachments.map(a => a.fileLink).filter(Boolean).join(" ") %>
```

Each attachment object has: `key`, `filename`, `contentType`, `linkMode`, `fileLink`.

## Step 8: Update creator access

v1 exposed creators through a helper with role-keyed arrays and formatting methods.

v2 uses a flat array with explicit properties:

```eta
<%# v1 style (no longer works) %>
<%= it.authors.join(", ") %>

<%# v2: creators coerce to fullName in string contexts %>
<%= zt.authors.join(", ") %>

<%# v2: explicit fullName property %>
<%= zt.authors.map(c => c.fullName).join(", ") %>

<%# v2: filter by a specific role %>
<%= zt.creators.filter(c => c.role === "editor").join(", ") %>

<%# v2: short author string %>
<%= zt.authorsShort %>
```

Creator properties: `family`, `given`, `literal` (for institutional names), `role`, `fullName`.

Convenience properties on the note context:

- `zt.authors` -- creators filtered to the item's primary creator type
- `zt.authorsShort` -- formatted short string (e.g. `"Smith et al."`)

## Step 9: Update tag access

v1 exposed tags as formatted strings. v2 exposes them as tag objects:

```eta
<%# Tags coerce to their name in string contexts %>
<%= zt.tags.join(", ") %>

<%# Explicit access via tag.name %>
<%= zt.tags.map(t => t.tag.name).join(", ") %>

<%# Filter to manual tags only %>
<%= zt.tags.filter(t => t.type === 0).join(", ") %>
```

## Step 10: Migrate frontmatter

If you customized `zt-field.eta.md`:

1. **Delete** the template file -- it has no v2 equivalent.
2. Open Settings > Templates > Frontmatter.
3. For each field you had in the template, add a frontmatter field with a key, expression, and merge strategy:

| v1 template line | v2 setting |
|-----------------|------------|
| `title: "<%= it.title %>"` | Key: `title`, Expr: `zt.title`, Merge: Replace |
| `authors: ...` | Key: `authors`, Expr: `zt.authors.map(c => c.fullName)`, Merge: Replace |
| `year: "<%= it.date %>"` | Key: `year`, Expr: `zt.date?.year`, Merge: Replace |
| `tags: ...` | Key: `tags`, Expr: `zt.tags.map(t => t.tag.name)`, Merge: Append arrays |

You no longer need to worry about YAML escaping -- `stringifyYaml()` handles it.

Use **Replace** for fields that should follow Zotero on every update. Use **Append arrays** for array fields where manual additions should remain. Use **Keep existing** when ZotLit should fill a field once and then leave your edits alone.

## Step 11: Understand the managed region

v1 used block-ID-based annotation diffing (`^annot-ABCD1234`) for incremental updates. v2 replaces this with a wholesale managed-region overwrite.

What this means:

- **No more block IDs** in your notes. The `^annot-*` suffixes are gone.
- The `%%zt-managed%%` ... `%%/zt-managed%%` region is re-rendered entirely on update.
- Hand-edits **inside** the managed region are lost on update. Place custom content **outside** the region.
- Hand-edits **outside** the region (the H1 title, backlink line, and any content you add after the managed region) are preserved.

## Quick reference: v1 -> v2 property map

| v1 (`it.*`) | v2 (`zt.*`) | Notes |
|-------------|-------------|-------|
| `it.title` | `zt.title` | |
| `it.citekey` | `zt.citationKey` / `zt.citekey` | Canonical name changed |
| `it.abstractNote` | `zt.abstract` / `zt.abstractNote` | CSL alias |
| `it.publicationTitle` | `zt.containerTitle` / `zt.publicationTitle` | CSL alias |
| `it.DOI` | `zt.DOI` | |
| `it.backlink` | `zt.backlink` | |
| `it.fileLink` | `zt.attachments[0].fileLink` | Now per-attachment |
| `it.annotations` | `zt.annotations` | Array of annotation objects |
| `it.textExcerpt` | `zt.text` | Renamed |
| `it.imgExcerpt` | `zt.imgEmbed` | Renamed; `null` for non-image annotations |
| `it.pageLabel` | `zt.pageLabel` | |
| `it.comment` | `zt.comment` | |
| `it.color` | `zt.colorHex` | Renamed |
| `it.tags` | `zt.tags` | Now tag objects (with `tag.name`, `type`), not strings |
| `it.authors` | `zt.authors` | Now an array of creator objects, not formatted strings |
| `it.authorsShort` | `zt.authorsShort` | Same semantics |
| -- | `zt.colorName` | New: palette name |
| -- | `zt.type` | New: annotation type |
| -- | `zt.parentItem` | New: parent item data |
| -- | `zt.parentAttachment` | New: parent attachment data |
| -- | `zt.key` | New: item key |
| -- | `zt.indexedKey` | New: indexed key |
| -- | `zt.itemType` | New: Zotero item type |
| `it.date` | `zt.date` | Was year-only string; now a parsed `ItemDate` object (see [Date format](data-reference.md#date-format)). `<%= zt.date %>` renders ISO; `zt.date?.year` gets the numeric year. |
| `it.dateAdded` / `it.dateModified` | `zt.dateAdded` / `zt.dateModified` | Were raw SQL strings (`"YYYY-MM-DD HH:MM:SS"`); now `Temporal.Instant` at second precision (Zotero stores no sub-second component). Render as local date in `<%= %>` tags. Available on both items and annotations. |
| -- | `zt.primaryCreatorType` | New: primary creator role for this item type |

## Common patterns

### Conditional sections

```eta
<% if (zt.abstract) { %>
## Abstract

<%= zt.abstract %>
<% } %>
```

### Grouped annotations by color

```eta
<% const grouped = Object.groupBy(zt.annotations, a => a.colorName ?? "default"); %>
<% for (const [color, annots] of Object.entries(grouped)) { %>
## <%= color %>

<% for (const a of annots) { %>
- <%= a.text %> (p. <%= a.pageLabel %>)
<% } %>
<% } %>
```

### Annotations filtered by type

```eta
<% const highlights = zt.annotations.filter(a => a.type === "highlight"); %>
<% const notes = zt.annotations.filter(a => a.type === "note"); %>
```

### Creator formatting

```eta
<%# All authors (creators coerce to fullName in string contexts) %>
<%= zt.authors.join(", ") %>

<%# Explicit fullName access %>
<%= zt.authors.map(c => c.fullName).join(", ") %>

<%# Short form %>
<%= zt.authorsShort %>

<%# First author's last name %>
<%= zt.authors[0]?.family %>
```

### Multiple attachments

```eta
<%# List all PDFs %>
<% for (const a of zt.attachments.filter(a => a.contentType === "application/pdf")) { %>
- <%= a.fileLink %>
<% } %>
```

### Annotations with parent info

```eta
<% for (const a of zt.annotations) { %>
- [<%= a.parentAttachment.filename %>] p.<%= a.pageLabel %>: <%= a.text %>
<% } %>
```
