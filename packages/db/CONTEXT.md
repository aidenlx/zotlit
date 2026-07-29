# Zotero Data Model

The Zotero library's entity hierarchy, identification scheme, and annotation/attachment domain as modeled by `@zotlit/db`. Types mirror Zotero's SQLite schema through Drizzle ORM.

## Language

### Hierarchy

**Item**:
A top-level Zotero library entry — journal article, book, thesis, conference paper, etc. In Zotero's schema, attachments, annotations, and notes are also items; in ZotLit, **Item** always means a regular (top-level) library entry, excluding child types (Attachment, Annotation, Child Note).
_Avoid_: document, record, entry, regular item

**Attachment**:
A file or URL linked to an Item — typically a PDF, EPUB, or web snapshot. Each Attachment has a Link Mode governing how its file is stored or referenced.
_Avoid_: file, PDF

**Annotation**:
A mark within an Attachment's content — a highlight, underline, note, image region, ink stroke, or text selection. Carries text, comment, color, page label, sort index, and position.
_Avoid_: highlight (too narrow), mark (that term is used for the HTML representation in notes)

**Child Note** _(Zotero)_:
A rich-text HTML note attached to an Item. Distinguished from a Standalone Note (no parent Item). The HTML body follows Zotero's note schema (currently v6). The Obsidian-side output of importing a Child Note is an Imported Note.
_Avoid_: note (ambiguous across Zotero/Obsidian boundary), Zotero note (still ambiguous)

**Standalone Note** _(Zotero)_:
A rich-text HTML note with no parent Item. Same schema as a Child Note, but top-level in the library. Only reachable via explicit import (not auto-materialized as a side effect of Literature Note operations).

**Library**:
A Zotero library — either the user's personal library or a group library. Each Library has a `libraryID` (DB primary key); group libraries additionally carry a `groupID`.

**Collection**:
A user-organized folder within a Library. Collections form a tree; an Item can belong to multiple Collections. Resolved to ancestor paths (root → leaf) for template rendering.
_Avoid_: folder, category, tag

**Tag**:
A label applied to an Item — either **manual** (user-added) or **auto** (added by a Zotero plugin such as a retrieval-metadata service). Carries a name and a type; its numeric IDs are Zotero-internal and never surface to users. In string contexts a Tag reads as its name.
_Avoid_: keyword, label (in code), category

### Identification

**Key**:
Zotero's 8-character alphanumeric identifier for any item, unique within a Library.
_Avoid_: id, itemID (the integer DB primary key — not exposed to users)

**Indexed Key**:
A disambiguated Key string used as the canonical cross-library identity: bare `key` for the personal library, `key + "g" + groupID` for group libraries. Identifies any Zotero object — Item, Attachment, Annotation, or Child Note — since all four share one keyed table. Stored in literature-note frontmatter as `zotero-key`.
_Avoid_: item key, scoped key

**Citation Key**:
A human-readable identifier for an Item (e.g., `smith2024`). Stored in Zotero's native `citationKey` field — originally a Better BibTeX feature, now an official Zotero field. The frontmatter field name `citekey` is a legacy abbreviation from before Zotero adopted the field.
_Avoid_: BBT key, BibTeX key, citekey (legacy; use Citation Key in prose)

### Links

**Backlink**:
A Zotero **desktop deep link** (`zotero://select/...`) that opens an Item in the Zotero app. Exposed to templates as `zt.backlink`, present on the note's main Item, related Items, and Annotations.
_Avoid_: link, deep link (in prose), URI

**Weblink**:
A Zotero **web library URL** pointing at the Item's page on zotero.org. Personal-library Items use the account **username slug** (`https://www.zotero.org/{slugify(username)}/items/{key}`, the form zotero.org serves and the Zotero dataserver emits); group-library Items use the numeric `groupID` (`.../groups/{groupID}/items/{key}`, which zotero.org redirects to the `groups/{id}/{slug}` form). Exposed as `zt.weblink` on the same surface as Backlink minus Annotations (the web library has no per-Annotation page). A synced account carries a username, so group-library Items always resolve and personal-library Items resolve once synced; a never-synced account has no username, so its personal-library Items are `null`.
_Avoid_: online URL, web URL, url (that is the Item's own resource URL — see below)

**URL** _(field)_:
An Item's own resource URL as recorded in Zotero's `url` field — the article's DOI landing page, the web page a snapshot was taken from, etc. Exposed as `zt.url`. Distinct from **Weblink**, which points at zotero.org rather than the source.

**Item URI** _(Zotero)_:
Zotero's persistent identifier for an Item, `http://zotero.org/users/{userID}|groups/{groupID}/items/{key}`. A stable machine identity, not a browsable page. ZotLit parses this form **inbound** (from note-editor mark payloads) but does not expose it to templates.
_Avoid_: backlink, weblink

### Attachment storage

**Link Mode**:
How an Attachment's file is stored: `imported_file` (copied into Zotero's storage), `linked_file` (absolute or base-relative path on disk), `imported_url` / `linked_url` (web snapshots), or `embedded_image` (inline image in a Child Note).

**Attachment Path**:
The resolved absolute filesystem path to an Attachment's file, computed from its Link Mode, Zotero's data directory, and the optional base attachment path preference.

### Item fields

**Extra**:
Zotero's free-text `extra` field on an Item — arbitrary user text that conventionally holds `key: value` lines (CSL variables, Better BibTeX `tex.*` fields, citation keys) mixed with prose. Stored verbatim by Zotero, never normalized on write. ZotLit parses it best-effort into an **ItemExtra** carrying the `raw` string, a first-wins `fields` lookup, and per-row `lines`.
_Avoid_: note (that is the CSL `note` variable and the Child Note), metadata

**Extra Pair**:
A single `key: value` (or `key = value`) line parsed out of an **Extra** field. Keys are preserved verbatim and are case-sensitive; when a key repeats, the first occurrence wins the `fields` lookup while every occurrence remains in `lines`.
_Avoid_: extra field (ambiguous with the whole field), tag

**Extra Line**:
One source row of an **Extra** field in document order — either a parsed **Extra Pair** or a non-pair text/blank row. Retains the row's raw text so freeform prose interleaved with pairs is never dropped.
