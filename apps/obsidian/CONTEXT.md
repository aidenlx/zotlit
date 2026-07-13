# ZotLit Obsidian Plugin

The Obsidian-side integration: how Zotero data becomes vault files, in-text citations, and sidebar views.

## Language

### Notes

**Literature Note** _(Obsidian)_:
An Obsidian Markdown file linked one-to-one with a Zotero Item. Identified by a `zotero-key` frontmatter field containing the Item's Indexed Key. Created, updated, and overwritten through the note-feature operations. The Zotero-side source is an Item (not a Child Note).
_Avoid_: note (ambiguous across Zotero/Obsidian boundary), Zotero note (ambiguous with Child Note), document

**Imported Note** _(Obsidian)_:
An Obsidian Markdown file produced by converting a Zotero Child Note's HTML body to Markdown. Identified by a `zotero-note-key` frontmatter field (disjoint from `zotero-key`, so it never pollutes the Literature Note index). Carries a `zotero-lastmod` frontmatter field (the source Child Note's Zotero `dateModified`) used by batch re-import to skip unchanged notes. Whole-body overwrite on explicit re-import. The Zotero-side source is a Child Note.
_Avoid_: child note (that's the Zotero-side source), mirror, note (ambiguous)

**Managed Region**:
The `%%zt-managed%%`-delimited portion of a Literature Note's body, re-rendered from the `content` template on every update. Content outside the markers is user-owned and preserved.
_Avoid_: managed block, template region, synced region

**Managed Frontmatter**:
Frontmatter fields on a Literature Note whose values are re-evaluated from template expressions on update. Includes system fields (`zotero-key`, `citekey`) and user-configured `{key, expression, language}` entries. Each expression declares its own language — Liquid (the default) or JavaScript — and always evaluates in that language; JavaScript fields run only while JavaScript Templates is enabled on the device, and are otherwise inert — a note write that consumes the field set fails with an error naming them, existing notes untouched. Unmanaged keys are preserved.

### Templates

**Template**:
A template file in the vault's template folder defining Markdown output — `zotlit-<name>.liquid.md` (Liquid, the default language), or `zotlit-<name>.eta.md` when JavaScript Templates are enabled. The extension names the rendering language; when both files exist for one name, the Liquid file wins and the Eta file is flagged as shadowed. Falls back to the embedded defaults (Liquid only) when no vault file exists. A Template changes language by replacing its file with the other extension's edition — content is never converted between languages. Templates include each other by name, not by file, so one set may mix languages. Named templates:
- `note` — full Literature Note body on **create** and **overwrite**
- `content` — Managed Region body on **update** (the rest of the note is preserved)
- `annotation` — single annotation rendering (drag-insert and optional Annotation Paragraph subsuming)
- `cite` / `cite2` — primary / secondary in-text citation format
- `filename` — a new Literature Note's filename (see Filename Template)

_Avoid_: format, layout, schema

**JavaScript Templates**:
The gated capability to run user-authored JavaScript during rendering — Eta template files and JavaScript-language Managed Frontmatter fields together. Off by default; enabled per device behind an explicit confirmation, and the flag never syncs. While off, `.eta.md` templates and JavaScript frontmatter fields are inert — an operation that requires one fails with an error naming it, never falling back to substitute output — and no user-authored code is compiled or executed anywhere, settings validation included.
_Avoid_: advanced templates, legacy templates, scripting, user scripts

**Filename Template**:
The `filename` Template, evaluated to determine a new Literature Note's filename. Uses the `zt.*` template data without note-path resolvers (the note doesn't exist yet at evaluation time); output is a single line.
_Avoid_: filename expression, filename setting (it is a vault file, not configuration)

**Template Data Explorer** _(Obsidian)_:
The sidebar view that displays the exact template data (`zt`) a Template receives for a real library Item, as an explorable tree anchored at the Note Root or an Annotation Root. Nodes offer copy-path (Liquid `zt.…`; plus an explicit Eta `it.…` variant while JavaScript Templates is enabled) and copy-value; one filter box matches key names and values, scoped to the current root — changing roots resets it. Everything displayed is true at display time, and browsing never writes to the vault — link helpers that would queue imports show existing targets or labeled placeholders instead.
_Avoid_: item details (v1's item-centric framing), template preview / data preview (preview implies rendered output, a non-goal)

**Note Root**:
The Template Data Explorer's default anchor — the full note-template context for the chosen Item, exactly what the `note`/`content` templates receive as `zt`.

**Annotation Root**:
The Template Data Explorer re-anchored at a single Annotation, exactly what the `annotation` template receives as `zt`; copy paths root at the annotation. Entered from that annotation's node in the Note Root tree, or directly via an annotation-scoped entry point.

### Note content

**Annotation Excerpt**:
A frozen snapshot of a Zotero Annotation embedded inline in a Child Note's HTML — a `span[data-annotation]` carrying the annotation's text, color, page label, and attachment URI at insertion time. Distinct from the live Annotation in the DB: edits made in the Zotero reader after insertion are not reflected in the excerpt. Converted to inline Markdown marks (highlight/underline) by the note parser.
_Avoid_: annotation (that's the live Zotero entity), mark

**Annotation Paragraph**:
A `<p>` in a Child Note's HTML whose sole content is a single Annotation Excerpt (optionally followed by a citation). Detected structurally by the note parser; when the `note.import-annotations-as-template` setting is on, the paragraph is subsumed and re-rendered through the `annotation` template from live DB data instead of the frozen excerpt.
_Avoid_: annotation block, callout

### Integration processes

**Note Import**:
Converting a Zotero Child Note's HTML to Obsidian Markdown and writing it as an Imported Note. Includes citation resolution, embedded-image resolution, and optional annotation-paragraph template mapping. Triggered automatically as a side effect of Literature Note create/update (skip-if-exists) or explicitly via protocol action (overwrite).

**Attachment Import**:
Copying a Zotero-managed file (PDF, annotation excerpt image, note-embedded image) into the vault's attachment folder. Uses reflink (macOS copy-on-write) with fallback to regular copy. When disabled, links use `file://` URIs to Zotero's storage instead.
_Avoid_: image import (covers more than images)

**Citation**:
An in-text reference to one or more Zotero Items, rendered through the `cite` template. In editor text: an `@citekey` token. In a Zotero note's HTML: a `span.citation[data-citation]` carrying one or more Citation Items. Each cited ref resolves item data live-DB-first (falling back to the Embedded Item Data snapshot, then a stub with null fields) and its citekey through the chain: item's own citation key → embedded snapshot key → sentinel (`KEY?`).

**Embedded Item Data**:
A CSL-JSON snapshot of each cited Item, stored on the Zotero note container's `data-citation-items` attribute at citation-insertion time. The only source for cross-library cites and the fallback when the DB cannot resolve a ref; mapped into the zt item vocabulary by a schema-driven CSL→zt reverse mapping.
_Avoid_: citation map (that's the derived lookup structure)

**Citation Item**:
One cited Item within a Citation, pairing the pure item data with citation-scoped properties: Locator, locator label, suppress-author, prefix, suffix. The citation-scoped properties never live on the item itself. In the cite-template data: `zt.citations` (Citation Items) alongside `zt.items` (the same items, bare).
_Avoid_: cite item, citation entry

**Locator**:
A pinpoint reference within a cited work (CSL locator), e.g. a page number, with an accompanying label naming its kind (`page` by default). An annotation-derived Citation uses the annotation's page label as its Locator — mirroring Zotero's own annotation citations.

### Index and identity

**Note Index**:
A vault-wide in-memory index mapping frontmatter identifiers to Obsidian files. Three maps keyed on `zotero-key` (Literature Notes), `citekey`, and `zotero-note-key` (Imported Notes). Rebuilt from Obsidian's metadata cache on startup and kept current via cache-change events.

### Protocol

**Protocol Action**:
A URL-scheme verb (`obsidian://zotlit/<action>`) sent by the Zotero companion to trigger an operation in Obsidian. Single-item actions: `open` (open or create), `update` (update or create). Batch actions: `update-many`, `import-notes`. Note-import action: `import-note`. Explorer action: `explore` (open the Template Data Explorer at an Item or an Annotation). Long URLs fall back to HTTP PUT on the plugin's local server.
