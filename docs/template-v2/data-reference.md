# Data Reference

This page documents every property available on the `zt` variable for each template type. All properties are accessed as `zt.propertyName`.

## Note template (`zotlit-note.liquid.md`)

The note template has access to all item fields on the `zt` variable.

### Item fields

All Zotero item fields are available as flat properties on `zt`. The canonical Zotero field name is the primary accessor. Two fields have CSL-inspired renames:

| Property | Zotero canonical | Notes |
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
| `zt.dateAdded` | `Temporal.Instant` | When the item was added to Zotero. Renders as the local date (e.g. `"2026-06-21"`) in `{{ }}` output. | all templates |
| `zt.dateModified` | `Temporal.Instant` | When the item was last modified. Renders as the local date (e.g. `"2026-06-21"`) in `{{ }}` output. | all templates |
| `zt.collections` | `array` | Zotero collections this item belongs to, sorted by name (see [Collections](#collections)) | note, content, frontmatter, filename |
| `zt.backlink` | `string` | Zotero deep link (`zotero://select/...`) | note, content, frontmatter |
| `zt.annotations` | `array` | All annotations across all attachments (see [Annotation template](#annotation-template-zotlit-annotationliquidmd)) | note, content, frontmatter |
| `zt.attachments` | `array` | All attachments for this item (see [Attachment shape](#attachment-shape)) | note, content, frontmatter |
| `zt.authors` | `array` | Primary authors for this item (filtered from creators by the item's primary creator role). Creators coerce to `fullName` in string contexts. | note, content, frontmatter |
| `zt.authorsShort` | `string` | Formatted short author string (e.g. `"Smith et al."`) | note, content, frontmatter |
| `zt.relatedItems` | `array` | Items from Zotero's "Related" panel, sorted by title (see [Related items shape](#related-items-shape)) | note, content, frontmatter |
| `zt.notes` | `array` | Imported child notes from Zotero (see [Notes shape](#notes-shape)) | note, content, frontmatter |
| `zt.notePath` | `string \| null` | Full vault-relative literature note path (including `.md`); `null` when unresolvable (path collision, recursive resolution, template error) | note, content, frontmatter, filename |
| `zt.noteLink` | link property | [Link helper](syntax.md#link-helpers) to this item's literature note -- renders on plain access (`{{ zt.noteLink }}`); pass `alias` / `subpath` through the `note_link` filter to override the display text or append a `#`-fragment. Resolves to nothing when unresolvable (path collision, recursive resolution, template error) | note, content, frontmatter, filename |

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

```liquid
# {{ zt.title }}

{% if zt.authors.size > 0 %}
**Authors:** {{ zt.authors | join: ", " }}
{% endif %}
{% if zt.containerTitle %}
**Journal:** {{ zt.containerTitle }}{% if zt.volume %}, vol. {{ zt.volume }}{% endif %}{% if zt.issue %}({{ zt.issue }}){% endif %}{% if zt.pages %}, pp. {{ zt.pages }}{% endif %}
{% endif %}
{% if zt.DOI %}
**DOI:** {{ zt.DOI }}
{% endif %}
{% if zt.abstract %}

## Abstract

{{ zt.abstract }}
{% endif %}
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

**String rendering:** `{{ zt.date }}` outputs an ISO-normalized string automatically:

| `kind` | Output | Example |
|--------|-------------------|---------|
| `"date"` | ISO date | `"2023-06-15"` |
| `"yearMonth"` | ISO year-month | `"2023-06"` |
| `"year"` | Bare year | `"2023"` |
| `"text"` | The user text | `"submitted"` |

Common patterns:

```liquid
{{ zt.date }}

{{ zt.date.year }}

{{ zt.dateAdded | date: "%B %d, %Y" }}
```

The `date` filter accepts the same [strftime-style format tokens](https://shopify.github.io/liquid/filters/date/) as standard Liquid (`%Y`, `%m`, `%d`, `%B`, `%A`, etc.) and understands every `zt.date` variant -- including `"text"` dates, which render their raw text verbatim since there is nothing to format. It also accepts `zt.dateAdded` / `zt.dateModified` (`Temporal.Instant`) directly.

For frontmatter, use the same accessors in your Liquid expression fields (e.g. `zt.date.year` for a numeric year field).

### Tags

`zt.tags` is an array of tag objects, not flat strings.

Each tag has:

| Property | Type | Description |
|----------|------|-------------|
| `itemID` | `number` | Item ID the tag applies to |
| `tag.tagID` | `number` | Tag ID |
| `tag.name` | `string` | Tag name |
| `type` | `0 \| 1` | `0` = manual, `1` = auto |

Tags coerce to `tag.name` in string contexts, so `{{ zt.tags | join: ", " }}` renders the tag names directly. To reach the nested field explicitly, chain `map` twice: `{{ zt.tags | map: "tag" | map: "name" | join: ", " }}`.

### Collections

`zt.collections` is an array of the Zotero collections the item belongs to -- the folders/groups in Zotero's left sidebar -- sorted by name. Trashed collections are excluded. Only top-level items carry collections; child items (attachments, annotations) never do.

Each collection has:

| Property | Type | Description |
|----------|------|-------------|
| `key` | `string` | Zotero collection key |
| `name` | `string` | Collection name |
| `path` | `readonly string[]` | Ancestor chain from top-level root to this collection: `path[0]` is the top-level ancestor, the last element is this collection itself |

Collections coerce to `name` in string contexts, so `{{ zt.collections | join: ", " }}` renders collection names directly.

For the full ancestor path, use the `collection_paths` filter -- it maps each collection to `path` joined by a separator (`"/"` by default):

```liquid
{{ zt.collections | collection_paths: " > " | join: "; " }}
```

A live collection still nested under a trashed parent roots its path at the first non-trashed ancestor.

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

Creators coerce to `fullName` in string contexts, so `{{ zt.authors | join: ", " }}` renders full names directly.

`zt.primaryCreatorType` (`string | null`) indicates which creator role is the primary type for this item type (e.g. `"author"` for journal articles, `"director"` for films).

> **Tip:** Use `zt.authors` (available in note/content templates and frontmatter) to get only the primary authors, or `zt.authorsShort` for a formatted string like `"Smith et al."`.

## Content template (`zotlit-content.liquid.md`)

Has access to the same fields as the note template, including `zt.backlink`, `zt.attachments`, and all other fields listed above.

The default body only loops over `zt.annotations`, but the full `zt.*` is available.

## Annotation template (`zotlit-annotation.liquid.md`)

Receives a single annotation as `zt`.

| Property | Type | Description |
|----------|------|-------------|
| `zt.key` | `string` | Annotation item key |
| `zt.libraryID` | `number` | Library ID |
| `zt.type` | `string` | `"highlight"`, `"note"`, `"image"`, `"ink"`, `"underline"`, `"text"` |
| `zt.text` | `string \| null` | Annotation text / highlighted text |
| `zt.comment` | `string \| null` | User comment, converted to Markdown; `null` when there is no comment |
| `zt.commentHtml` | `string \| null` | Raw comment HTML as stored by Zotero (only `<i>`/`<b>`/`<sub>`/`<sup>` tags plus line breaks); `null` when there is no comment |
| `zt.colorHex` | `string \| null` | Hex color (e.g. `"#ffd400"`) |
| `zt.colorName` | `string \| null` | Palette name: `"yellow"`, `"red"`, `"green"`, `"blue"`, `"purple"`, `"magenta"`, `"orange"`, `"gray"` |
| `zt.pageLabel` | `string \| null` | Page label as shown in the document (e.g. `"42"`, `"iv"`) |
| `zt.page` | `number \| null` | 1-based page number from the PDF position (`pageIndex + 1`); `null` for EPUB/snapshot annotations. Ignores the document's own page labelling -- use `zt.pageLabel` for that. |
| `zt.tags` | `array` | Tags on this annotation (same shape as item tags) |
| `zt.authorName` | `string \| null` | Author of the annotation |
| `zt.isExternal` | `boolean` | Whether the annotation is external |
| `zt.dateAdded` | `Temporal.Instant` | When the annotation was created. Renders as the local date in `{{ }}` output. |
| `zt.dateModified` | `Temporal.Instant` | When the annotation was last modified. Renders as the local date in `{{ }}` output. |
| `zt.imgLink` | link property | [Link helper](syntax.md#link-helpers) for the excerpt image -- renders on plain access (`{{ zt.imgLink }}`); pipe through the `embed` filter for an embed (`{{ zt.imgLink \| embed }}`). With "copy image to vault" disabled it links the cached image's `file://` URI; with it enabled it links the in-vault copy, formatted per your wikilink preference. Resolves to nothing for annotations without a cached excerpt image (everything but `image` and `ink`) |
| `zt.fileLink` | link property | [Link helper](syntax.md#link-helpers) to the parent attachment file -- renders on plain access, default-anchored to this annotation's `page` (`#page=N`). Resolves to nothing when the file is unresolvable |
| `zt.backlink` | `string` | Zotero deep link to this annotation (`zotero://open/...?annotation=KEY`) |
| `zt.parentItem` | `object \| null` | The parent literature item (has all the same item fields as the note template). `null` when the annotation is on a standalone attachment (a file with no parent bibliographic item) — guard with `{% if zt.parentItem %}`. **Exception:** `zt.parentItem.collections` is always empty here — the drag-insert doesn't resolve the parent item's collections. Use the note template if you need them. |
| `zt.parentAttachment` | object | The parent attachment (see [Attachment shape](#attachment-shape) below) |
| `zt.citation` | `string \| null` | A page-pinned citation for this annotation, rendered through your `cite` template from the parent item with the annotation's `pageLabel` as the Locator (label `"page"`) -- mirroring Zotero's own annotation citations. `null` when the annotation has no parent item or the parent carries no citation key. **Opt-in:** the default annotation template does not reference it -- reference `zt.citation` (a one-line edit) to include it. Computed lazily, so nothing is rendered unless the template reads it. |

> Raw image accessors like an absolute image path or `file://` URL are not exposed directly. Use `zt.imgLink` (plain property access; pipe through `embed` for an embed), which already resolves the path.

Example:

```liquid
{% bq %}
[!note] Page {{ zt.pageLabel }}

{{ zt.imgLink | embed }}{{ zt.text }}
{% if zt.comment %}

{{ zt.comment }}
{% endif %}
{% endbq %}
```

## Citation templates (`zotlit-cite.liquid.md`, `zotlit-cite2.liquid.md`)

Both citation templates receive the same object exposing two parallel arrays -- the **Citation Items** and, alongside them, the bare items:

| Property | Type | Description |
|----------|------|-------------|
| `zt.citations` | `array` | The Citation Items -- each pairs the cited item's data with the citation-scoped properties (see [Citation Item](#citation-item) below) |
| `zt.items` | `array` | The same cited items, bare -- `zt.items[i]` is `zt.citations[i].item` (see [Cited item fields](#cited-item-fields) below) |

The two arrays share order and identity: `zt.citations[i].item` is `zt.items[i]`. Use `zt.citations` when you need the locator or other citation-scoped properties; use `zt.items` when you only need the item data.

### Citation Item

Each entry in `zt.citations` carries the cited item plus the properties scoped to *how* it is cited (locator, suppress-author, prefix, suffix) -- these never live on the item itself:

| Property | Type | Description |
|----------|------|-------------|
| `item` | `object` | The cited item's data (see [Cited item fields](#cited-item-fields)). **Never `null`** -- a stub with every field `null` when the reference cannot be resolved, so a template never has to null-check the item |
| `locator` | `string \| null` | The Locator -- a pinpoint reference within the work, e.g. `"62"`; `null` when the citation has none |
| `label` | `string \| null` | The raw CSL locator label naming the locator's kind, e.g. `"page"`, `"chapter"`; `null` when absent |
| `labelShort` | `string` | Pandoc-style abbreviation of `label`, e.g. `"p."`, `"chap."` (see [Locator label abbreviations](#locator-label-abbreviations)). `"page"` or an absent/unrecognized label yields `"p."` |
| `suppressAuthor` | `boolean` | Whether the author should be suppressed (author-date styles); default `false` |
| `prefix` | `string \| null` | Text to render before the citation. Carried as data only -- the default templates do not render it |
| `suffix` | `string \| null` | Text to render after the citation. Carried as data only -- the default templates do not render it |

### Cited item fields

A cited item uses the same camelCase field vocabulary as the note template, **narrowed** to the fields both citation sources -- the live Zotero item and the [Embedded Item Data](note-import.md) snapshot -- can supply. Each behaves exactly as documented under [Item fields](#item-fields) above; unset fields are `null`.

| Property | Type |
|----------|------|
| `item.itemType` | `string \| null` |
| `item.title` | `string \| null` |
| `item.creators` | `array` (see [Creators](#creators)) |
| `item.primaryCreatorType` | `string \| null` |
| `item.date` | `ItemDate \| null` (see [Date format](#date-format)) |
| `item.citationKey` | `string \| null` |
| `item.citekey` | `string \| null` (alias for `citationKey`) |
| `item.abstract` | `string \| null` |
| `item.containerTitle` | `string \| null` |
| `item.shortTitle` | `string \| null` |
| `item.DOI` | `string \| null` |
| `item.url` | `string \| null` |
| `item.ISBN` | `string \| null` |
| `item.ISSN` | `string \| null` |
| `item.volume` | `string \| null` |
| `item.issue` | `string \| null` |
| `item.pages` | `string \| null` |
| `item.publisher` | `string \| null` |
| `item.place` | `string \| null` |
| `item.edition` | `string \| null` |
| `item.language` | `string \| null` |
| `item.extra` | `string \| null` |

The note-tier context is **not** narrowed onto a cited item -- an Embedded Item Data snapshot cannot express it. Unavailable here: `key`, `libraryID`, `indexedKey`, `tags`, `dateAdded`, `dateModified`, `collections`, `backlink`, `annotations`, `attachments`, `authors`, `authorsShort`, `relatedItems`, `notes`, `notePath`, and `noteLink`. When the cited item is a live Zotero item, its item-type-specific fields (e.g. `reportNumber`) are also reachable by name; a snapshot-sourced item carries only the fields above that its CSL data maps to.

### Resolution and the `KEY?` sentinel

When a citation is resolved during [note import](note-import.md), each cited reference resolves its item data live-DB-first: the live Zotero item, else the Embedded Item Data snapshot mapped into the zt vocabulary, else the all-`null` stub. The citekey resolves on its own chain -- the item's own citation key, else the embedded snapshot's citation key, else a visible `KEY?` sentinel (the Zotero item key with a `?` appended) so unresolved cites are greppable. Because the citekey is resolved separately, a live item with no assigned key can still render with a key supplied by the snapshot.

The default templates filter on `c.item.citationKey`, so the `KEY?` sentinel survives the filter and composes with the rest of the syntax (e.g. `-@ABC123?`). If **every** cited reference in one citation resolves to no citekey at all, the original citation HTML is kept verbatim, so nothing is lost.

Citation-suggest inserts (the `@`-completion flow) build the same object from live Zotero items with the citation-scoped properties at their defaults (`locator`/`label`/`prefix`/`suffix` `null`, `labelShort` `"p."`, `suppressAuthor` `false`).

### Locator label abbreviations

`labelShort` maps the raw CSL `label` to its Pandoc locator term. Any label absent from this table -- including `"page"` itself -- yields `"p."`, matching Pandoc's default locator term.

| `label` | `labelShort` |
|---------|--------------|
| `book` | `bk.` |
| `chapter` | `chap.` |
| `column` | `col.` |
| `figure` | `fig.` |
| `folio` | `fol.` |
| `issue` | `no.` |
| `line` | `l.` |
| `note` | `n.` |
| `opus` | `op.` |
| `paragraph` | `para.` |
| `part` | `pt.` |
| `section` | `sec.` |
| `sub-verbo` | `s.v.` |
| `verse` | `v.` |
| `volume` | `vol.` |

The shipped default `cite` template renders Pandoc-parseable output from this data -- a suppressed author as `-@key`, a locator as `, labelShort locator`:

```liquid
[{% liquid
  assign cites = "" | split: ","
  for c in zt.citations
    if c.item.citationKey
      if c.suppressAuthor
        assign cite = "-@" | append: c.item.citationKey
      else
        assign cite = "@" | append: c.item.citationKey
      endif
      if c.locator
        assign cite = cite | append: ", " | append: c.labelShort | append: " " | append: c.locator
      endif
      assign cites = cites | push: cite
    endif
  endfor
  echo cites | join: "; "
%}]
```

See [Default templates](defaults.md#citation-templates) for the full `cite` / `cite2` listings.

## Attachment shape

Used in `zt.attachments` and `zt.parentAttachment`:

| Property | Type | Description |
|----------|------|-------------|
| `key` | `string` | Attachment item key |
| `filename` | `string \| null` | Resolved filename from the attachment path; `null` for URL/unknown links |
| `contentType` | `string \| null` | MIME type (e.g. `"application/pdf"`) |
| `linkMode` | `string` | `"imported_file"`, `"imported_url"`, `"linked_file"`, `"linked_url"`, `"embedded_image"`, or `"unknown"` |
| `filePath` | `string \| null` | Absolute on-disk path to the attachment file; `null` for URL links, an unset linked-file base directory, or an unparseable path |
| `fileLink` | link property | [Link helper](syntax.md#link-helpers) to the attachment file -- renders on plain access (`{{ a.fileLink }}`); pass `alias` / `subpath` through the `file_link` filter to override the display text or append a `#`-fragment. Resolves to nothing when unresolvable |

```liquid
{{ a.fileLink }}
{{ a | file_link: "Open PDF" }}
```

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

```liquid
{% for r in zt.relatedItems %}
- [{{ r.title | default: r.key }}]({{ r.backlink }}) — {{ r.authorsShort }}
{% endfor %}
```

## Notes shape

Used in `zt.notes` (note, content, and frontmatter templates). Lists the Zotero item's child notes. Each entry is a link-only shape -- the note's HTML body is not available in the template context.

| Property | Type | Description |
|----------|------|-------------|
| `key` | `string` | Bare Zotero item key of the child note |
| `title` | `string \| null` | The note's title |
| `noteLink` | link property | [Link helper](syntax.md#link-helpers) to the imported child-note file in the vault. Rendering it lazily queues the child note for import -- if the link is never rendered, no file is created |

Child notes are imported as flat Markdown files (HTML parsed to Markdown, with frontmatter) on the first render that touches `noteLink`. Already-imported notes (matched by identity key) link to the existing file without re-importing. Notes are never implicitly updated -- import is create-only.

```liquid
{% if zt.notes.size > 0 %}
## Notes

{% for note in zt.notes -%}
- {{ note.noteLink }}
{% endfor %}
{% endif %}
```

To expose child-note links in frontmatter, add a field with a Liquid expression of `zt.notes | note_links`. The `note_links` filter maps each note to its link (falling back to a `zt-error:<indexedKey>` marker if the link can't be resolved), and touching it in a frontmatter expression triggers the import queue the same way rendering `noteLink` does, so the child-note files are created even when notes only appear in frontmatter.

## Filename template

The filename template is a file (`zotlit-filename.liquid.md`), not a settings string. To keep filename resolution to a single-item query, `zt` here is the **item's own fields only** -- the same core item data described under [Item fields](#item-fields), plus `creators`, `tags`, and `collections`. The richer fields assembled for the note body are **not** available in filename templates: `backlink`, `annotations`, `attachments`, `relatedItems`, `authors`, `authorsShort`. Use `zt.creators[0].family` instead of `zt.authorsShort` for an author-based name.

`zt.notePath` and `zt.noteLink` exist in filename templates but always render empty -- a note has no path until it is named, so referencing them yields nothing (they never resolve to a link or path here).

Default:

```liquid
{{ zt.citationKey | default: zt.DOI | default: zt.title | default: zt.key }}{% suffix %}
```

The `{% suffix %}` tag emits a random placeholder that's resolved to a short disambiguating suffix only if the resulting filename collides with an existing note -- omit it and colliding filenames are left to overwrite/prompt instead.

To file notes into a folder per collection, join a collection's `path` with `/`: `{{ zt.collections[0].path | join: "/" }}/{{ zt.title | default: zt.key }}`.

The `.md` extension is appended automatically -- do not include it in the template.

## Link helpers in Liquid

Zero-arg link helpers (`noteLink`, `fileLink`, `imgLink`) auto-invoke as plain property access -- `{{ a.fileLink }}` renders the link with no filter needed. To override the display text or append a `#`-fragment, pipe the owning object through the matching filter instead of the bare property:

```liquid
{{ a | file_link: "alias", "#subpath" }}
{{ zt | note_link: "alias" }}
```

`noteLink` on items resolves to nothing when unresolvable, and in Liquid a missing value renders as an empty string, so an unresolved link silently disappears from the output. To detect absence explicitly -- for example to render a fallback -- assign the filter's result to a variable and test it:

```liquid
{% assign link = zt | note_link %}
{% if link %}
  {{ link }}
{% else %}
  _(no note yet)_
{% endif %}
```
