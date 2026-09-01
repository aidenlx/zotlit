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

**Plain HTML Child Note** _(Zotero)_:
A Child Note whose stored HTML has no usable Zotero note schema marker. Note Import preserves its general document structure and visible formatting without assigning Zotero-specific semantics to citations, annotation excerpts, or embedded attachments.
_Avoid_: non-standard Zotero note, schema-less note

**Managed Region**:
The `%%zt-managed%%`-delimited portion of a Literature Note's body, re-rendered from the `content` template on every update. Content outside the markers is user-owned and preserved.
_Avoid_: managed block, template region, synced region

**Managed Frontmatter**:
Frontmatter fields on a Literature Note whose values are re-evaluated from template expressions on update. `zotero-key` is the system field; the ordered user-configured entries each declare `{key, expression, language, merge strategy}`, and the defaults include a `citekey` field sourced from `zt.citationKey`. Each expression declares its own language — Liquid (the default) or JavaScript — and always evaluates in that language; each field's merge strategy (replace, append arrays, keep existing) governs how the re-evaluated value combines with the value already on the note; JavaScript fields run only while JavaScript Templates is enabled on the device, and are otherwise inert — a note write that consumes the field set fails with an error naming them, existing notes untouched. Unmanaged keys are preserved. The user-configured entries are ordered, and that order is the write order for the fields on a newly created note; on an update, keys already on the note keep their position.

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

**Template Workbench** _(Obsidian)_:
The agent-facing CLI surface over the template system: reports template-authoring state, returns the exact item-backed template data, renders templates entirely in memory, and manages Managed Frontmatter configuration. Inspection, rendering, and frontmatter evaluation are side-effect-free and reuse the Template Data Explorer's inert resolver behavior; mutation is scoped to Managed Frontmatter configuration only — never vault files, never note content. Selection takes one Indexed Key naming any Zotero object, with the data root as the lens on it. Every diagnostic carries its own recovery hint, so corrective guidance arrives with the failure it belongs to.
_Avoid_: agent template workbench (names the audience, not the thing), template CLI (names the mechanism), template preview (implies rendered visual output)

**Workbench Guide**:
The Template Workbench's built-in usage guide, disclosed in tiers: a quickstart and topic index by default, one topic section on demand. Together with command help it is the home of every workbench tooling fact — value lists come from the same registries the commands use, so the guide cannot drift from the code.
_Avoid_: manual, skill documentation (the guide lives in the workbench, the skill points at it)

**Workbench Skill**:
The installable Agent Skill (`zotlit-template`) that teaches an agent the workbench process, policy, and safety model — thin, hand-authored prose whose tooling facts live in the Workbench Guide and command help. Distributed from the repository's `skills/` folder and through the docs site's well-known Agent Skills index.
_Avoid_: template-workbench skill (the pre-rename install name), skill docs

**Template Data Explorer** _(Obsidian)_:
The sidebar view that displays the exact template data (`zt`) a Template receives for a real library Item, as an explorable tree anchored at the Note Root or an Annotation Root. Nodes offer copy-path — one `zt.…` path shared by both Liquid and Eta, since both engines bind the data to `zt` — copy-value, and per-engine Template Snippets; one filter box matches key names and values, scoped to the current root — changing roots resets it. Everything displayed is true at display time, and browsing never writes to the vault — link helpers that would queue imports show existing targets or labeled placeholders instead.
_Avoid_: item details (v1's item-centric framing), template preview / data preview (preview implies rendered output, a non-goal)

**Template Snippet** _(Obsidian)_:
A paste-ready template fragment the Template Data Explorer generates for a node, in one engine's syntax. Four kinds, offered per node kind: output (`{{ zt.title }}` / `<%= zt.title %>`), if-present (guards output on truthiness), loop (iterates an array, element named by singularizing the array's key, falling back to `item`), and joined (an array flattened to a delimited string). Distinct from copy-path (the engine-neutral bare `zt.…` accessor, shared by both engines): a Snippet wraps that path in an engine's delimiters and diverges by engine where the languages differ — notably a helper node interpolates as `{{ zt.fileLink }}` in Liquid (zero-arg auto-invoke) but `<%= zt.fileLink() %>` in Eta. Liquid Snippets are always offered; Eta Snippets appear only while JavaScript Templates is enabled — inline in the row menu when Liquid alone is active, split into Liquid / Eta submenus once both are. Copy-only, like copy-path and copy-value.
_Avoid_: template expression (a Snippet may be a statement — a loop or guard — not only an expression), snippet insertion (it copies to the clipboard, it does not write into the editor)

**Note Root**:
The Template Data Explorer's default anchor — the full note-template context for the chosen Item, exactly what the `note`/`content` templates receive as `zt`.

**Annotation Root**:
The Template Data Explorer re-anchored at a single Annotation, exactly what the `annotation` template receives as `zt`; copy paths root at the annotation. Entered from that annotation's node in the Note Root tree, or directly via an annotation-scoped entry point.

**Template Data Export** _(Obsidian)_:
The Template Data Explorer's current root, saved as a JSON file for a bug report. Always the whole root the pane is anchored at — the Note Root or the Annotation Root — never the rows an active filter leaves visible. Carries the same data the Agent CLI answers with, under a header naming the plugin version, the contract version, and the Indexed Key and root that reproduce it. Being Explorer data, it records inert placeholders where a real render would write files.
_Avoid_: template export (suggests rendered note output), data dump (the file follows the published contract, it is not raw state)

### Agent CLI

**CLI Contract**:
The wire format of one `zotlit:*` command namespace — its envelope, payload fields, and diagnostic codes. Each namespace versions its own, so a bump in one says nothing about another. Distinct from the Template Contract, which is a promise about `zt` data rather than about an answer's shape.
_Avoid_: contract version (names the number, not the thing); protocol (that is the wire format for ZotLit Companion, the Zotero add-on)

### Annotation view

**Annotation Card** _(Obsidian)_:
One live Annotation presented as a card in the annotation-view sidebar — type icon, page label, Excerpt Block, comment, and tag chips, all sourced from the Zotero DB at display time. A deliberately dense surface: prose inside it renders compact.
_Avoid_: annotation item, annotation row

**Excerpt Block**:
The quoted region of an Annotation Card showing the Annotation's live text (with Zotero's inline rich-text formatting) or its area image. Distinct from the Annotation Excerpt, which is a frozen snapshot inside a Child Note; the Excerpt Block always reflects the DB.
_Avoid_: annotation excerpt (that's the frozen Child-Note snapshot), quote block

### Note content

**Annotation Excerpt**:
A frozen snapshot of a Zotero Annotation embedded inline in a Child Note's HTML — a `span[data-annotation]` carrying the annotation's text, color, page label, and attachment URI at insertion time. Distinct from the live Annotation in the DB: edits made in the Zotero reader after insertion are not reflected in the excerpt. Converted to inline Markdown marks (highlight/underline) by the note parser.
_Avoid_: annotation (that's the live Zotero entity), mark

**Annotation Paragraph**:
A `<p>` in a Child Note's HTML whose sole content is a single Annotation Excerpt (optionally followed by a citation). Detected structurally by the note parser; when the `note.import-annotations-as-template` setting is on, the paragraph is subsumed and re-rendered through the `annotation` template from live DB data instead of the frozen excerpt.
_Avoid_: annotation block, callout

**Colored Highlight Syntax**:
An opt-in Markdown representation of a highlight in an Imported Note, with a selected emoji at the start of `==...==`. The emoji comes from the Highlight Mapping for the source color.
_Avoid_: Bear highlight, emoji highlight

**Highlight Mapping**:
A per-color choice of representation for highlights converted during Note Import: a colored HTML mark or Colored Highlight Syntax with a selected emoji. Each mapping corresponds to a recognized Zotero palette color.

### Integration processes

**Note Import**:
Converting a Zotero Child Note's HTML to Obsidian Markdown and writing it as an Imported Note. Includes citation resolution, embedded-image resolution, and optional annotation-paragraph template mapping. Triggered automatically as a side effect of Literature Note create/update (skip-if-exists) or explicitly via protocol action (overwrite).

**Attachment Import**:
Copying an import-capable Zotero file, such as an annotation excerpt image or note-embedded image, into the vault's attachment folder. A file Zotero manages is reflinked (macOS copy-on-write) with fallback to regular copy; a linked file elsewhere is read from the file that was checked, so a swap afterwards cannot substitute another one. A source is copied once approved: automatically for Zotero's storage directory, its annotation cache, and the configured base attachment directory, or otherwise only inside an Approved Attachment Root. A blocked source, and every source while Attachment Import is disabled, instead links with a `file://` URI to its own location. An ordinary Literature Note attachment `fileLink` always links directly to the source and does not start Attachment Import.
_Avoid_: image import (covers more than images)

**Attachment Source Decision**:
The approved-or-blocked verdict on one attachment location, which every copy consumer passes to link resolution in place of a raw path. An approved verdict names the kind of place the file came from — Zotero storage, the annotation cache, the base attachment directory, or an Approved Attachment Root — and is constructible only by the attachment import service. A blocked verdict carries its location so the `file://` fallback renders in one place. Skipped sources are reported once per operation as a count, never as a location.
_Avoid_: approval check (names a step, not the verdict), source validation (validation is the lexical layer's job)

**Citation**:
An in-text reference to one or more Zotero Items, rendered through the `cite` template. Always a single inline line of text, wherever it renders. In editor text: an `@key` token; during Pandoc export, a wikilink to a Literature Note is a normal parenthetical Citation whose current citation key comes from the associated Zotero Item. In a Zotero note's HTML: a `span.citation[data-citation]` carrying one or more Citation Items. Each cited ref resolves item data live-DB-first (falling back to the Embedded Item Data snapshot, then a stub with null fields) and its citation key through the chain: item's own citation key → embedded snapshot key → sentinel (`KEY?`).

**Citation Fragment** _(Pandoc export)_:
The `#cite:...` fragment of a Literature Note wikilink, carrying Pandoc-specific citation details as named key-value parameters. Parameter values use URI percent encoding so the fragment remains safe inside a Markdown wikilink; other wikilink fragments keep their heading or block-link meaning.
_Avoid_: hash, citation hash

**Citation Run** _(Pandoc export)_:
A same-line sequence of two or more Literature Note wikilinks separated only by semicolons and optional whitespace, converted into one grouped Citation. Any other text ends the run.
_Avoid_: citation group (the group is the resulting Citation, not the source syntax), citation list

**Entry Marker**:
The marker a numeric CSL style renders ahead of each bibliography entry — the entry's citation number wrapped in the style's own affixes, such as `[1]` or `1.`. It belongs to the Citation and References Style, not to ZotLit: a sorted style can give the same Item a different Entry Marker across renders, and a non-numeric style produces none.
_Avoid_: serial number, reference index, gutter number, Entry Serial (ZotLit's positional number, not the style's)

**Entry Serial**:
The 1-based position of a rendered entry in the References Sidebar's bibliography-ordered list — ZotLit-assigned and occurrence-independent, unlike the style-owned Entry Marker and the first-occurrence Reference Number. When a citation's formatted text contains a footnote the inline surfaces cannot render, the Entry Serial of each cited entry appears superscript in place of that footnote and in the sidebar gutter, an entry's own Entry Marker keeping precedence in the gutter.
_Avoid_: serial number, footnote number (the document format's counter, which never renders here), fallback marker (names the mechanism, not the number)

**Openable Attachment**:
An Attachment of a cited Item whose path names a file, so Zotero's reader can be sent to it — the stored modes and both linked-file forms. A bare web link carries no file, and neither does a row whose path does not parse, so the References Sidebar offers neither. The file's format does not decide it: a PDF, an EPUB, a web snapshot, and an office document all qualify, and Zotero owns what happens to a format its reader cannot render.
_Avoid_: PDF attachment (the format is not the rule), openable file

**Reference Number**:
An active-document identifier assigned to each distinct Literature Note Citation by first occurrence. It appears in editor widgets and in the References Sidebar's minimal reference list when no engine renders; repeated Citations share the same number, and the Markdown source stays unchanged.
_Avoid_: citation key, reference index, Entry Serial (bibliography-ordered, not first-occurrence)

**Reference Error** _(Obsidian)_:
A References Sidebar entry for an unresolved or ambiguous Citation Key, a missing Item, a malformed Citation Fragment while Wikilink Citations is on, or a source-backed Item omitted from a completed bibliography rendering.
_Avoid_: broken reference, missing reference (names only one cause)

**References Sidebar** _(Obsidian)_:
The active-document view of each distinct Literature Note Citation and its occurrences, cited Item, and Openable Attachments. Its engine-rendered form follows the Citation and References Style's bibliography order and Entry Markers. Its minimal form follows first-occurrence order and Reference Numbers when the Pandoc Engine or selected style is unavailable; a rendering failure also shows its error instead of retaining stale formatted entries.
_Avoid_: bibliography sidebar, reference list pane

**Copied Bibliography** _(Obsidian)_:
A complete, error-free point-in-time rendering of the active Markdown file's current Document Citation Set, copied as portable entry-only HTML and plain text for use outside that file. It has no ownership relationship with the Markdown source and does not update after copying; export generates its own bibliography from the Citations in the source.
_Avoid_: inserted bibliography, managed bibliography, bibliography export

**Cited By Sidebar** _(Obsidian)_:
The active-Literature-Note view of every Citation Occurrence in the vault that resolves to the same Item, grouped by citing note. Each citing note contributes the occurrences its own Document Citation Set holds, so the Pandoc Citations and Wikilink Citations choices decide membership here as they do on every other citation-aware surface, and a source change refreshes the view immediately.
_Avoid_: backlinks (Obsidian's view omits literal Pandoc citations), reverse references, incoming citations

**Citation Context** _(Obsidian)_:
The raw source range shown around one Citation Occurrence in the Cited By Sidebar. Its initial range contains every source line spanned by the occurrence, and the user can extend it independently before or after.
_Avoid_: matched line, context preview, source preview

**Citation and References Style**:
The Zotero-installed CSL style used for both Document Citation Text and rendered entries in the References Sidebar. A vault selection supplies the default, and a document's `zotlit-csl` property can select its own installed style by CSL ID. Zotero owns style installation; choosing Default uses the Pandoc Engine's embedded style. An unavailable selected style leaves in-text sources visible and the sidebar minimal, shows a settings warning, and raises one notice per plugin lifecycle with an action that opens the Citations settings.
_Avoid_: citation style (conflicts with the `cite` Template's format), references style (omits in-text Citations), CSL file (names the file, not the selection)

**Resolved CSL Style**:
The standalone CSL file that ZotLit derives from a Zotero-installed Citation and References Style. For an independent style, it contains that style. For a dependent style, it combines the parent style's formatting with the dependent style's default locale. The app, built-in export, and native Pandoc integration use the same resolver; the `zotlit:csl` command materializes a content-addressed file and returns its absolute path.
_Avoid_: parent CSL file (loses the dependent style's locale), exported style (suggests a user-owned copy)

**Citation Locale**:
The locale the CSL processor uses for localized terms, dates, names, and collation in one document. Document Language overrides the vault Citation Locale; Style Default delegates to the selected CSL style, then to the processor fallback. It is independent of Obsidian's interface language and an Item's language.
_Avoid_: citation language, interface language, item language

**Document Language** _(Pandoc)_:
The main language declared by a note's standard Pandoc `lang` metadata, which also supplies its explicit Citation Locale. **Set citation presentation** labels this value **Document language**; choosing **Use vault citation locale and remove document language** removes `lang` and restores the vault Citation Locale for citation processing.
_Avoid_: citation language (names only one effect), ZotLit language

**Citation Presentation**:
The document-specific combination of Citation and References Style and Citation Locale shared by Document Citation Text, the References Sidebar, the Citation Popover, the Copied Bibliography, and the initial built-in export choices. Vault selections supply defaults that `zotlit-csl` and `lang` can override; an invalid document override leaves citation source visible, shows the minimal References Sidebar with a note-scoped error, and keeps bibliography copy unavailable instead of silently falling back.
_Avoid_: citation format (omits references and locale), render settings

**Pandoc Engine**:
The Pandoc WASM binary that formats references and runs the built-in export, pinned per plugin release to one upstream release asset and its SHA-256. A user starts the download from settings; ZotLit verifies the bytes against the pin before they become the cache, stores them uncompressed and content-addressed, and shares them with every vault on the device. Uninstall reaches the whole device. The engine's absence is a normal mode, and its download, checksum, and startup failures each name themselves so one fallback surface guides the user out.
_Avoid_: Pandoc install (Pandoc CLI is a separate, user-owned install), bundled Pandoc (the plugin never ships the binary)

**Embedded Item Data**:
A CSL-JSON snapshot of each cited Item, stored on the Zotero note container's `data-citation-items` attribute at citation-insertion time. The only source for cross-library cites and the fallback when the DB cannot resolve a ref; mapped into the zt item vocabulary by a schema-driven CSL→zt reverse mapping.
_Avoid_: citation map (that's the derived lookup structure)

**Citation Item**:
One cited Item within a Citation, pairing the pure item data with citation-scoped properties: Locator, locator label, suppress-author, prefix, suffix. The citation-scoped properties never live on the item itself. In the cite-template data: `zt.citations` (Citation Items) alongside `zt.items` (the same items, bare).
_Avoid_: cite item, citation entry

**Locator**:
A pinpoint reference within a cited work (CSL locator), e.g. a page number, with an accompanying label naming its kind (`page` by default). An annotation-derived Citation uses the annotation's page label as its Locator — mirroring Zotero's own annotation citations.

### Citation insertion

**Citation Suggester** _(Obsidian)_:
The inline dropdown that searches Zotero Items as the user types a trigger in the editor and, on selection, replaces the typed trigger text with a rendered Citation followed by a single space — primary format by default; a trailing `/` in the query or Shift+Enter selects the secondary format. It remains available independently of the Document Citation Set and In-text Citation Rendering. Distinct from the command-palette insert modal.
_Avoid_: autocomplete, citation picker, editor suggester (names the mechanism, not the feature)

**Bracket Trigger**:
The always-available Citation Suggester trigger: typing `[@` (or `【@`). Its query may contain spaces and is delimited by the closing bracket.
_Avoid_: default trigger

**At Trigger**:
The opt-in Citation Suggester trigger: a bare ASCII `@` typed at a word boundary, never mid-word. Off by default. Having no closing delimiter, its query ends at the first space; an underscore in the query stands for a space in the search.
_Avoid_: mention trigger, @-suggester

**Citekey Editor Treatment** _(Obsidian)_:
The editor surface that In-text Citation Rendering and Citekey Navigation share for literal Pandoc citations. In Live Preview it carries the Citekey Widget while rendering is on; in either editor mode it supplies navigation targets while Citekey Navigation is on. With both choices off, ZotLit adds no visible treatment.
_Avoid_: citekey click, citation click, Citation Key Links (the retired feature it replaces)

**Citekey Widget** _(Obsidian)_:
The Live Preview decoration that replaces a whole literal Pandoc Citation — a Citation Cluster or a bare author-in-text key — with its Document Citation Text. The source stays visible while the Pandoc Engine cannot supply formatted text and whenever the selection touches that citation; the document's other citations keep their formatted text. Source mode always shows the source.
_Avoid_: citation preview, inline render (names the effect, not the decoration)

**Rendered Citation**:
The element a Citation's formatted text is shown in, on either surface that shows one — the Citekey Widget in Live Preview, and the Citekey Reading Rendering's span in reading mode. Both carry the same class and can become Citekey Navigation targets while Open Citations as Links is on.
_Avoid_: citation span, formatted citation (names the text, not the element it sits in)

**In-text Citation Rendering** _(Obsidian)_:
The default-on presentation choice that shows every recognized Citation as a Rendered Citation in Live Preview and reading mode. Turning it off leaves each source in Obsidian's native presentation; Source mode always shows the Markdown source, and the choice does not change citation membership, Citekey Navigation, citation insertion, or built-in Pandoc export. A source excluded from the Document Citation Set, or active under neither rendering nor Citekey Navigation, receives no public ZotLit styling class.
_Avoid_: citation rendering (ambiguous with reference rendering), citation display (does not say formatted or native), editor rendering (also applies to reading mode)

**Document Citation Text**:
The complete formatted text the Pandoc Engine produces for the Document Citation Set. It is produced for the whole document at once because a numbering style counts across the complete set and a position-dependent style renders each Citation Occurrence by its place in the document, so two occurrences of one source can read differently and each in-text surface shows the text of its own occurrence; a surface that cannot tell which occurrence it shows falls back to the source's first-occurrence text. Every in-text surface changes from its native source presentation only after that complete result is ready. A Citation the engine cannot format stays entirely in its source presentation.
_Avoid_: citation cache (names the Citation Index's persistence, not this), rendered bibliography (the References Sidebar's whole-list render)

**Citekey Navigation** _(Obsidian)_:
The interaction surface of recognized literal Pandoc citations across Live Preview, Source mode, and reading mode — selection, click, and the open-under-cursor palette commands, all routed through one flow; what hovering shows belongs to the Hover Action. Open Citations as Links chooses what a plain click does and gates the palette commands; Mod+click always opens. A single-item Citation opens its Literature Note; a multi-item Citation opens an item menu. It is independent of In-text Citation Rendering; a Literature Note wikilink joins the click surface only while it shows a Rendered Citation, and keeps Obsidian's native navigation otherwise.
_Avoid_: citekey click (one gesture of the surface, not the concept), citekey links

**Open Citations as Links** _(Obsidian)_:
The per-vault choice of what a plain click on a Rendered Citation does, for literal Pandoc citations and Wikilink Citations alike: open the Literature Note (on), or — off, the default — place the cursor in the citation's Markdown source in Live Preview and do nothing in reading mode. Mod+click always opens the note; an unrendered citation keeps its surface's native click. Independent of the Hover Action.
_Avoid_: Open Pandoc Citations as Links (the retired Pandoc-only scope), citation click toggle

**Hover Action** _(Obsidian)_:
The per-vault choice of what hovering a recognized citation or Literature Note wikilink shows: Off, Citation Popover (the default), or Page Preview. Off leaves Obsidian's native wikilink hover intact, and Citekey Navigation keeps selection and the open commands — never hover.
_Avoid_: hover mode, popover toggle (a three-way choice, not an on/off)

**Citation Popover** _(Obsidian)_:
The concise hover popover that shows each cited entry's formatted bibliography text — full entries stacked unclipped for a multi-item Citation, formatted note text for a note-class marker — with the three action buttons per entry in a cursor-proximal row. It is one Hover Action choice; the native page preview is another, and hover never shows both.
_Avoid_: concise popover (the working name), hover tooltip, hover card

**Citekey Reading Rendering** _(Obsidian)_:
The reading-mode surface of In-text Citation Rendering for literal Pandoc citations: a Markdown post-processor replaces each complete Citation the source writes — a Citation Cluster or a bare author-in-text key — with its formatted text. When any item in one Citation is unresolved, or the Pandoc Engine cannot supply its formatted text, that whole Citation stays unchanged. Code, math, and links are left alone; a Literature Note wikilink is the Wikilink Reading Rendering's surface, not this one's.
_Avoid_: reading-mode widget (a widget is the Live Preview decoration), citation preview

**Wikilink Editor Treatment** _(Obsidian)_:
The Live Preview surface of In-text Citation Rendering for Wikilink Citations: a Literature Note wikilink shows its Rendered Citation, while drag and conceal interaction stay Obsidian's and click follows Open Citations as Links; hover follows the Hover Action — native under Off and Page Preview, the Citation Popover otherwise. Cursor or selection contact restores the raw text; Source mode always shows raw text.
_Avoid_: wikilink styling (the retired marks-only scope), wikilink conceal

**Wikilink Reading Rendering** _(Obsidian)_:
The reading-mode surface of In-text Citation Rendering for Wikilink Citations: a Literature Note wikilink's display text becomes its Rendered Citation while the link's target stays Obsidian's and click follows Open Citations as Links; hover follows the Hover Action — native under Off and Page Preview, the Citation Popover otherwise. When the Pandoc Engine cannot supply formatted text, the native link stays visible.
_Avoid_: reading-mode wikilink widget (a widget is the Live Preview decoration)

### Index and identity

**Library Scope**:
The set of Libraries used for discovery and unqualified batch operations. It is either All Libraries or a non-empty set of Selected Libraries; unavailable selections remain part of the scope while available Libraries continue to serve discovery.

**Note Index**:
A vault-wide in-memory index mapping `zotero-key` to Literature Notes and `zotero-note-key` to Imported Notes. It also resolves a wikilink linkpath to the Indexed Key of the Literature Note it points at. Metadata-cache changes keep the mappings current, and the Literature Note key set answers the Companion's `GET /literature-notes` note-status query after the first full scan settles.

**Citation Index**:
The plugin-owned, internal vault-wide index of Citation Occurrences across both citation syntaxes — literal Pandoc citations and Literature Note wikilinks. It tracks derived source facts independently of which citation sources the user includes; the Document Citation Set applies those choices for citation-aware consumers. Reset Citation Index remains a Diagnostics recovery action that rebuilds this derived data without changing vault files.
_Avoid_: citation cache (names the persistence, not the index), citation scanner (the per-file parse step, not the index)

**Citekey Resolution Snapshot**:
The Citation Index's point-in-time answer for mapping Citation Keys to Items. Citation Key discovery covers the available Libraries in Library Scope; reverse lookup by exact Indexed Key covers every local Library.
_Avoid_: citekey cache (implies incremental invalidation, not a wholesale rebuild)

**Ambiguous Citation Key**:
A Citation Key that names more than one Item in Library Scope, whether the candidates are in one Library or several Libraries. Distinct from `duplicate-citation-key`, a document-scoped collision among cited works.
_Avoid_: duplicate citation key, citation key conflict

**Citation Occurrence**:
One appearance of a Citation in one file — its syntax kind (literal citekey or wikilink), its raw citekey or linkpath, and its full start–end position. Raw and unresolved by design: what it cites is answered at query time.
_Avoid_: citation instance, match, hit

**Citation Syntax**:
One of the two written forms a citation takes in a note body — a literal Pandoc citation key, or a wikilink to a Literature Note. Every Citation Occurrence has exactly one syntax.
_Avoid_: citation format; citation style (collides with CSL citation styles)

**Omitted Occurrence**:
A Citation Occurrence that stays outside an answer because the Pandoc Citations or Wikilink Citations choice excludes its Citation Syntax. Reporting it is what makes a short answer visible as short: an answer that counts some of a document's citations otherwise reads exactly like one that counts them all.
_Avoid_: skipped citation, filtered occurrence (both name the mechanism, not the fact)

**Document Citation Set**:
The ordered Citation Occurrences one document contributes to ZotLit's Obsidian citation-aware features after the Pandoc Citations and Wikilink Citations choices are applied. An eligible Wikilink Citation is an unaliased Literature Note link with no fragment or a valid Citation Fragment; heading links, block links, and malformed Citation Fragments stay outside the set. The References Sidebar, Cited By Sidebar, In-text Citation Rendering, numbering, and Citekey Navigation all use this same membership and source order. Setting changes recompute it immediately from the internal Citation Index; built-in Pandoc export has its own membership contract.
_Avoid_: citation universe, rendered citations (presentation, not membership)

**Citation Cluster**:
The bracketed literal-citekey syntax `[see @a, p. 3; @b]` — one `;`-separated item per citekey, each carrying an optional prefix and suffix, and `-@` to suppress the author. It is the source text a Citation Index scan and an editor widget both read; the Citation Run is its wikilink counterpart in Pandoc export.
_Avoid_: citation group (names the result, not the source syntax), bracketed citation

**Pandoc Citations**:
The default-on choice to include literal Pandoc citation syntax, such as `@doe2024` and `[@doe2024]`, in the Document Citation Set. Turning it off leaves the source visible and excludes those occurrences from ZotLit's Obsidian citation-aware features without disabling the internal Citation Index or changing citation insertion and export.
_Avoid_: citekey indexing (names an internal mechanism), literal citations (omits the syntax convention)

**Wikilink Citations**:
The default-off choice to include eligible Literature Note wikilinks in the Document Citation Set. Turning it off leaves them as native Obsidian links and excludes them from ZotLit's Obsidian citation-aware features without disabling the internal Citation Index or changing built-in Pandoc export.
_Avoid_: wikilink as citekey (the working name), link citations

### Zotero connection

**Device Override**:
A device-scoped value for the Zotero profile directory or data directory — stored per vault × device, never synced — that overrides ZotLit's automatic Zotero detection (default profile from `profiles.ini`, data directory from `prefs.js`) on that device only. Clearing it returns the device to auto-detection. These two values exist solely as Device Overrides; no synced copy exists.
_Avoid_: local setting ("local" is overloaded: local library, local attachments), per-device setting (implies a category of ordinary settings rather than an override of auto-detection)

**Approved Attachment Root**:
A canonical directory the user permitted on this device as a source for Attachment Import — stored per vault × device, never synced. User-facing copy calls it an "approved folder." Zotero's own storage directory, annotation cache, and configured base attachment directory need no such grant; only an absolute linked file outside those places requires one.
_Avoid_: allowed folder, trusted directory (implies a broader grant than one Attachment Import source), whitelisted path

### Database access

**Read Mode**:
The strategy ZotLit uses to open `zotero.sqlite` while Zotero is running and holds the file exclusively. Configured per vault (synced) as one of four values: Auto, Reflink clone, Full copy, Immutable source. Auto resolves to one of the three concrete modes at runtime.

**Main Identity**:
The identity of one observed state of the main Zotero database file. It combines the file identity and size with the complete SQLite page-1 header, including the change counter that advances on rollback-journal commits.

**WAL Generation**:
The identity of one observed write-ahead log generation. It distinguishes an absent, empty, unstable, or present WAL; a present generation is identified by its WAL header and size. Two source fingerprints match when their path, Main Identity, and WAL Generation match; an unstable generation never matches.

**Reflink Clone** _(Read Mode)_:
Creates a lightweight snapshot of the database files into a temporary directory and opens the snapshot read-only. Sees committed changes that Zotero has not yet written to the main database file. Default on macOS (via `clonefile`); unavailable on filesystems that do not support reflinking.
_Avoid_: copy-on-write clone (user-facing docs avoid this term)

**Full Copy** _(Read Mode)_:
Byte-for-byte copy of the database files into a temporary directory. Same freshness as Reflink clone but slower and uses more disk space, especially with large libraries. Auto never selects this mode; the user must choose it explicitly.
_Avoid_: regular copy, normal copy

**Immutable Source** _(Read Mode)_:
Opens `zotero.sqlite` in place with SQLite's immutable flag. Skips locking and reads committed data only — recent edits not yet written to the main file are invisible until Zotero checkpoints. The fallback when cloning is unavailable; default on Windows and Linux.
_Avoid_: direct read, read-only mode (all modes are read-only)

### Releases and onboarding

**Resource Release**:
The version-matched release that carries downloadable resources outside the plugin bundle: Language Packs and template data JSON Schemas. One exists per plugin release, named for that version, holding assets built from the same commit; the plugin downloads Language Packs at runtime, while agents use CLI guides to download schemas when needed. The installed plugin supplies its matching Pandoc integration files through its own agent and UI surfaces.
_Avoid_: pack release, asset release

**Pandoc Integration Pair**:
The matching, co-located `zotlit-cite.lua` and `zotlit.yaml` files for one installed ZotLit version. ZotLit supplies and replaces them as one exact pair.
_Avoid_: Pandoc bundle, filter files

**Native Pandoc Workflow**:
One local Markdown input converted by a user-installed Pandoc, with the Pandoc Integration Pair resolving Literature Note Citations through a running Obsidian instance.
_Avoid_: external export, CLI export

**Pandoc CLI Guide**:
The agent-facing reference for ZotLit's part of native Pandoc export: obtaining the matching integration files and using the resolver contract. It assumes Pandoc knowledge; general Pandoc setup and usage stay outside ZotLit.
_Avoid_: Pandoc installer, Pandoc setup command

**Welcome View** _(Obsidian)_:
The onboarding tab opened directly in the active leaf on the plugin's first launch in a vault — in its fresh state on a first install, or in its upgraded state when Legacy Data was detected. Combines quick-start steps, live setup actions, a Zotero connection status readout, documentation links, and (in the upgraded state) the Migration Prompt.

**Release Note**:
The per-version changelog page on the docs site (`/changelog/<version>`) surfaced after a plugin update. An update raises a durable notice; the page opens only on user action — in a Web Viewer leaf when available, else the system browser. Authoring the page is part of each release.

**Migration Prompt**:
The prominent banner in the Welcome View's upgraded state pointing a user upgraded from plugin v1 at the migration guide on the docs site. The view re-opens on every launch until the prompt is acknowledged — by opening the guide or explicitly dismissing. The fresh state carries only a quiet footer link to the same guide, for v1 veterans starting a new vault.

**Legacy Data**:
Plugin settings on disk written by ZotLit v1 — recognized by the absence of any settings version marker. Detected once during settings load, then silently migrated to the current shape; its one-launch presence is what distinguishes a v1 upgrader from a fresh install.

### Localization

Message, Message Input, Language Pack, Language Pack Lifecycle, and Locale
Alias use the canonical definitions in
[`@zotlit/obsidian-i18n`](../../packages/obsidian-i18n/CONTEXT.md).

ZotLit configures English as its base locale, excludes `docs_` Messages from
plugin artifacts, maps Obsidian's `zh` Locale Alias to `zh-CN`, and owns its
release locations, consent copy, notices, and settings UI.

### Protocol

**Protocol Action**:
A URL-scheme verb (`obsidian://zotlit/<action>`) sent by the Companion to trigger an operation in Obsidian. Single-item actions: `open` (open or create), `update` (update or create). Batch actions: `update-many`, `import-notes`. Note-import action: `import-note`. Explorer action: `explore` (open the Template Data Explorer at an Item or an Annotation). Long URLs fall back to HTTP PUT on the plugin's local server, which also serves the Companion's `GET /literature-notes` note-status query from the Note Index.
