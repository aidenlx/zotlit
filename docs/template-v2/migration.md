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
| `it.imgExcerpt` | `embed(zt.imgLink)` | `zt.imgLink` is now a [link helper](syntax.md#link-helpers) (or `null`); `embed()` adds the `!` embed prefix |
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

<%= embed(zt.imgLink) %><%= zt.text %>
<% if (zt.comment) { %>

<%= zt.comment %>
<% } %>
<% }) %>
```

The `bq()` helper:
- Wraps all content in a Markdown blockquote (`> ` prefix per line).
- Handles empty lines and collapsing.
- Must be used with `<% %>` execute tags, not `<%~ %>` raw tags.

The v1 annotation helpers all carry over (mostly just the `it` -> `zt` switch):

- `zt.page` -- 1-based PDF page number (`it.page`); use `zt.pageLabel` for the document's own page label.
- `zt.comment` -- the comment converted to Markdown. This is now the default (it was v1's `it.commentMd`); `zt.commentHtml` exposes the raw HTML Zotero stores (v1's `it.comment`). Zotero annotation comments are plain text with only `<i>` / `<b>` / `<sub>` / `<sup>` formatting and line breaks, so the Markdown is a faithful round-trip.
- `zt.imgLink()` -- a [link helper](syntax.md#link-helpers) for the excerpt image (`it.imgLink`); call it, and prefix `!` (or use `embed(zt.imgLink)`) for the embed form. With "copy image to vault" off it links the cached image's `file://` URI; with it on it links the in-vault copy. v1's `it.imgPath` (raw path) and `it.imgUrl` (`file://` URL) are **not** carried over -- use `zt.imgLink()`. It is `null` for non-image annotations.
- `zt.fileLink()` -- a [link helper](syntax.md#link-helpers) to the attachment, default-deep-linked to the annotation's page (`#page=N`), restoring v1's annotation-level `it.fileLink`. Pass `alias` / `subpath` to override the display text or anchor.

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

v2 includes all attachments as an array, and `fileLink` is now a [link helper](syntax.md#link-helpers) -- call it:

```eta
<%= zt.attachments.map(a => a.fileLink()).filter(Boolean).join(" ") %>
```

Each attachment object has: `key`, `filename`, `contentType`, `linkMode`, `filePath`, `fileLink`.

`filePath` is the absolute on-disk path (restores v1's `it.filePath`); it is `null` for URL links and unresolvable paths. `fileLink()` renders the Markdown link to that file (pass `alias` / `subpath` to override the display text or anchor); it renders `""` when unresolvable.

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

ZotLit auto-manages three reserved frontmatter keys you cannot target from a user field: `zotero-key`, `citekey`, and `zotero-atchs` (the attachment scope). `zotero-atchs` keeps v1's key name, so upgraded notes are not re-keyed. See [System-managed fields](frontmatter.md#system-managed-fields) for details.

Use **Replace** for fields that should follow Zotero on every update. Use **Append arrays** for array fields where manual additions should remain. Use **Keep existing** when ZotLit should fill a field once and then leave your edits alone.

## Step 11: Understand the managed region

v1 used block-ID-based annotation diffing (`^annot-ABCD1234`) for incremental updates. v2 replaces this with a wholesale managed-region overwrite.

What this means:

- **No more block IDs** in your notes. The `^annot-*` suffixes are gone.
- The `%%zt-managed%%` ... `%%/zt-managed%%` region is re-rendered entirely on update.
- Hand-edits **inside** the managed region are lost on update. Place custom content **outside** the region.
- Hand-edits **outside** the region (the H1 title, backlink line, and any content you add after the managed region) are preserved.

## Quick reference: v1 -> v2 property map

Grouped by the context the property lives in. `--` in the v1 column marks a
property that is new in v2.

### Item fields (note / content / frontmatter root)

| v1 (`it.*`) | v2 (`zt.*`) | Notes |
|-------------|-------------|-------|
| `it.title` | `zt.title` | |
| `it.citekey` | `zt.citationKey` / `zt.citekey` | Canonical name changed |
| `it.abstractNote` | `zt.abstract` / `zt.abstractNote` | CSL alias |
| `it.publicationTitle` | `zt.containerTitle` / `zt.publicationTitle` | CSL alias |
| `it.DOI` | `zt.DOI` | |
| `it.backlink` | `zt.backlink` | Zotero `select` deep link to the item |
| `it.tags` | `zt.tags` | Now tag objects (with `tag.name`, `type`), not strings |
| `it.collections` | `zt.collections` | Now collection objects (`key`, `name`, `path`); `path` is root->leaf; the `it.collection` singular alias is removed (see [Collections differences](#collections-it-collections-zt-collections)) |
| `it.authors` | `zt.authors` | Now an array of creator objects, not formatted strings |
| `it.authorsShort` | `zt.authorsShort` | Same semantics |
| `it.annotations` | `zt.annotations` | Array of annotation objects |
| `it.date` | `zt.date` | Was year-only string; now a parsed `ItemDate` object (see [Date format](data-reference.md#date-format)). `<%= zt.date %>` renders ISO; `zt.date?.year` gets the numeric year. |
| `it.dateAdded` / `it.dateModified` | `zt.dateAdded` / `zt.dateModified` | Were raw SQL strings (`"YYYY-MM-DD HH:MM:SS"`); now `Temporal.Instant` at second precision (Zotero stores no sub-second component). Render as local date in `<%= %>` tags. Available on both items and annotations. |
| -- | `zt.key` | New: item key |
| -- | `zt.indexedKey` | New: indexed key |
| -- | `zt.itemType` | New: Zotero item type |
| -- | `zt.primaryCreatorType` | New: primary creator role for this item type |
| -- | `zt.relatedItems` | New: Zotero "Related" panel items |
| `it.notePath` | `zt.notePath` | Same; `""` in filename templates |
| `it.noteLink` | `zt.noteLink()` | Now a [link helper](syntax.md#link-helpers) -- call it; gains `subpath` param |

### Attachment fields (`zt.attachments[]`, `zt.parentAttachment`)

| v1 (`it.*`) | v2 (`zt.*`) | Notes |
|-------------|-------------|-------|
| `it.fileLink` | `zt.attachments[0].fileLink()` | Now a per-attachment [link helper](syntax.md#link-helpers) -- call it; not a single item-level string |
| `it.filePath` | `zt.attachments[0].filePath` | Absolute on-disk path; `null` when unresolvable |
| -- | `.key` / `.filename` / `.contentType` / `.linkMode` | New: per-attachment metadata |

### Annotation fields (`zt.annotations[]`, annotation-template root)

| v1 (`it.*`) | v2 (`zt.*`) | Notes |
|-------------|-------------|-------|
| `it.textExcerpt` | `zt.text` | Renamed |
| `it.comment` | `zt.commentHtml` | Raw comment HTML (only `<i>`/`<b>`/`<sub>`/`<sup>`) |
| `it.commentMd` | `zt.comment` | Comment converted to Markdown — now the default `zt.comment` |
| `it.imgExcerpt` | `embed(zt.imgLink)` | `zt.imgLink` is a [link helper](syntax.md#link-helpers) (or `null`); `embed()` adds the `!` embed prefix |
| `it.imgLink` | `zt.imgLink()` | Excerpt-image link helper -- call it; prefix `!` for an embed |
| `it.imgPath` | _(removed)_ | No v2 equivalent -- the resolved image is in `zt.imgLink()` |
| `it.imgUrl` | _(removed)_ | No v2 equivalent -- the resolved image is in `zt.imgLink()` |
| `it.pageLabel` | `zt.pageLabel` | Document's own page label |
| `it.page` | `zt.page` | 1-based PDF page number (`pageIndex + 1`) |
| `it.color` | `zt.colorHex` | Renamed |
| `it.fileLink` | `zt.fileLink()` | Attachment [link helper](syntax.md#link-helpers) -- call it; default-deep-linked to the annotation's page (`#page=N`) |
| `it.backlink` | `zt.backlink` | Zotero `open` deep link to the annotation |
| -- | `zt.colorName` | New: palette name |
| -- | `zt.type` | New: annotation type |
| -- | `zt.parentItem` | New: parent item data |
| -- | `zt.parentAttachment` | New: parent attachment data |

### Collections (`it.collections` -> `zt.collections`)

v1 exposed each collection as `{ id, path, key, name, libraryID }` with a `path` that auto-rendered as `"A > B > C"`. v2 trims and reshapes this:

| Aspect | v1 (`it.collections`) | v2 (`zt.collections`) |
|--------|----------------------|----------------------|
| Per-collection fields | `{ id, path, key, name, libraryID }` | `{ key, name, path }` -- `id` / `libraryID` dropped |
| `path` order | leaf -> root | **root -> leaf** (`path[0]` is the top ancestor, last is the collection) |
| `path` rendering | a `CollectionPath` array subclass that auto-rendered `"A > B > C"` | a plain `readonly string[]` -- bare `c.path` no longer auto-renders; use `c.path.join(" > ")` |
| Singular alias | `it.collection` (deprecated) | removed -- use the `zt.collections` array |
| Object coercion | coerced to `name` | unchanged -- still coerces to `name` |
| Trashed collections | not special-cased | excluded; a live collection under a trashed parent truncates its path at the first live ancestor |
| Ordering | SQL/rowid order | sorted by `name` |

```eta
<%# Collections coerce to their name in string contexts %>
<%= zt.collections.join(", ") %>

<%# Render each collection's full hierarchy %>
<%= zt.collections.map(c => c.path.join(" > ")).join("; ") %>
```

## Deferred to a later release

A couple of v1 template features have no v2 equivalent yet. They are planned for a post-alpha release (Zotero note import), not removed by design:

- **Child notes (`it.notes`)** -- v1 exposed an item's attached Zotero child notes as normalized Markdown. There is no `zt.notes` in v2 yet; child-note exposure lands with the post-alpha note-import stage.
- **Imported-note path (`it.importNote` / the `zt-import` folder)** -- v1 wrote imported Zotero notes to `<literature-folder>/zt-import/<name>`. v2 reworks note import (HTML is parsed and embedded) and has no `zt-import` output path yet; this also lands with the post-alpha note-import stage.

If your v1 templates relied on these, keep the v1 versions for reference until the note-import stage ships.

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
- <%= a.fileLink() %>
<% } %>
```

### Annotations with parent info

```eta
<% for (const a of zt.annotations) { %>
- [<%= a.parentAttachment.filename %>] p.<%= a.pageLabel %>: <%= a.text %>
<% } %>
```
