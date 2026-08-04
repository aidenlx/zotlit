# Pandoc bibliography-data boundaries

Research question: GitHub issue [#605, “Choose the bibliography-data boundaries”](https://github.com/aidenlx/zotlit/issues/605).

## Decision

Use a deliberate split:

- The **References Sidebar** reads each cited Item from Zotero's local database through `@zotlit/db` (`itemToCsl()`) and converts that Item to CSL JSON in memory. Its internal CSL `id` is the Item's **Indexed Key**. It works while Zotero is closed.
- **Direct Pandoc** reads an external bibliography file the user manages. Each bibliography entry is indexed by the Item's current **Citation Key**. ZotLit resolves a Literature Note from its Indexed Key, reads the current Citation Key from the database, and gives that Citation Key to Pandoc.
- **Better BibTeX is optional** for Direct Pandoc. Better CSL JSON with auto-export is the recommended external source when a user wants an automatically updated file. Zotero's native CSL JSON export is the supported manual source. ZotLit does not create, modify, cache, or merge a Pandoc bibliography file for this path.

Spec [#612](https://github.com/aidenlx/zotlit/issues/612) adds a third
consumer, **built-in export**, alongside these two: a ZotLit-owned command
that resolves bibliographic data live — through Better BibTeX or Zotero's
local HTTP API, never through an external file — and runs the conversion in
the same WASM Pandoc worker the sidebar uses. It has its own identity rule,
distinct from both consumers above; see
[Built-in export](#built-in-export) below and
[the packaging note](./pandoc-integration-packaging-and-installation.md#built-in-wasm-export)
for its full bibliography-source chain.

This split gives the sidebar current local data without an additional plugin or export setup. It also keeps the direct Pandoc contract compatible with Pandoc's normal `--bibliography` boundary. Pandoc accepts CSL JSON, CSL YAML, BibLaTeX, BibTeX, and RIS bibliography files; it does not process citations until bibliographic data is supplied ([Pandoc User's Guide, “Citation rendering” and “Specifying bibliographic data”](https://pandoc.org/MANUAL.html#citations)).

## Identity model

| Name | Meaning | Scope and use |
| --- | --- | --- |
| **Indexed Key** | ZotLit's canonical cross-library identity: the bare Zotero Key for the personal library, or `key + "g" + groupID` for a group library. | Stored as `zotero-key` on a Literature Note. Resolves the authoritative Zotero Item. Deduplicates sidebar references. Serves as the sidebar's internal CSL item `id`. See [`packages/db/CONTEXT.md`](../../packages/db/CONTEXT.md) and [`zt-key.ts`](../../packages/db/src/lib/zt-key.ts). |
| **Citation Key** | The human-readable identifier in Zotero's `citationKey` field, such as `smith2024`. | Written into the Pandoc `Citation` produced from a Literature Note link. It can change independently of the Indexed Key. ZotLit already reads it as a normal Item field and can resolve it from a Zotero Key ([`items.ts`](../../packages/db/src/queries/items.ts), [`citekey.ts`](../../packages/db/src/queries/citekey.ts)). |
| **CSL item `id`** | A required citeproc runtime identifier. Every CSL item the citeproc engine consumes must have an `id` and `type`. | It is a consumer-local identity, not a fixed synonym for a Zotero Key or Citation Key. Use Indexed Key in the sidebar, Citation Key in the Direct Pandoc bibliography, and native citation key or item URI in built-in export — see [Built-in export](#built-in-export). The sidebar's engine is now the Pandoc WASM build's own citeproc, not citeproc-js; see [the standalone CSL rendering architecture note](./standalone-csl-rendering-architecture.md). |
| **Bibliography lookup identity** | The string by which a Pandoc citation finds an external bibliography entry. | For Direct Pandoc, it is the current Citation Key. A CSL JSON entry therefore needs `id = Citation Key`. Pandoc's own CSL YAML example uses the citation identifier as the reference `id` ([Pandoc User's Guide](https://pandoc.org/MANUAL.html#specifying-bibliographic-data)). Built-in export instead joins by Zotero item key and accepts native citation key or item URI as the item's `id`; it never reads an external bibliography file. |

The sidebar must not use Citation Key as entity identity. Better BibTeX generates unique keys within each library by default, with global uniqueness as a separate option ([Better BibTeX preferences, “Keeping citation keys unique”](https://retorque.re/zotero-better-bibtex/index.print.html#keeping-citation-keys-unique)). Two libraries can therefore contain the same Citation Key. Indexed Key remains unambiguous across ZotLit's supported libraries.

For direct Pandoc, the external files form one lookup namespace. Users who cite across libraries must keep Citation Keys unique across every bibliography file used in one invocation. The resolver can detect duplicate current Citation Keys among the Literature Note Citations in the input and stop before it emits an ambiguous Pandoc AST. It cannot detect an uncited duplicate that exists only inside a bibliography file, because that file stays outside ZotLit's boundary.

## Consumer contracts

### References Sidebar

**Input and conversion.** Resolve each body wikilink to a Literature Note, read its `zotero-key`, resolve the Indexed Key to one live Item, then convert that database Item to the CSL JSON object supplied to citeproc-js. Keep the Indexed Key as the reference identity from document scan through `retrieveItem()`.

ZotLit's database layer already returns the full non-child Item field set, creators, library identity, Citation Key, and `dateModified` ([`items.ts`](../../packages/db/src/queries/items.ts)). It also already derives its CSL type, text-field, and creator mappings from the vendored Zotero schema ([`packages/zotero-types/src/csl.ts`](../../packages/zotero-types/src/csl.ts), generated from [`schema.json`](../../packages/zotero-types/zotero-schema/schema.json)). The new forward adapter should use the same schema as its mapping authority.

Zotero's own `itemToCSLJSON` is the behavioral reference for the adapter. It maps the item type, selects the first applicable text field, groups creators by CSL name variable, and converts dates; it also has special behavior for Extra, ISBN, creator particles, and event place ([Zotero Utilities `itemToCSLJSON`](https://github.com/zotero/utilities/blob/1dd38e27edf81e9d9c4161c957b7efb7f5681ac3/utilities_item.js#L45-L242)). Generate the ordinary mappings from Zotero's schema and cover Zotero's special cases with explicit tests. The existing `cslToTemplateItem` is a reverse adapter for embedded snapshots; it is useful mapping evidence, but it does not implement this forward boundary ([`zt-csl.ts`](../../packages/db/src/lib/context/zt-csl.ts)).

**Freshness.** Read from the current `DatabaseService` snapshot when the sidebar refreshes. ZotLit's clone read modes include Zotero's live WAL, and the service watches the database and WAL, swaps to a new read snapshot, and emits `changed` after a successful refresh ([`read-source.ts`](../../apps/obsidian/src/services/database/read-source.ts), [`database/service.ts`](../../apps/obsidian/src/services/database/service.ts)). The sidebar must subscribe to that `changed` event and re-resolve the active document. With automatic database refresh disabled, a user-initiated database refresh is the freshness boundary.

Do not persist converted CSL items as a second bibliography cache. A short-lived render cache may be keyed by `(Indexed Key, dateModified, adapter version)` and must be cleared on database `changed`, style, or locale changes.

**Failure behavior.** Keep every discovered Literature Note Citation visible in Reference Number order. Show a specific entry error when:

- the database is unavailable;
- the Indexed Key is invalid or its library cannot be resolved;
- the Item is absent or deleted;
- the Item has no Citation Key, which makes the direct Pandoc workflow invalid;
- the adapter cannot produce the required CSL `type` and `id`; or
- citeproc-js cannot render the item with the selected style or locale.

A failed entry must not reuse an earlier formatted value as if it were current. Other valid entries can continue to render. A missing Citation Key may still allow an item-data preview, but the entry remains in an export-blocking error state.

### Direct Pandoc

**Input and lookup.** ZotLit supplies only the current Citation Key in the Pandoc `Citation`. Pandoc supplies citation rendering and bibliography lookup from the user's external file. CSL JSON is the preferred format because it avoids a BibTeX-to-CSL conversion; Better BibTeX documents the field-model and title-casing loss that this extra conversion can introduce ([Better BibTeX, “Use CSL, not bibtex with pandoc”](https://retorque.re/zotero-better-bibtex/exporting/pandoc/)).

Both supported CSL JSON exporters create the required lookup identity:

- Zotero's native CSL JSON translator converts an Item with `itemToCSLJSON` and replaces the CSL `id` with `item.citationKey` when the key is present ([Zotero `CSL JSON.js`](https://github.com/zotero/translators/blob/2c0cdea8f9d5d4b8abd6282d0e67d42f4bd8e6c8/CSL%20JSON.js#L154-L167)). Without a Citation Key, its original URI-shaped `id` remains and a Citation-Key lookup cannot match it.
- Better CSL JSON writes both `citation-key` and `id` from `item.citationKey` ([Better BibTeX `translators/csl/csl.ts`](https://github.com/retorquere/zotero-better-bibtex/blob/95662bf83617ba82f5f62aa494181f5f4cb3cfb4/translators/csl/csl.ts#L80-L124)).

**Freshness.** The two supported source modes have different promises:

- **Better CSL JSON auto-export:** checking **Keep updated** registers an export. Item changes schedule a new file export. The default mode is **On Change**, with a default five-second delay that combines bursts ([Better BibTeX, “Automatic export”](https://retorque.re/zotero-better-bibtex/index.print.html#automatic-export)). The file stays usable after Zotero closes. Its freshness is the last successful auto-export.
- **Native Zotero CSL JSON export:** this is a point-in-time file created by **Export Library**, **Export Collection**, or **Export Items** ([Zotero, “How do I export my Zotero library?”](https://www.zotero.org/support/kb/exporting)). Its freshness is the last manual export. The tutorial must tell the user to export again after Item metadata or Citation Key changes.

Zotero 8 stores Citation Keys in Zotero itself. Better BibTeX now reads and can fill the native field; the keys sync even when Better BibTeX is absent ([Better BibTeX Zotero 8 notice](https://retorque.re/zotero-better-bibtex/index.print.html#notice)). Better BibTeX therefore improves external-file automation and key generation. It is not the owner of Citation Key identity and is not a ZotLit runtime requirement.

**Failure behavior.** The ZotLit resolver stops before Pandoc when the database is unavailable, a Literature Note has an invalid or unresolved Indexed Key, the Item is absent, the current Citation Key is empty, or two cited Items resolve to the same Citation Key. Wikilinks to ordinary notes remain links.

Pandoc owns external-file failures. A missing or unreadable bibliography file is a Pandoc input error. A Citation Key that has no matching bibliography `id` produces a citeproc warning and a bold `key?` placeholder in the citeproc implementation ([jgm/citeproc `Eval.hs`](https://github.com/jgm/citeproc/blob/c345fafc3d1c51a116dd8b2ec6bfc9fd2fbd1ff4/src/Citeproc/Eval.hs#L1289-L1296)). The documented direct command and defaults file should set `--fail-if-warnings`, which makes Pandoc exit with an error status for any warning ([Pandoc User's Guide](https://pandoc.org/MANUAL.html#option--fail-if-warnings)).

This detects a missing or renamed key. It cannot detect metadata staleness when the old file still has the same `id`. The tutorial must make “update the bibliography file, then run Pandoc” an explicit verification step. ZotLit must not report an external file as fresh because it does not own or inspect that file.

### Built-in export

**Input and lookup.** Built-in export does not read from `@zotlit/db` or
`itemToCsl()` at all — that adapter is Sidebar-only. It resolves
bibliographic data live through Better BibTeX (JSON-RPC `item.citationkey`
plus `item.export` with the Better CSL JSON translator) when Better BibTeX is
alive, otherwise through Zotero's local HTTP API
(`GET /api/users/0/items?itemKey=...&include=csljson`), otherwise a guided
error. Nothing in this chain works with Zotero closed; that is an error
state for this consumer, unlike the Sidebar. The full chain, including the
local-API preference detection and enable prompt, is decided in
[the packaging note](./pandoc-integration-packaging-and-installation.md#built-in-wasm-export).

**Identity.** Results are re-indexed by Zotero item key, not by Citation
Key. Each wikilink cites whatever CSL `id` the resolved item carries: its
native Zotero citation key when populated, or its item URI otherwise. This
is a deliberately looser rule than Direct Pandoc's, which requires a
populated Citation Key and fails closed with `citation-key-missing`
otherwise — built-in export instead falls back to the item URI so an
uncited-key Item can still be exported by wikilink. The literal `@citekey`
syntax is the one case that still requires a populated Citation Key, because
that syntax names the key directly.

**Failure behavior.** Any unresolvable citekey or missing item stops the
export; built-in export is all-or-nothing, like the References Sidebar's
resolver stage, but unlike Direct Pandoc, which only stops what ZotLit's own
resolver can detect and otherwise hands the failure to Pandoc's own
`--fail-if-warnings` check against the external file.

## Candidate assessment

| Candidate | References Sidebar | Direct Pandoc | Decision |
| --- | --- | --- | --- |
| Better CSL JSON export for both | Adds Better BibTeX and file-path setup to the sidebar. Data can lag the database or remain at the last successful export. It makes sidebar identity vulnerable to cross-library Citation Key collisions. | Strong option: Pandoc-compatible CSL JSON, Citation-Key `id`, and automatic export. | Use for direct Pandoc when installed. Do not use as the sidebar's data source. |
| Native Zotero export for both | Adds manual file setup and a point-in-time snapshot. It cannot satisfy a current-data sidebar contract. | Supported baseline: native CSL JSON uses Citation Key as `id` when present. User re-exports after changes. | Use as the manual direct-Pandoc source. Do not use as the sidebar's data source. |
| ZotLit DB-to-CSL for both | Best sidebar freshness and Indexed Key identity. | Conflicts with issue #603's external-bibliography boundary. It would make ZotLit own export format, file freshness, coverage, and compatibility. | Use only inside the sidebar. |
| Deliberate combination | Live DB-to-CSL with Indexed Key identity. | External Citation-Key-indexed bibliography from Better BibTeX auto-export or native Zotero manual export. | **Selected.** |

## Implementation consequences

1. Add one Zotero-Item-to-CSL adapter under `packages/db`. Generate its normal mapping tables from the vendored Zotero schema and test the Zotero Utilities special cases used by supported Item types.
2. Give the sidebar's citeproc system `retrieveItem(indexedKey)` and return an object with `id: indexedKey`.
3. Subscribe the sidebar item store to `DatabaseService` `changed`; invalidate on active-file, document metadata, style, and locale changes as well.
4. Keep the direct resolver output small: Indexed Key resolution, current Citation Key, collision checks, and Pandoc Citation construction. Keep bibliography data outside the CLI response.
5. Document Better CSL JSON auto-export as the recommended setup and native CSL JSON as the manual setup. Include `--fail-if-warnings` in the supplied Pandoc command/defaults.
6. Add acceptance cases for a renamed Citation Key, changed title with the same key, deleted Item, missing key, group-library collision, paused/stale auto-export, and native manual export that is older than the database.
