# Wikilink Resolver and Pandoc Filter Contract

The contract between `zotlit:resolve` (an Obsidian CLI handler) and a Pandoc Lua filter that converts Literature Note wikilinks into Pandoc `Cite` nodes. The CLI handler owns all vault and Zotero knowledge; the filter owns all Pandoc AST knowledge. One CLI call per Pandoc run regardless of document size.

Prior decisions this contract depends on:

- [Choose the bibliography-data boundaries](https://github.com/aidenlx/zotlit/issues/605) — identity split (Indexed Key vs Citation Key), failure boundary, Better BibTeX optional
- [Design the Citation Fragment grammar](https://github.com/aidenlx/zotlit/issues/609) — `#cite:` parameter grammar, Citation Runs, link classification, strict parsing

## CLI Handler: `zotlit:resolve`

### Interface

```
obsidian zotlit:resolve file=<absolute-path>
```

One flag:

| Flag   | Type   | Required | Description                         |
| ------ | ------ | -------- | ----------------------------------- |
| `file` | string | yes      | Absolute path to the Markdown file. |

The handler returns a JSON string. Every response is one of two shapes: a successful resolution or a fatal error.

### Success response

```jsonc
{
  "citations": {
    // bare linkpath (fragment stripped, percent-decoded) → current citation key
    "Doe 2020": "doe2020",
    "Smith 2021": "smith2021a",
    "Papers/Lee 2023": "lee2023"
  }
}
```

Keys are bare linkpaths — the link target with any `#…` fragment stripped, then percent-decoded. Each value is the current Citation Key of the Zotero Item linked through that Literature Note's `zotero-key`.

A link that resolves to a note without `zotero-key` and carries no `#cite:` fragment does not appear. It is not an error — the link is not a citation.

An empty `"citations": {}` is valid: the file contains no Literature Note links.

### Fatal error response

```jsonc
{
  "errors": [
    {
      "code": "item-not-found",
      "linkpath": "Doe 2020",
      "indexedKey": "ABC12345",
      "message": "No live Item matches Indexed Key \"ABC12345\" — the Item may have been deleted from Zotero."
    }
  ]
}
```

Any error stops export. `errors` is never empty when present; `citations` is absent when `errors` is present. The handler collects all discoverable errors rather than stopping at the first.

### Error codes

| Code | Trigger | Message guidance |
| --- | --- | --- |
| `file-not-found` | The absolute path does not resolve to a vault file. | Name the path. |
| `database-unavailable` | `DatabaseService` cannot acquire a read lease. | Name the Zotero data directory and the read mode. |
| `item-not-found` | A `zotero-key` value does not resolve to a live, non-trashed Item. | Name the linkpath and Indexed Key. |
| `citation-key-missing` | An Item exists but has no `citationKey` field value. | Name the linkpath, Indexed Key, and the Item's title for identification. |
| `duplicate-citation-key` | Two distinct Items (different Indexed Keys) resolve to the same Citation Key. | Name both linkpaths, both Indexed Keys, and the shared Citation Key. |
| `unresolved-citation-intent` | A link (not an embed) has a `#cite:` fragment but its bare linkpath does not resolve to a Literature Note (unresolved target, or resolved target lacks `zotero-key`). | Name the linkpath and the fragment. |

### Resolution pipeline

The handler scans only `fileCache.links`. It ignores `embeds` and `frontmatterLinks` — embeds with `#cite:` fragments receive no special handling, and frontmatter links are not relevant to Pandoc export.

```
read file cache from metadataCache
  │
  ├── for each link in fileCache.links:
  │     │
  │     ├── parseLinktext(link.link) → { path, subpath }
  │     │
  │     ├── percent-decode path
  │     │
  │     ├── skip if decoded path already processed
  │     │
  │     ├── getFirstLinkpathDest(path, sourcePath)
  │     │     source-aware: same folder priority, shortest unique path
  │     │
  │     ├── resolved?
  │     │   ├── yes → read frontmatter from target file cache
  │     │   │         has zotero-key?
  │     │   │         ├── yes → queue for DB lookup
  │     │   │         └── no  → has #cite: fragment?
  │     │   │                   ├── yes → error: unresolved-citation-intent
  │     │   │                   └── no  → skip (normal link)
  │     │   └── no  → has #cite: fragment?
  │     │             ├── yes → error: unresolved-citation-intent
  │     │             └── no  → skip (normal link)
  │     │
  │
  ├── acquire database read
  │     failure → error: database-unavailable (all queued links fail)
  │
  ├── for each queued { decodedPath, indexedKey }:
  │     │
  │     ├── resolveIndexedKeyLibrary(client, indexedKey)
  │     │     failure → error: item-not-found
  │     │
  │     ├── getCitekeyByItemKey(client, libraryID, key)
  │     │     null → error: citation-key-missing
  │     │
  │     └── record decodedPath → citationKey
  │
  ├── check for duplicate citation keys across all resolved entries
  │     same citationKey from different indexedKeys → error: duplicate-citation-key
  │
  └── any errors? → return { errors }
      no errors  → return { citations }
```

**`#cite:` detection** uses a prefix check on `subpath`: it matches when `subpath` starts with `#cite:` (case-sensitive). The handler does not parse the fragment parameters — that responsibility belongs to the filter.

**Deduplication**: the same bare linkpath may appear many times in one file. The handler processes each unique decoded bare linkpath once. Two different raw linkpaths that decode to the same string (e.g. `Doe%202020.md` and `Doe 2020.md`) share one map entry.

**Database read**: the handler acquires one read lease via `DatabaseService.acquireRead()`, runs all lookups, then releases it. One lease per invocation.

**Citation Key source**: `getCitekeyByItemKey` reads the `citationKey` field from Zotero's `fieldsCombined`. This single field holds both Zotero 7's native citation key and Better BibTeX's citation key — they share the same storage. No fallback chain or priority between providers.

## Lua Filter: `zotlit-cite.lua`

### Responsibilities

1. Call `zotlit:resolve` once, receive the JSON response.
2. Abort on CLI errors.
3. Walk the document AST and transform Literature Note `Link` nodes into `Cite` nodes.
4. Parse `#cite:` fragments per the agreed grammar.
5. Detect Citation Runs (same-line semicolons).
6. Report fragment parsing errors and invalid Citation Run structures.

The filter does not resolve links, does not read frontmatter, does not query the database. All vault and Zotero knowledge comes from the CLI response.

### Document-level filter

The filter operates as a `Pandoc(doc)` filter — it receives the full document and returns the full document. This is necessary because Citation Run detection requires scanning adjacent inline elements within each `Para` and `Plain` block.

### Link scope

The filter checks all `Link` nodes against the citations map — not only wikilinks. When Obsidian's "Use `[[Wikilinks]]`" setting is disabled, links are written as Markdown links (`[text](note.md)`) and Pandoc produces `Link` nodes without the `wikilink` class. Both forms must resolve.

The `[[@citekey]]` and `[[note|@citekey]]` direct-citation syntaxes from early designs are dropped. Citation identity comes from the resolved Literature Note's `zotero-key`, not from an `@` prefix.

### Link normalization

Both sides percent-decode linkpaths to a common decoded form. Verified behavior:

- **Wikilinks**: Pandoc preserves targets verbatim — `[[Doe 2020]]` → target `Doe 2020`. No encoding, no decoding needed. Spaces, Unicode, parentheses, ampersands all pass through unchanged.
- **Markdown links**: Pandoc percent-encodes spaces — `[text](Doe 2020.md)` → target `Doe%202020.md`. The filter decodes before lookup.

The filter percent-decodes the Pandoc `Link` target, strips the fragment, and looks up the bare decoded linkpath in the `citations` map. The CLI handler percent-decodes its map keys the same way. Both sides use a lenient decoder that only decodes valid `%XX` sequences and preserves malformed percent characters (e.g. `50% Solution` → `50% Solution`).

### Link classification

For each `Link` element in the AST:

```
percent-decode target, strip fragment → bare linkpath
  │
  ├── bare linkpath in citations map?
  │   ├── yes → citation link
  │   │         has #cite: fragment? → parse citation details
  │   │         no fragment?         → normal parenthetical citation
  │   └── no  → has #cite: fragment?
  │             ├── yes → error (safety net; CLI handler should have caught this)
  │             └── no  → leave as link (not a citation)
  │
```

### Citation Fragment parsing

When a Link has a `#cite:` fragment, the filter parses the five named parameters per the grammar from [Design the Citation Fragment grammar](https://github.com/aidenlx/zotlit/issues/609):

- `mode`: `normal` | `author-in-text` | `suppress-author` (default: `normal`)
- `prefix`: percent-decoded plain text
- `label`: one CSL Locator label (requires `locator`)
- `locator`: percent-decoded plain text (omitted `label` means `page`)
- `suffix`: percent-decoded plain text

Parsing is strict. Any of these conditions is a fatal error that stops export:

- Empty fragment after `#cite:`
- Flag without `=`
- Empty value after `=`
- Unknown parameter name
- Duplicate parameter name
- Malformed percent encoding
- Invalid UTF-8 after decoding
- Unsupported `mode` or `label` value
- `label` without `locator`
- `prefix` with `mode=author-in-text`

Each parsing error names the linkpath, the parameter, and the specific problem.

### Citation Run detection

A **Citation Run** is a same-line sequence of two or more citation Links separated only by one literal semicolon and optional ASCII spaces or tabs. The filter detects runs by scanning `Para` and `Plain` inline lists. Since all inline content lives inside `Para` or `Plain` blocks — even inside blockquotes, footnotes, and tables — this covers all document locations.

Verified Pandoc AST patterns:

| Source | Inlines |
| --- | --- |
| `[[A]]; [[B]]` | `Link, Str[;], Space, Link` |
| `[[A]] ; [[B]]` | `Link, Space, Str[;], Space, Link` |
| `[[A]];[[B]]` | `Link, Str[;], Link` |
| `[[A]];\n[[B]]` | `Link, Str[;], SoftBreak, Link` — **not** a run |
| `[[A]], [[B]]` | `Link, Str[,], Space, Link` — **not** a run |

Detection algorithm:

```
scan inlines left to right:
  │
  ├── citation Link found → start or continue a run candidate
  │     │
  │     ├── next inlines are [Space* Str[;] Space* citation-Link]
  │     │   (no SoftBreak or LineBreak allowed)
  │     │   → extend the run
  │     │
  │     └── anything else → end the run (emit if ≥ 2 items)
  │
  ├── non-citation Link in separator position
  │   → break the run (a non-citation link is like any other non-separator token)
  │
  └── non-Link inline → reset
```

A non-citation link (target not in the citations map) breaks the run. The citation links before the break form a run if there are two or more; otherwise each stands alone.

A completed run produces one `Cite` node containing one `Citation` per link in the run. Run items can mix plain links and links with Citation Fragments. The same Literature Note can appear more than once with distinct details.

**Positional constraint**: an `author-in-text` Citation Item can occupy only the first position in a run. An `author-in-text` Item at any other position is a fatal error.

### Cite AST construction

Each citation (standalone or within a run) becomes a Pandoc `Cite` element:

```lua
pandoc.Cite(
  { pandoc.Str("[@" .. key .. "]") },
  { pandoc.Citation(key, mode, prefix_inlines, suffix_inlines, noteNum) }
)
```

For a Citation Run, one `Cite` contains multiple `Citation` entries:

```lua
pandoc.Cite(
  { pandoc.Str("[grouped]") },
  {
    pandoc.Citation(key1, mode1, prefix1, suffix1, 0),
    pandoc.Citation(key2, mode2, prefix2, suffix2, 0),
  }
)
```

The `CitationMode` mapping:

| Fragment `mode` | Pandoc `CitationMode` |
| --- | --- |
| `normal` (or omitted) | `NormalCitation` |
| `author-in-text` | `AuthorInText` |
| `suppress-author` | `SuppressAuthor` |

Locator and label are encoded into `suffix` per Pandoc's citeproc convention: the locator label abbreviation and value prepend the suffix inlines. This follows the same construction verified in the [Citation Fragment grammar prototype](https://github.com/aidenlx/zotlit/issues/609).

### Error handling

The filter aborts the entire Pandoc run on any error — CLI errors, fragment parsing errors, or invalid Citation Run structures. It writes all collected errors to stderr, then calls `error()` to make Pandoc exit non-zero.

Error output format (one line per error, human-readable):

```
zotlit-cite: [code] message
  in: [[linkpath#fragment]]
  at: input.md
```

The filter collects all errors from its AST walk before aborting, so the user sees every problem in one run rather than fixing them one at a time.

## Boundary summary

| Concern | Owner |
| --- | --- |
| Link resolution (shortest path, same-folder priority) | CLI handler (Obsidian `metadataCache`) |
| Frontmatter reading (`zotero-key`) | CLI handler |
| Database lookup (Indexed Key → Citation Key) | CLI handler (`@zotlit/db`) |
| `#cite:` intent detection (prefix check only) | CLI handler |
| Percent-decode map keys | CLI handler |
| `#cite:` fragment parameter parsing | Lua filter |
| Citation Run detection and grouping | Lua filter |
| `Cite` / `Citation` AST construction | Lua filter |
| Duplicate citation key detection | CLI handler |
| Fragment validation errors | Lua filter |
| Percent-decode Pandoc Link targets | Lua filter |

## Invocation

The documented Pandoc command uses `--fail-if-warnings` so bibliography lookup failures also stop export:

```bash
pandoc input.md \
  --from markdown+wikilinks_title_after_pipe \
  --lua-filter zotlit-cite.lua \
  --citeproc \
  --bibliography refs.bib \
  --fail-if-warnings \
  -o output.pdf
```

The filter must appear before `--citeproc` in the filter chain.

## Verified Pandoc behavior

Verified with Pandoc 3.6.4, `markdown+wikilinks_title_after_pipe`:

- **Wikilink targets are verbatim.** Spaces, Unicode (`Müller`), parentheses, ampersands, percent signs — all preserved in `Link.target` without encoding.
- **Markdown link targets encode spaces.** `[text](Doe 2020.md)` → target `Doe%202020.md`. Other special characters preserved.
- **Wikilinks carry `["wikilink"]` class; markdown links carry `[]`.** The filter does not use this for gating — all Links are checked against the map.
- **Fragments stay inside the target string.** `[[Note#cite:locator=33]]` → target `Note#cite:locator=33`. The filter splits on the first `#`.
- **Embeds become `Image` nodes**, not `Link` nodes. The filter never encounters them.
- **Aliases work correctly.** `[[Note|alias]]` → target `Note`, content `alias`. `[alias](Note.md)` → target `Note.md`, content `alias`.
- **`SoftBreak` separates lines.** A semicolon followed by `SoftBreak` does not form a Citation Run.
