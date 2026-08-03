# Standalone CSL rendering architecture

Research question: GitHub issue [Choose the standalone CSL rendering architecture](https://github.com/aidenlx/zotlit/issues/606).

## Decision

Add one deep Obsidian-side CSL module. Its interface lists the installed styles,
refreshes one immutable resource snapshot, and renders the active document's
references. Its implementation owns Zotero resource discovery, dependent-style
resolution, locale selection, citeproc-js, structured output, and the minimal
fallback.

The References Sidebar works while Zotero is closed. It uses:

- current Zotero Items from `@zotlit/db`;
- CSL styles that Zotero installed in its data directory;
- CSL locale files from the Zotero application archive; and
- citeproc-js distributed with ZotLit under CPAL.

ZotLit bundles no CSL styles, locale files, or rename map. It does not read
Zotero Quick Copy. The user selects one installed style in ZotLit. The default
style ID is
`http://www.zotero.org/styles/chicago-shortened-notes-bibliography`, Zotero's
own Quick Copy default.

When the selected style, its independent parent, or its required locale is
missing or invalid, or when the style has no bibliography layout, the Sidebar
shows one error callout followed by a safe minimal list. Each entry has the
form `Creator (Year). Title.` and omits unavailable parts cleanly. The callout
directs the user to References settings.

## Runtime flow

```text
active Markdown document
  -> distinct Literature Note Citations in first-occurrence order
  -> one DatabaseService read lease
  -> resolve each Indexed Key and load the live Zotero Item
  -> convert each Item to CSL Item Data in memory
  -> CslService.render(style ID, items, Obsidian locale)
       -> read the current immutable CSL resource snapshot
       -> load the selected style and any installed parent
       -> resolve style locale, then Obsidian locale, then en-US
       -> create one fresh citeproc-js engine
       -> updateItems(all valid Indexed Keys)
       -> makeBibliography()
       -> structured HTML entries + identities + layout metadata
  -> sanitize citeproc HTML with Obsidian
  -> render in CSL order with Reference Number navigation badges
```

Reference Numbers remain active-document identities assigned by first
occurrence. They do not determine bibliography order. citeproc-js owns sorting,
numbering, disambiguation, and subsequent-author substitution.

## Module and ownership

`CslService` is the external seam. Callers do not coordinate style files,
locale archives, processor state, caching, or fallback rules themselves. Its
small interface provides these operations:

- return the visible styles in the current resource snapshot;
- explicitly refresh the resource snapshot; and
- render one complete active-document reference set.

The module returns a discriminated result:

- a structured CSL bibliography;
- the minimal fallback with one resource error; or
- per-reference Item errors alongside the valid result.

`DatabaseService` remains the only owner of database snapshot freshness. The
References Sidebar owns the active-document scan and subscribes to successful
database changes. The existing Zotero location module stores and resolves the
profile, data, and application Device Overrides. `CslService` consumes the
resolved data and application locations.

## Item retrieval and conversion

Acquire one [`DatabaseService.acquireRead()`](../../apps/obsidian/src/services/database/service.ts)
lease for the complete Item load. A lease pins one database client, so a
database refresh cannot mix two snapshots inside one bibliography. For each
distinct Indexed Key:

1. Call [`resolveIndexedKeyLibrary()`](../../packages/db/src/lib/zt-key.ts).
2. Call [`getItemsByKey()`](../../packages/db/src/queries/items.ts) with the
   resolved library and bare Zotero key.
3. Convert the Item before the lease ends.

Use the Indexed Key as the CSL item `id`. It stays unique across personal and
group libraries. Citation Key remains the separate Pandoc bibliography lookup
identity selected in [Choose the bibliography-data boundaries](./pandoc-bibliography-data-boundaries.md).

Put the forward Item-to-CSL adapter in `packages/db`. Generate the ordinary
type, text-field, creator, and date maps from Zotero's vendored schema. Match
Zotero's full `itemToCSLJSON()` behavior, including:

- ordered text-field candidates and all type alternatives;
- creator grouping, literal names, and name particles;
- parsed and literal dates;
- the first valid ISBN;
- normalized CSL fields from Extra;
- one pair of enclosing double quotes removed from text;
- `event-place` for audio recordings, presentations, and video recordings;
- the export-format version field; and
- Zotero's default journal-article URL rule.

Zotero's implementation is the behavioral reference ([Zotero Utilities
`itemToCSLJSON`](https://github.com/zotero/utilities/blob/1dd38e27edf81e9d9c4161c957b7efb7f5681ac3/utilities_item.js#L45-L239),
[`extraToCSL`](https://github.com/zotero/utilities/blob/1dd38e27edf81e9d9c4161c957b7efb7f5681ac3/utilities_item.js#L656-L770)).
The current reverse adapter,
[`zt-csl.ts`](../../packages/db/src/lib/context/zt-csl.ts), is mapping evidence
but is not the forward adapter.

Invalid, unresolved, missing, or unconvertible Items remain visible as
per-reference errors. Other valid Items continue to render.

## Style discovery and selection

Index CSL files by their `<info><id>`, not by filename, from:

```text
<Zotero data directory>/styles/*.csl
<Zotero data directory>/styles/hidden/*.csl
```

Zotero reads the same visible and hidden directories ([Zotero 8 style
initialization](https://github.com/zotero/zotero/blob/8.0.5/chrome/content/zotero/xpcom/style.js#L94-L155)).
The settings selector shows visible styles only. Hidden styles remain available
as independent parents.

Zotero copies its bundled styles into the data directory during its bundled-file
update. This includes
`chicago-shortened-notes-bibliography.csl` ([Zotero bundled-file updater](https://github.com/zotero/zotero/blob/8.0.5/chrome/content/zotero/xpcom/schema.js#L960-L1052),
[archive extraction](https://github.com/zotero/zotero/blob/8.0.5/chrome/content/zotero/xpcom/schema.js#L1297-L1325)).
An incomplete first Zotero launch can leave the default absent; the agreed
fallback covers that state.

A dependent style contains metadata and an `independent-parent` link. Resolve
that link by CSL ID across both visible and hidden directories. Give the parent
XML to citeproc-js while retaining the dependent style as the selected identity.
A missing parent is a resource error. ZotLit does not download or install the
parent because Zotero remains the style manager.

Keep a removed or renamed selected ID as an unavailable selection. Show the
fallback and let the user choose the installed replacement. ZotLit does not
bundle or emulate Zotero's renamed-style map.

## Locale resources and selection

There is no References locale setting. Resolve the effective locale in this
order:

1. dependent style `default-locale`;
2. parent or independent style `default-locale`;
3. the current Obsidian locale;
4. the closest available dialect; and
5. `en-US`.

This matches Zotero's rule that a style's effective locale disables the user
locale choice; otherwise Zotero uses the preferred locale or application locale
([Zotero locale selection](https://github.com/zotero/zotero/blob/8.0.5/chrome/content/zotero/xpcom/style.js#L588-L643)).

Zotero stores `locales.json` and `locales-<locale>.xml` as ZIP entries in
`<Zotero application root>/app/omni.ja`, not in the data directory:

```text
chrome/content/zotero/locale/csl/locales.json
chrome/content/zotero/locale/csl/locales-<locale>.xml
```

Zotero reads these resources synchronously for citeproc
([locale retrieval](https://github.com/zotero/zotero/blob/8.0.5/chrome/content/zotero/xpcom/cite.js#L681-L719)).
All files remain readable while Zotero is closed.

Add a device-scoped Zotero application location alongside the existing profile
and data-directory Device Overrides. Detect standard installations first. The
override is necessary because a macOS application can move, Windows accepts a
custom install directory, and Linux has no fixed extraction directory. The
user selects the Zotero application folder, not `omni.ja`.

If the application or required archive entry cannot be read, return the
resource error and minimal fallback. ZotLit does not download locale data.

## citeproc-js adapter

Use the CommonJS `citeproc` package in `apps/obsidian`. Its processor callbacks
are synchronous. Complete all database and filesystem work before engine
construction, then supply in-memory maps:

```ts
const sys = {
  retrieveItem: (id: string) => itemsByIndexedKey.get(id),
  retrieveLocale: (locale: string) => localeXmlByCode.get(locale) ?? false,
};
```

Every returned item contains `id` and `type`. Call `updateItems()` once with all
valid Indexed Keys and `makeBibliography()` once. The citeproc-js documentation
defines these callbacks and registry operations ([Running the Processor](https://citeproc-js.readthedocs.io/en/latest/running.html)).

Create a fresh engine for each complete Sidebar render. citeproc-js engines are
stateful, and Zotero rebuilds processor state when it reuses one ([Zotero style
engine cache](https://github.com/zotero/zotero/blob/8.0.5/chrome/content/zotero/xpcom/style.js#L755-L795)).
Fresh construction is the smaller first-version correctness rule.

Match Zotero's relevant compatibility switches:

- HTML output;
- URL and DOI link wrapping;
- pre-parsed name handling; and
- subtitle capitalization compatibility for the style IDs Zotero special-cases.

## Bibliography output and fallback

Return citeproc output as structured data:

```ts
interface BibliographyRender {
  kind: "bibliography";
  entries: readonly {
    html: string;
    indexedKeys: readonly string[];
  }[];
  layout: {
    maxOffset: number;
    entrySpacing: number;
    lineSpacing: number;
    hangingIndent: boolean;
    secondFieldAlign: false | "flush" | "margin";
  };
}
```

Retain citeproc's entry order and `entry_ids`. Do not reorder rendered entries
into Reference Number order: that can invalidate style sorting, numeric labels,
disambiguation, and subsequent-author substitution. The Sidebar maps each entry
back to its Reference Number only for navigation.

If the independent style has no `cs:bibliography`, do not synthesize a
bibliography from citation output. Return the same resource-error result used
for missing or corrupt CSL resources, with the minimal list and a prompt to
select another style.

## HTML safety and Sidebar typography

Treat style output and Item metadata as untrusted HTML. Pass every citeproc HTML
fragment through Obsidian's `sanitizeHTMLToDom()`. ZotLit already wraps that
function in [`useSanitizedHtml()`](../../apps/obsidian/src/lib/sanitize-html.ts).
Do not pass citeproc output through `MarkdownRenderer`.

Typography is Tailwind-first:

- add `zt-root` to the Item View container;
- use `zt:` utilities backed by Obsidian semantic tokens;
- use the theme text font and `--sidebar-markdown-font-size`;
- normalize line height, entry spacing, outer margins, link colors, wrapping,
  width, and overflow for the narrow Sidebar;
- preserve emphasis, superscript, subscript, small caps, hanging indents,
  aligned fields, and other CSL semantics; and
- use one low-specificity `.zt-ref-bibliography` scope only for citeproc's
  generated structural classes that cannot receive utility classes directly.

Use no hardcoded colors and no `!important`. The References Sidebar prototype
selects the final spacing and type scale.

## Cache and refresh

Cache one immutable CSL resource snapshot containing:

- installed style metadata;
- selected and parent style XML;
- available locale metadata; and
- loaded locale XML keyed by locale code.

Keep converted Items, rendered HTML, fallback output, and citeproc engine state
inside one render. There is no persistent bibliography cache and no processor
reuse.

Load the initial snapshot when ZotLit starts. After startup, resource changes
apply only when the user runs **Refresh citation resources**. Opening References
settings, changing a setting, and filesystem changes do not scan Zotero
automatically. The explicit refresh reads the current Device Overrides, style
directories, and application archive, then atomically replaces the snapshot.

If refresh finds a removed, corrupt, or incomplete resource, the new snapshot
contains that current error. Do not retain and display the old resource as if it
were current. The Sidebar rerenders to the error callout and minimal list.

Database and active-document changes remain automatic because they change Items
and Citations, not CSL resources. Use a render generation token so a late render
cannot replace a newer active-document result.

## License and distribution

citeproc-js grants a choice of CPAL 1.0-or-later or AGPL 3.0-or-later
([repository license](https://github.com/Juris-M/citeproc-js/blob/master/LICENSE),
[built-file header](https://github.com/Juris-M/citeproc-js/blob/master/citeproc_commonjs.js#L1-L20)).
Use the CPAL route. ZotLit remains MIT; citeproc-js remains CPAL inside the
larger work.

The release must:

- include the full CPAL text and preserve upstream notices;
- identify where the corresponding citeproc-js source is available;
- record the bundled transformation and its date;
- identify Frank Bennett as the Initial Developer; and
- display the CPAL Exhibit B attribution prominently for each application
  launch or session.

Use a persistent References Sidebar attribution footer with:

```text
(c) Frank Bennett
citeproc-js implements the Citation Style Language
https://citationstyles.org/
```

The full customized terms are in citeproc-js's [CPAL file](https://github.com/Juris-M/citeproc-js/blob/master/CPAL).
The npm archive omits that full text, so ZotLit must add it explicitly. This is
a source-based compliance plan, not legal advice.

## Disclosure and documentation

Broaden the root README **Disclosures** callout. Explain that ZotLit reads:

- installed CSL styles from the Zotero data directory; and
- CSL locale metadata and files from the Zotero application installation.

State that these reads are local and read-only, support References Sidebar
formatting while Zotero is closed, do not modify Zotero, and do not send these
files elsewhere. This is a disclosure, not a new consent gate.

Add the following documentation:

- a References section in the settings reference;
- an OS-specific how-to for automatic application detection and the Zotero
  application location Device Override;
- instructions to select the Zotero application folder rather than `omni.ja`;
- the explicit refresh workflow after installing, updating, or removing a
  style or changing an override; and
- troubleshooting for missing Chicago, missing parents, unreadable `omni.ja`,
  unavailable locales, corrupt styles, and styles without bibliographies.

## Alternatives assessed

| Alternative | Result |
| --- | --- |
| Follow Zotero Quick Copy | Adds preference parsing, refresh ownership, non-CSL states, and fallback precedence. Use one explicit ZotLit style setting instead. |
| Bundle Chicago, APA, locales, or the rename map | Makes ZotLit a second CSL asset distributor and updater. Read the assets Zotero already owns. |
| Add a References locale setting | Quick Copy needs an export-language control; the Sidebar is an inspection view. Use style locale, then Obsidian locale. |
| Watch style and application files | Adds platform-specific watcher, replacement, debounce, and disposal behavior. Use explicit refresh. |
| Cache a citeproc engine or rendered entries | Adds state-reset and complete semantic cache-key rules. Use a fresh engine and current Items. |
| Reorder CSL entries into Reference Number order | Can invalidate the selected style. Preserve CSL order and show Reference Numbers as navigation badges. |
| Use citation previews when a style lacks a bibliography | Hides that the selected style cannot fulfill the Sidebar contract. Show the explicit fallback and let the user change style. |
| Ask running Zotero to format | Breaks the Zotero-closed requirement. |
| Use installed Pandoc as the Sidebar processor | Adds an external executable and subprocess boundary. |

## Implementation consequences

1. Extend the Zotero schema generator and add the forward Item-to-CSL adapter
   in `packages/db`.
2. Add citeproc-js and its narrow local types to `apps/obsidian`, with CPAL
   notices, corresponding-source handling, and Sidebar attribution.
3. Extend device-local Zotero path storage and detection with the application
   location. Keep it outside synced settings.
4. Add ZIP-entry reading for `app/omni.ja`; load locale metadata and XML without
   extracting or modifying the application.
5. Add the deep `CslService`, immutable resource snapshot, explicit refresh,
   dependent-parent resolution, locale resolution, fresh-engine rendering, and
   minimal fallback.
6. Add the References style setting and visible installed-style selector. Use
   Chicago shortened notes and bibliography as the default ID.
7. Return structured sanitized output, retain CSL order, and map entries to
   Reference Number navigation badges.
8. Apply Tailwind-first Sidebar typography and narrow scoped rules for generated
   citeproc structure.
9. Extend the README Disclosure and add the settings reference, application
   location how-to, refresh instructions, and troubleshooting.
10. Verify adapter parity, style and parent discovery, locale fallback,
    resource failure, explicit refresh, sanitization, CPAL packaging, and stale
    render rejection in the implementation acceptance suite.
