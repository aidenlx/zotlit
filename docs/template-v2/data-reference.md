# Data Reference

This page documents every property available on the `zt` variable for each template type. All properties are accessed as `zt.propertyName`.

## Note template (`zotlit-note.eta.md`)

The note template has access to all item fields on the `zt` variable.

### Item fields

All Zotero item fields are available as flat properties on `zt`. The canonical Zotero field name is the primary accessor. Two fields have CSL-inspired renames:

| v2 property | Zotero canonical | Notes |
|-------------|-----------------|-------|
| `zt.abstract` | `abstractNote` | Alias -- both `zt.abstract` and `zt.abstractNote` work |
| `zt.containerTitle` | `publicationTitle` | Alias -- both names work |
| `zt.citekey` | `citationKey` | Alias -- both `zt.citekey` and `zt.citationKey` work |

Common fields:

| Property | Type | Description | Availability |
|----------|------|-------------|--------------|
| `zt.key` | `string` | Zotero item key (e.g. `"ABC12345"`) | all templates |
| `zt.libraryID` | `number` | Library ID | all templates |
| `zt.indexedKey` | `string` | Indexed key -- `KEY` for user library, `KEYgGROUPID` for groups | all templates |
| `zt.itemType` | `string` | Zotero item type (e.g. `"journalArticle"`, `"book"`) | all templates |
| `zt.title` | `string \| null` | Item title | all templates |
| `zt.citationKey` | `string \| null` | Citation key (BBT or native) | all templates |
| `zt.citekey` | `string \| null` | Alias for `citationKey` | all templates |
| `zt.abstract` | `string \| null` | Abstract text | all templates |
| `zt.containerTitle` | `string \| null` | Journal/container title | all templates |
| `zt.DOI` | `string \| null` | Digital Object Identifier | all templates |
| `zt.url` | `string \| null` | URL | all templates |
| `zt.volume` | `string \| null` | Volume | all templates |
| `zt.issue` | `string \| null` | Issue | all templates |
| `zt.pages` | `string \| null` | Pages | all templates |
| `zt.date` | `ItemDate \| null` | Publication date (parsed; see [Date format](#date-format) below) | all templates |
| `zt.publisher` | `string \| null` | Publisher | all templates |
| `zt.place` | `string \| null` | Place of publication | all templates |
| `zt.edition` | `string \| null` | Edition | all templates |
| `zt.ISBN` | `string \| null` | ISBN | all templates |
| `zt.ISSN` | `string \| null` | ISSN | all templates |
| `zt.language` | `string \| null` | Language | all templates |
| `zt.shortTitle` | `string \| null` | Short title | all templates |
| `zt.extra` | `string \| null` | Extra field | all templates |
| `zt.dateAdded` | `Temporal.Instant` | When the item was added to Zotero. Renders as the local date (e.g. `"2026-06-21"`) in `<%= %>` tags. | all templates |
| `zt.dateModified` | `Temporal.Instant` | When the item was last modified. Renders as the local date (e.g. `"2026-06-21"`) in `<%= %>` tags. | all templates |
| `zt.backlink` | `string` | Zotero deep link (`zotero://select/...`) | note, content, frontmatter |
| `zt.annotations` | `array` | All annotations across all attachments (see [Annotation template](#annotation-template-zotlit-annotationetamd)) | note, content, frontmatter |
| `zt.attachments` | `array` | All attachments for this item (see [Attachment shape](#attachment-shape)) | note, content, frontmatter |
| `zt.authors` | `array` | Primary authors for this item (filtered from creators by the item's primary creator role). Creators coerce to `fullName` in string contexts. | note, content, frontmatter |
| `zt.authorsShort` | `string` | Formatted short author string (e.g. `"Smith et al."`) | note, content, frontmatter |
| `zt.relatedItems` | `array` | Items from Zotero's "Related" panel, sorted by title (see [Related items shape](#related-items-shape)) | note, content, frontmatter |

> **Note:** Timestamp fields (`zt.dateAdded` and `zt.dateModified`, on both items and annotations) are `Temporal.Instant` values at **second precision** -- Zotero stores them as UTC `"YYYY-MM-DD HH:MM:SS"` strings with no sub-second component, so any rendered or computed time is accurate only to the second.

Item-type-specific fields (e.g. `zt.reportNumber`, `zt.thesisType`, `zt.conferenceName`) are also available by their Zotero canonical name. Type-specific aliases (e.g. `blogTitle` for `publicationTitle`, `studio` for `publisher`) are normalized to their canonical form -- both names work. These have "all templates" availability.

The full alias map covers all Zotero field aliases -- both the canonical name and any type-specific alias work.

### Example: Journal article fields

When `zt.itemType` is `"journalArticle"`, the following fields are available (in addition to built-in fields like `key`, `libraryID`, `indexedKey`, `dateAdded`, `dateModified`, `creators`, `tags`, etc.):

| Property | Type | Description |
|----------|------|-------------|
| `zt.title` | `string \| null` | Article title |
| `zt.abstract` | `string \| null` | Abstract (alias for `abstractNote`) |
| `zt.containerTitle` | `string \| null` | Journal name (alias for `publicationTitle`) |
| `zt.publisher` | `string \| null` | Publisher |
| `zt.place` | `string \| null` | Place of publication |
| `zt.date` | `ItemDate \| null` | Publication date (parsed; see [Date format](#date-format)) |
| `zt.volume` | `string \| null` | Volume number |
| `zt.issue` | `string \| null` | Issue number |
| `zt.section` | `string \| null` | Section |
| `zt.partNumber` | `string \| null` | Part number |
| `zt.partTitle` | `string \| null` | Part title |
| `zt.pages` | `string \| null` | Page range (e.g. `"1-15"`) |
| `zt.series` | `string \| null` | Series |
| `zt.seriesTitle` | `string \| null` | Series title |
| `zt.seriesText` | `string \| null` | Series text |
| `zt.journalAbbreviation` | `string \| null` | Abbreviated journal name |
| `zt.DOI` | `string \| null` | Digital Object Identifier |
| `zt.citationKey` | `string \| null` | Citation key (`zt.citekey` also works) |
| `zt.url` | `string \| null` | URL |
| `zt.accessDate` | `string \| null` | Date the item was accessed |
| `zt.PMID` | `string \| null` | PubMed ID |
| `zt.PMCID` | `string \| null` | PubMed Central ID |
| `zt.ISSN` | `string \| null` | ISSN |
| `zt.archive` | `string \| null` | Archive name |
| `zt.archiveLocation` | `string \| null` | Location in archive |
| `zt.shortTitle` | `string \| null` | Short title |
| `zt.language` | `string \| null` | Language |
| `zt.libraryCatalog` | `string \| null` | Library catalog |
| `zt.callNumber` | `string \| null` | Call number |
| `zt.rights` | `string \| null` | Rights / license |
| `zt.extra` | `string \| null` | Extra field (free-form text) |

Example template using journal article fields:

```eta
# <%= zt.title %>

<% if (zt.authors.length) { %>
**Authors:** <%= zt.authors.join(", ") %>
<% } %>
<% if (zt.containerTitle) { %>
**Journal:** <%= zt.containerTitle %><%= zt.volume ? `, vol. ${zt.volume}` : "" %><%= zt.issue ? `(${zt.issue})` : "" %><%= zt.pages ? `, pp. ${zt.pages}` : "" %>
<% } %>
<% if (zt.DOI) { %>
**DOI:** <%= zt.DOI %>
<% } %>
<% if (zt.abstract) { %>

## Abstract

<%= zt.abstract %>
<% } %>
```

Other item types (book, thesis, report, etc.) follow the same pattern -- each has a subset of fields defined by the Zotero schema. Fields not defined for a given item type return `null`.

### Date format

`zt.date` is not a raw string. It is a parsed date object with four variants based on how much date information Zotero has. All variants share a uniform set of flat accessors so you can read date parts without checking `kind`:

| Property | Type | Description |
|----------|------|-------------|
| `year` | `number \| null` | Numeric year. Available on all variants; `null` only for `"text"` dates with no recognizable year. |
| `month` | `number \| null` | Month (1--12). Available for `"date"` and `"yearMonth"`; `null` otherwise. |
| `day` | `number \| null` | Day of month. Available for `"date"` only; `null` otherwise. |
| `value` | `Temporal.PlainDate \| Temporal.PlainYearMonth \| null` | The precise Temporal value. `null` for `"year"` and `"text"` kinds. |
| `raw` | `string` | The original Zotero string, verbatim. |
| `kind` | `string` | Discriminator: `"date"`, `"yearMonth"`, `"year"`, or `"text"`. |
| `text` | `string` | _(only on `"text"` kind)_ The renderable user portion. |

The four variants:

| `kind` | `year` | `month` | `day` | `value` | Example raw |
|--------|--------|---------|-------|---------|-------------|
| `"date"` | `2023` | `6` | `15` | `Temporal.PlainDate` | `"2023-06-15 June 15, 2023"` |
| `"yearMonth"` | `2023` | `6` | `null` | `Temporal.PlainYearMonth` | `"2023-06-00 June 2023"` |
| `"year"` | `2023` | `null` | `null` | `null` | `"2023-00-00 2023"` |
| `"text"` | `null` | `null` | `null` | `null` | `"0000-00-00 submitted"` |

**String rendering:** `<%= zt.date %>` (or `${zt.date}` in frontmatter expressions) outputs an ISO-normalized string automatically via a built-in `toString()`:

| `kind` | `toString()` output | Example |
|--------|-------------------|---------|
| `"date"` | ISO date | `"2023-06-15"` |
| `"yearMonth"` | ISO year-month | `"2023-06"` |
| `"year"` | Bare year | `"2023"` |
| `"text"` | The user text | `"submitted"` |

Common patterns:

```eta
<%# Render as ISO (uses toString) %>
<%= zt.date %>

<%# Get just the year (works for all kinds) %>
<%= zt.date?.year %>

<%# Locale-formatted full date (only for date/yearMonth kinds) %>
<%= zt.date?.value?.toLocaleString("en", { dateStyle: "long" }) %>
```

For frontmatter, use the same accessors in your expression settings (e.g. `zt.date?.year` for a numeric year field).

### Tags

`zt.tags` is an array of tag objects, not flat strings.

Each tag has:

| Property | Type | Description |
|----------|------|-------------|
| `itemID` | `number` | Item ID the tag applies to |
| `tag.tagID` | `number` | Tag ID |
| `tag.name` | `string` | Tag name |
| `type` | `0 \| 1` | `0` = manual, `1` = auto |

Tags coerce to `tag.name` in string contexts (e.g. `<%= t %>` or `` `${t}` ``), so `zt.tags.join(", ")` works without `.map()`.

### Creators

`zt.creators` is an array of all creators for the item. Each entry:

| Property | Type | Description |
|----------|------|-------------|
| `family` | `string` | Family/last name |
| `given` | `string` | Given/first name |
| `literal` | `string \| null` | Single-field name (institutional authors, Zotero `fieldMode=1`) |
| `role` | `string` | Creator type: `"author"`, `"editor"`, `"bookAuthor"`, `"translator"`, etc. |
| `fullName` | `string` | `literal` for institutional creators, `"given family"` for personal names |

For institutional creators, `literal` is set and `family`/`given` are empty strings. For personal names, `literal` is `null`.

Creators coerce to `fullName` in string contexts (e.g. `<%= c %>` or `` `${c}` ``), so `c.fullName` and `"" + c` are equivalent.

`zt.primaryCreatorType` (`string | null`) indicates which creator role is the primary type for this item type (e.g. `"author"` for journal articles, `"director"` for films).

> **Tip:** Use `zt.authors` (available in note/content templates and frontmatter) to get only the primary authors, or `zt.authorsShort` for a formatted string like `"Smith et al."`.

## Content template (`zotlit-content.eta.md`)

Has access to the same fields as the note template, including `zt.backlink`, `zt.attachments`, and all other fields listed above.

The default body only loops over `zt.annotations`, but the full `zt.*` is available.

## Annotation template (`zotlit-annotation.eta.md`)

Receives a single annotation as `zt`.

| Property | Type | Description |
|----------|------|-------------|
| `zt.key` | `string` | Annotation item key |
| `zt.libraryID` | `number` | Library ID |
| `zt.type` | `string` | `"highlight"`, `"note"`, `"image"`, `"ink"`, `"underline"`, `"text"` |
| `zt.text` | `string \| null` | Annotation text / highlighted text |
| `zt.comment` | `string \| null` | User comment on the annotation |
| `zt.colorHex` | `string \| null` | Hex color (e.g. `"#ffd400"`) |
| `zt.colorName` | `string \| null` | Palette name: `"yellow"`, `"red"`, `"green"`, `"blue"`, `"purple"`, `"magenta"`, `"orange"`, `"gray"` |
| `zt.pageLabel` | `string \| null` | Page label (e.g. `"42"`, `"iv"`) |
| `zt.tags` | `array` | Tags on this annotation (same shape as item tags) |
| `zt.authorName` | `string \| null` | Author of the annotation |
| `zt.isExternal` | `boolean` | Whether the annotation is external |
| `zt.dateAdded` | `Temporal.Instant` | When the annotation was created. Renders as the local date in `<%= %>` tags. |
| `zt.dateModified` | `Temporal.Instant` | When the annotation was last modified. Renders as the local date in `<%= %>` tags. |
| `zt.imgEmbed` | `string \| null` | Image embed string (e.g. `"![[image.png]]"`); `null` for non-image annotations |
| `zt.backlink` | `string` | Zotero deep link to this annotation (`zotero://open/...?annotation=KEY`) |
| `zt.parentItem` | object | The parent literature item (has all the same item fields as the note template) |
| `zt.parentAttachment` | object | The parent attachment (see [Attachment shape](#attachment-shape) below) |

## Citation templates (`zotlit-cite.eta.md`, `zotlit-cite2.eta.md`)

Citation templates receive an object with an `items` array:

| Property | Type | Description |
|----------|------|-------------|
| `zt.items` | `array` | Array of item data objects (each with all standard item fields) |

Each item has all the standard item fields, creators, tags, and aliases described above, except for `authors`, `authorsShort`, `backlink`, `annotations`, and `attachments` (which are only available in note, content, and frontmatter templates).

## Attachment shape

Used in `zt.attachments` and `zt.parentAttachment`:

| Property | Type | Description |
|----------|------|-------------|
| `key` | `string` | Attachment item key |
| `filename` | `string \| null` | Resolved filename from the attachment path; `null` for URL/unknown links |
| `contentType` | `string \| null` | MIME type (e.g. `"application/pdf"`) |
| `linkMode` | `string` | `"imported_file"`, `"imported_url"`, `"linked_file"`, `"linked_url"`, `"embedded_image"`, or `"unknown"` |
| `fileLink` | `string` | Resolved file link (vault-relative Markdown link or `file://` URI) |

## Related items shape

Used in `zt.relatedItems` (note, content, and frontmatter templates). The array
mirrors Zotero's "Related" panel for the item: same library, the relations you
see in Zotero, sorted by title (untitled items last). Trashed or unresolvable
relations are omitted.

Each entry has all the standard item fields, creators, tags, and aliases
described above, plus the note-tier conveniences `backlink`, `authors`, and
`authorsShort`:

| Property | Type | Description |
|----------|------|-------------|
| `backlink` | `string` | Zotero deep link to the related item (`zotero://select/...`) |
| `authors` | `array` | Primary authors for the related item |
| `authorsShort` | `string` | Formatted short author string (e.g. `"Smith et al."`) |

Related items are depth-1: an entry's own `annotations`, `attachments`, and
`relatedItems` are not populated (they are absent, not empty), marking the edge
of the relation graph.

```md
<% for (const r of zt.relatedItems) { %>
- [<%= r.title ?? r.key %>](<%= r.backlink %>) — <%= r.authorsShort %>
<% } %>
```

## Filename template

The filename template is a setting string (not a separate file). To keep filename resolution to a single-item query, `zt` here is the **item's own fields only** -- the same core item data described under [Item fields](#item-fields), plus `creators` and `tags`. The richer fields assembled for the note body are **not** available in filename templates: `backlink`, `annotations`, `attachments`, `relatedItems`, `authors`, `authorsShort`. Use `zt.creators[0].family` instead of `zt.authorsShort` for an author-based name.

`zt.notePath()` and `zt.noteLink()` exist but return an empty string in a filename template (a note has no path until it is named).

Default: `<%= zt.citationKey ?? zt.DOI ?? zt.title ?? zt.key %>`

The `.md` extension is appended automatically -- do not include it in the template.
