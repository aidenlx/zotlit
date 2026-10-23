# Indexing Durable Annotation Links: can Obsidian's metadata cache carry them?

Source study and runtime test, 2026-10-23. It records what Obsidian's own
source does with `zotero://` Markdown links, what a runtime probe in a
fixture vault returned, and how ZotLit's Citation Index parses and indexes
today. It lists the options for extending the Citation Index to every Durable
Annotation Link in the vault, with their costs. It makes no recommendation.

The links under study are Durable Annotation Links
(`apps/obsidian/GLOSSARY.md:355`) in three written forms:

```md
[p. 42](zotero://open/library/items/ATTKEY01?annotation=ANNKEY01&page=42)
[](zotero://open/library/items/ATTKEY01?annotation=ANNKEY01&page=42)
![](zotero://open/library/items/ATTKEY01?annotation=ANNKEY01&page=42)
```

## Sources and version

- **Runtime:** Obsidian **1.14.4** (installer 1.14.4). This is also the
  `obsidian` package version that `apps/obsidian` resolves, so the
  extracted source and `obsidian.d.ts` line up.
- **Extracted source:** `obsidian-1.14.4.asar` from
  `~/Library/Application Support/obsidian/`, extracted with the
  `obsidian-asar-extract` skill into `node_modules/.ob-rev-1.14.4/`. In this
  report, `worker.js:N` and `app.js:N` are line numbers in that formatted
  output (oxfmt). Minified names such as `y`, `xr` and `Im` belong to 1.14.4
  only and change between versions.
- **History check:** `worker.js` from the GitHub release archives
  `obsidian-0.12.19.asar` and `obsidian-1.0.0.asar`, read raw (minified),
  plus the already-extracted `.ob-rev-1.13.7` and `.ob-rev-1.14.2`.
- **Type definitions:** `node_modules/obsidian/obsidian.d.ts` (1.14.4).
- **Runtime probe:** two scratch notes created and deleted through the
  Obsidian CLI in the fixture Development Vault
  `tests/fixture-vault-zotlit-v2` (vault id `bc97301e8da3ed6c`). Before the
  probe, `app.vault.adapter.basePath` confirmed this was that fixture vault
  and not a personal vault. Each probe ends with `deleted: true`.
- **ZotLit:** `origin/next` at `5bfdc4d92`.
- **Community:** a web search of the Obsidian forum and developer docs found
  no thread or doc page saying whether external URLs appear in
  `CachedMetadata.links`. The developer docs describe `links` with a
  `[alias](markdown-link)` example and say nothing about schemes. Primary
  source and the runtime probe answer the question here; no web source
  contradicts them.

## 1. Can Obsidian's own index be reused?

### 1a. The filter is the URL scheme, not the link form

The metadata worker builds `links` and `embeds` from two node types,
`ilink` and `iembed`. A standard Markdown link or image becomes one of them
only if a transformer converts it, and both transformers first ask one
predicate (`worker.js:7770–7772`):

```js
function y(e) {
  return !(!e.startsWith("./") && !e.startsWith("../")) || -1 === e.indexOf(":");
}
```

A URL counts as internal if it starts with `./` or `../`, or if it contains
no `:` at all. `zotero://open/…` contains a `:`, so it is never converted:

- `link` → `ilink` transformer: `worker.js:13407–13440` (`if (r && y(r))`).
- `image` → `iembed` transformer: `worker.js:13441–13469` (same test).
- Frontmatter: `xr()` (`worker.js:13914–13937`) matches a string property
  against the Markdown-link pattern `wr` (`worker.js:13912–13913`) and
  pushes it to `frontmatterLinks` only if `y(u)` holds.

The empty-text `[](…)` form and the `![](…)` embed form are therefore not
the problem. Probe 2 shows `[](./Local.md)` recorded in `links` with
`displayText: ""` and `![](./Local.md)` recorded in `embeds`. With a
`zotero:` URL, neither is recorded.

The same predicate appears in `worker.js` of 0.12.19 (as `rn`) and 1.0.0
(as `vn`), byte for byte, and in 1.13.7 and 1.14.2. **External links have
been dropped since at least 0.12.19, the earliest version checked.** Neither
0.12.19 nor 1.0.0 has `frontmatterLinks` at all (the identifier does not
occur in their `worker.js`). It arrived later, and when it did, it used the
same predicate.

### 1b. What lands in the cache for links that do get recorded

From the result-building pass (`worker.js:14066–14083`):

| Field | Source |
| --- | --- |
| `position` | the node's start and end `{line, col, offset}`, zero-based (`kr`, `worker.js:13909`) |
| `link` | `href`: `decodeURI(url)`, then NBSP→space, trimmed, NFC (`b`, `worker.js:7774`). Any `?query` or `#fragment` stays in the string |
| `original` | the exact source slice `e.substring(start.offset, end.offset)` |
| `displayText` | the link's title, or the visible text of its children (`vr`) for a converted Markdown link; `""` for `[](…)` |

`resolvedLinks` and `unresolvedLinks` key by `zm(link)`, the link with
everything from `#` onward removed (`app.js:42701–42704`, used in
`resolveLinks`, `app.js:91633–91651`). A `?` is not cut. These maps hold
counts per target, not positions.

None of this applies to `zotero://` links, because they never reach it.

### 1c. Runtime probe

Probe 1 wrote one note with every form. The URL was
`zotero://open/library/items/ATTKEY01?annotation=ANNKEY01&page=42`. The note
also held controls: a wikilink, a relative Markdown link, an image embed, and
an `https://` link. Abridged output:

```json
{
  "version": "1.14.4",
  "changedEventFired": true,
  "links": [
    { "link": "Some Note", "original": "[[Some Note]]", "displayText": "Some Note" },
    { "link": "./Local Note.md", "original": "[local](./Local%20Note.md)", "displayText": "local" }
  ],
  "embeds": [{ "link": "img.png", "original": "![[img.png]]" }],
  "frontmatterLinks": [
    { "key": "wiki", "link": "Some Note", "original": "[[Some Note]]" },
    { "key": "local", "link": "./Local Note.md", "original": "[local](./Local%20Note.md)" }
  ],
  "referenceLinks": [
    { "id": "ref", "link": "zotero://open/library/items/ATTKEY01?annotation=ANNKEY01&page=42",
      "position": { "start": { "line": 40, "col": 0, "offset": 1521 } } }
  ],
  "sections": ["yaml@0", "paragraph@7", "…", "callout@19", "blockquote@22",
               "table@24", "code@28", "…", "definition@40", "paragraph@42"],
  "resolvedLinks": {},
  "unresolvedLinks": { "Some Note": 2, "./Local Note": 2, "img.png": 1 },
  "getLinksEntry": ["[[Some Note]]", "[local](./Local%20Note.md)", "![[img.png]]"],
  "deleted": true
}
```

None of the eleven `zotero://` occurrences is in `links`, `embeds`,
`frontmatterLinks`, `resolvedLinks` or `unresolvedLinks`. That covers body,
empty text, embed, embed with alt text, angle-bracket URL, callout, plain
quote, table, list item, frontmatter, and `%%` comment. The `https://`
control is missing too. Only the controls are recorded.

Probe 2 put a relative link `./Local.md` in each place to see which places
Obsidian reads at all:

```json
{"links":[["[b](./Local.md)","b",4],["[c](./Local.md)","c",7],["[t](./Local.md)","t",11],
          ["[m](./Local.md)","m",19],["[](./Local.md)","",21]],
 "embeds":[["![](./Local.md)","",23]],
 "fm":[["p","[x](./Local.md)"]],
 "sections":["yaml@0","paragraph@4","callout@6","table@9","code@13", "…"],
 "deleted":true}
```

Recorded: body, callout, table, the inline `%% … %%` comment (line 19),
empty text, embed, frontmatter. Not recorded: the fenced code block, inline
code, and `$…$` math.

### 1d. The one loophole: reference definitions

`referenceLinks` keeps a definition's URL verbatim, whatever its scheme
(`worker.js:14052–14058`; `ReferenceLinkCache`, `obsidian.d.ts:7701`).
Probe 1's `[ref]: zotero://…` came back with the query string intact. Only
the definition is recorded, not the `[p. 42][ref]` use of it. ZotLit does not
write reference-style links, so this covers nothing it produces.

### 1e. Coverage matrix

"Yes / no" is whether `getFileCache()` records the occurrence in `links`,
`embeds` or `frontmatterLinks` (Obsidian 1.14.4, runtime-verified). The
"relative link" row is the control: it shows which places Obsidian reads at
all.

| Link form | Body | Callout | Table | `%%` comment | Code (fence or inline) | Frontmatter property |
| --- | --- | --- | --- | --- | --- | --- |
| `[p. 42](zotero://…)` | no | no | no | no | no | no |
| `[](zotero://…)` | no | no¹ | no¹ | no¹ | no | no¹ |
| `![](zotero://…)` | no | no¹ | no¹ | no¹ | no | no¹ |
| `[label][ref]` + `[ref]: zotero://…` | definition only, in `referenceLinks` | — | — | — | no | — |
| control: `[x](./Local.md)` | yes | yes | yes | yes | no | yes (`frontmatterLinks`) |

¹ Not probed one by one. It follows from `y()`: the form does not change
the result, and the `[p. 42]` form was probed in every one of these places.
The `sections` array still says where each block is (`callout`, `table`,
`code`, `yaml`), with no link data.

### 1f. Is there any API that lists external links per file?

No.

- Public: `CachedMetadata` (`obsidian.d.ts:2391–2540`) has `links`,
  `embeds`, `frontmatterLinks` and `referenceLinks`. Nothing else holds
  URLs.
- Internal `metadataCache.getLinks()` (`app.js:91203–91214`) concatenates
  `links` and `embeds` for every file. Probe 1's entry for the note had the
  three controls only.
- Internal `iterateAllRefs` and `iterateRefsForFile` (`app.js:91234–91255`)
  walk `frontmatterLinks`, `links` and `embeds` (`jm`,
  `app.js:42712–42716`), plus canvas `linkUpdaters`. Same filter.
- Searching `app.js` for `externalLink`, `externalUrl` or `externalLinks`
  finds no cache or API. Every `external-link` match is a CSS class, or a
  CodeMirror token type that the editor reads at the cursor for click
  handling (`getClickableTokenHref`, `app.js:134970–134984`). That token
  covers only an open editor, at one position.

**Answer to Q1:** metadataCache can be reused for ZotLit's annotation index
only for event plumbing (`changed` hands over the file text, `deleted`,
`resolve` and `resolved`), for block structure (`sections`, `frontmatter`,
`frontmatterPosition`), and for the reference-definition corner case. It
records no Durable Annotation Link in any of the three forms, anywhere.

## 2. What ZotLit's own parse-and-index would need

### 2a. How the Citation Index parses and indexes today

Paths are under `apps/obsidian/src/services/citation-index/`.

- **Two sources, one occurrence type.** `scan.ts` defines
  `CitationOccurrence { kind, raw, position: Pos }`, using Obsidian's own
  `Pos` shape.
  - `@citekey` occurrences are scanned from the body by
    `scanCitekeyOccurrences` (`scan.ts:38`), which runs the shared Pandoc
    grammar over a masked body.
  - Wikilink occurrences are derived at query time from
    `metadataCache.getFileCache(file).links` by `documentWikilinks`
    (`scan.ts:83`). They are never stored, because Obsidian already holds
    them.
- **Masking.** `maskExclusions` (`scan.ts:162`) blanks frontmatter, fenced
  and indented code, inline code, `$`/`$$` math and `%%` comments, keeping
  every offset. `maskWikilinks` then blanks `[[…]]`.
- **Incremental path.** `metadataCache.on("changed", (file, data) => …)`
  (`service.ts:565–573`) rescans from the `data` string Obsidian hands over,
  so ZotLit reads no file itself. `deleted` drops the record, `vault.on("rename")`
  moves it (`service.ts:575–605`), and `resolve` and `resolved` only
  invalidate.
- **Backfill.** At layout-ready, `#backfill` (`service.ts:668–705`) walks
  `getMarkdownFiles()`. It skips every file whose stored mtime and size still
  match, reads the rest with `cachedRead`, and yields to the host every 20
  files (`BACKFILL_CHUNK`, `service.ts:145`). The yield is the `MessageChannel`
  primitive of ADR 0050. The backfill also prunes paths that no longer exist.
- **Persistence.** One IndexedDB database, `${appId}-zotlit-citation-index`,
  holds one `{path, mtime, size, occurrences}` record per file (`store.ts`),
  mirroring Obsidian's own `${appId}-cache` (`app.js:91364`). Changing
  `SCHEMA_VERSION` discards every record.
- **Equality guard.** `occurrencesEqual` (`scan.ts:128`) stops a
  content-identical `changed` event from waking listeners.

### 2b. What an annotation-link index would add

Mirroring that design, an annotation-link source needs:

1. **A scanner** over the masked body. It finds `[text](url)`, `[](url)`,
   `![alt](url)` and `<url>`-bracketed destinations whose URL starts with
   `zotero://open/`, and passes each URL to `parseAnnotationOpenUri`
   (`packages/db/src/lib/zt-uri.ts:118`). That parser returns
   `{attachmentKey, annotationKey, pageLabel, groupID}` or `null`; it
   already rejects attachment-only links, bad keys and bad group ids, and it
   uses only `URL`, so it runs in a worker unchanged. Each hit records its
   kind (link or embed), the `original` slice, the display text and its
   `Pos`.
2. **An exclusion policy.** `maskExclusions` blanks `%%` comments, but
   Obsidian records links inside an inline `%%` comment (probe 2, line 19).
   Wikilink citations and citekey citations already follow these two
   different rules today. An annotation index has to pick one, and the
   choice decides whether its backlinks agree with Obsidian's link counts.
3. **Frontmatter.** `maskExclusions` blanks frontmatter. A link in a
   property would need its own pass over `cache.frontmatter`, the parsed
   YAML values Obsidian already supplies, with the pattern `xr` uses
   (`worker.js:13912–13937`) minus the `y()` test. It would get a key path
   instead of a position, as `FrontmatterLinkCache` has.
4. **The occurrence type.** Either `CitationOccurrence` gains a third
   `kind`, or a sibling record is stored beside it. Both need a store
   `SCHEMA_VERSION` bump (a full rescan, once).
5. **A reverse map** from Annotation Indexed Key to `{path, position}[]` for
   "which notes use this annotation", built from the per-file records the
   way `#scans` is.
6. **Backlinks without resolution.** These links name Zotero objects, not
   vault files, so `resolvedLinks` and `getBacklinksForFile` can carry
   nothing for them. An attachment key or annotation key is resolved against
   the ZoteroReads worker, as citekeys are (ADR 0073).
7. **A cheap prefilter.** `text.includes("zotero://open/")` skips the mask
   for the large majority of notes that hold no such link.

## 3. The worker question

### 3a. Obsidian's metadata worker, from source

- **Spawn.** `MetadataCache`'s constructor runs
  `new Worker("worker.js", { name: "Metadata Cache Worker" })` and binds
  `onReceiveMessageFromWorker` (`app.js:91066–91067`).
- **Trigger.** `watchVaultChanges` (`app.js:91336–91344`) routes vault
  `create`, `modify` and `external-watch` to `computeFileMetadataAsync`, and
  `delete` and `rename` to their own handlers.
- **`computeFileMetadataAsync`** (`app.js:91704–91830`) runs these steps:
  1. Skip if the stored mtime and size match and the content hash is
     already cached.
  2. Otherwise queue on `workQueue`, `readBinary`, decode the text (`Cb`)
     and hash it (`nP`).
  3. **On a hash hit, reuse the cached metadata with no parse** and fire
     `changed`.
  4. Otherwise post the `ArrayBuffer` to the worker. A 10-second "Indexing
     taking a long time" notice is armed meanwhile.
  5. `saveMetaCache(hash, result)`, persisted to IndexedDB.
  6. `queueFileForLinkResolution`, then
     `trigger("changed", file, text, cache)`.
- **Message protocol.** `work(buf)` posts `{ metadataCache: ArrayBuffer }`
  with the buffer *transferred*, and throws `"Work queue must be
  sequential!"` if a job is already in flight (`app.js:91886–91892`). The
  worker answers with one plain `CachedMetadata` object, or `{}` or `null` on
  failure. `onReceiveMessageFromWorker` resolves the single pending promise
  (`app.js:91920–91922`).
- **Worker side.** `self.onmessage` (`worker.js:13987–14142`):
  1. Decodes with `TextDecoder`.
  2. Parses with the bundled remark-style parser plus Obsidian's tokenizers:
     `dr()`, `worker.js:12853–12861`, which runs the `fr` transformer list
     (wikilinks, mark, block ids, frontmatter, callouts, the `link` and
     `image` converters).
  3. Walks the tree for headings, `ilink`, `iembed`, tags, list items,
     footnotes and definitions, and adds sections, blocks, frontmatter and
     `frontmatterLinks`.
  4. Deletes empty arrays and posts the result back.
- **A second role for the same script.** `{ parseSections, options }` makes
  the worker return rendered HTML per top-level block
  (`worker.js:14133–14136`, `Ar` at `worker.js:13950–13983`). The reading
  view uses this through a separate instance, `Pj`/`Ej`, spawned from the
  same script (`app.js:104187–104200`, `104270`, `104495–104503`). So
  `worker.js` runs as two `Worker` instances with different jobs.
- **Link resolution stays on the main thread.** `linkResolver` drains a
  queue, calls `resolveLinks(path)` and fires `resolve` per file, pausing
  through a scheduler with `maxDelay: 100`. It fires `resolved` when the
  queue empties (`app.js:91569–91651`).
- **Evidence for the move off the main thread.** A main-thread copy of the
  same parser, `Im` (`app.js:42491`), still exists. Canvas `parseText` uses
  it only below 5,000 characters and sends anything longer to
  `metadataCache.computeMetadataAsync` (`app.js:177815–177825`). That size
  threshold is Obsidian's own judgement that parsing a large body on the main
  thread is too slow.

### 3b. Can a plugin piggyback on it?

- **Read its output:** yes, fully. That is `getFileCache`, the `changed`
  event's `(file, data, cache)`, and the internal `metadataCache.metadataCache`
  (hash → metadata) and `fileCache` (path → `{mtime, size, hash}`). The
  output holds no `zotero://` link, so reading it does not help except for
  `sections`, `frontmatter` and `referenceLinks`.
- **Run arbitrary text through it:** internal
  `metadataCache.computeMetadataAsync(ArrayBuffer)` (`app.js:91893–91919`,
  not in `obsidian.d.ts`) queues on the same sequential `workQueue` as
  vault indexing, so it competes with Obsidian's own indexing. It returns
  the same filtered shape. Posting to `metadataCache.worker` directly would
  break the one-job-at-a-time invariant that `work()` asserts.
- **Have it parse extra syntax:** no. The transformer lists `fr` and `hr`
  and the parser class `ur` are module-locals inside the worker script's
  closure (`worker.js:12848–12851`). The worker is loaded from Obsidian's
  own `worker.js` URL, with no plugin code in it and no message that
  registers a transformer. The main-thread `Im` copy is just as closed, and
  it runs on the main thread anyway.

### 3c. What ZotLit's Citation Index does today

- **Parsing and indexing the vault: main thread.** `scanCitekeyOccurrences`
  runs synchronously inside the `changed` handler, and once per file during
  the chunked backfill (§2a).
- **Database work: the ZoteroReads worker.** Resolving citekeys and Indexed
  Keys to Items, building the lookup maps and comparing them happen there.
  ADR 0072 first moved citation reads into a dedicated worker; ADR 0073 then
  folded them into the ZoteroReads worker, with one connection and one read
  copy per refresh. ADR 0069 puts the Item Index in that worker too, and the
  Query handler runs there (ADR 0073, "Query during a citation rebuild").
- **No parse worker exists.** The plugin spawns workers in two places: the
  ZoteroReads worker (`virtual:zotero-reads-worker`, embedded by
  `apps/obsidian/scripts/embedded-worker.ts`, spawned in
  `zotero-reads/worker-host.ts:146`) and a short-lived
  `zotlit-snapshot-integrity` worker (`database/snapshot-integrity.ts:35`).
  Neither parses Markdown.

### 3d. What moving annotation-link indexing into a worker would take

**Hosting.**

- *In the ZoteroReads worker:* add an RPC (for example
  `ScanAnnotationLinks({ path, text })`) to its handler layer.
- *In a new embedded worker:* a second `embeddedWorker({ id: … })` entry in
  `vite.config.ts` and a host like `worker-host.ts`.

**Constraints either way.**

- `embedded-worker.ts` forbids `require("obsidian")` in a worker bundle, so
  the worker never sees `metadataCache` or `vault`. It gets bodies by
  message, as structured-clone strings or transferred buffers. The main
  thread still decodes each body, because Obsidian's `changed` hands over a
  string.
- The renderer still owns event intake, the IndexedDB store, which is
  readable from a worker but then has two writers, and the
  reverse map that views read synchronously.
- `scan.ts` imports `parseLinktext` from `obsidian`, for wikilinks only. A
  worker-side scanner has to be split off without that import.
- Ordering: a later `changed` for the same path must supersede an in-flight
  scan. That is the same generation discipline the citation lookup already
  uses (ADR 0072, "Request and source generations").
- *Sharing the ZoteroReads worker:* the scans queue behind SQLite statements
  and Item-search slices, which ADR 0073 holds to p99 ≤ 16 ms and max
  ≤ 32 ms. A backfill of thousands of bodies would need its own slicing so
  as not to break that budget. If the worker fails, annotation indexing stops
  along with every other read (ADR 0073, "Consequences").
- *A new worker:* about 18 MiB of baseline JS heap for an extra worker, as
  measured for the dedicated citation worker in ADR 0072. No SQLite and no
  read copy are needed.
- Node integration: Obsidian workers run with Node integration (comment at
  `zotero-reads/worker.ts:2`), and ZotLit is desktop-only
  (`apps/obsidian/package.json:109`). A worker could `fs.readFile` vault
  paths itself during backfill, so bodies need not cross the message
  boundary. It would then bypass `vault.cachedRead` and the adapter, and it
  would need the vault base path.

**When the main thread is cheap enough.** A synthetic benchmark measured the
existing citekey scan and a prototype annotation scan. The prototype runs
`maskExclusions`, a `zotero://open/` link regex, then
`parseAnnotationOpenUri` on each hit, behind an `includes` prefilter.

The setup was Node 26 on the author's Mac, not Electron. The code was bundled
with esbuild from `origin/next` sources. The scratch script was not
committed. Each synthetic note has a citekey citation in every paragraph, a
callout with an annotation link every fifth paragraph, and a code fence every
25th. Times are medians; p95 was within 15 % of the median.

| Note size | Annotation links | Citekey scan (today) | Annotation scan | Annotation scan, note with no link | `maskExclusions` alone |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 k chars | 20 | 0.32 ms | 0.11 ms | < 0.001 ms | 0.09 ms |
| 100 k chars | 194 | 13.1 ms | 1.08 ms | 0.002 ms | 0.91 ms |
| 1 M chars | 1,897 | 991 ms | 12.0 ms | 0.016 ms | 9.8 ms |

- The annotation scan is roughly linear, and its cost is mostly
  `maskExclusions`.
- Today's citekey scan grows much faster than linearly on this dense
  synthetic input: 13 ms at 100 k characters, about 1 s at 1 M. That cost is
  already paid on the main thread for each `changed` event of such a note.
  This study did not diagnose it. A real note with fewer citations may
  behave differently.
- If both scans share one masked body, the mask cost is paid once.

On the incremental path the scan reuses the `data` string Obsidian already
decoded, and it runs on the main thread just as the citekey scan does now.
For notes up to about 100 k characters the annotation scan stays near 1 ms,
well under one 16 ms frame. At 1 M characters it takes about 12 ms, most of a
frame, while the existing citekey scan of the same note already takes about
1 s. The
backfill's 20-file chunks bound total stall by file count, not by bytes.
Reading metadataCache output is cheap (an object lookup), but for this
purpose it holds nothing to read except `sections` and `frontmatter`.

## Options for ZotLit's index

Each row is observations and constraints, not a ranking.

| Option | What it is | Gains | Costs and constraints |
| --- | --- | --- | --- |
| **A. Reuse metadataCache** | Read `links`, `embeds` and `frontmatterLinks` | No parse, no store, no backfill; Obsidian's events and persistence | **Not possible.** `y()` drops every `zotero:` URL in every form and place (§1a, §1c). Only `referenceLinks` carries one, and only for reference-style definitions, which ZotLit does not write |
| **B. Hybrid** | metadataCache for events, `sections` and parsed `frontmatter`; own scan for links | Reuses the `changed` body and the parsed YAML; `sections` can tell code, callout and table blocks apart without re-deriving them; no extra file reads on the incremental path | All link extraction is still ZotLit's, so B is option C plus structure hints. Two exclusion rules to reconcile: Obsidian records links in `%%` comments, `maskExclusions` blanks them (§2b.2). `sections` are root-level only, so nested code inside list items or callouts still needs ZotLit's own masking |
| **C. Own parsing, main thread** | Extend `scan.ts` and `CitationIndex` with an annotation-link scanner over the masked body, plus a frontmatter pass, stored beside citekeys | Same lifecycle as citekeys today: `changed` body, chunked backfill, IndexedDB mtime/size records, equality guard. `parseAnnotationOpenUri` is ready. One `includes` prefilter skips most notes | Store schema bump (one full rescan). Measured cost is about 1 ms per 100 k characters with links, near zero without (§3d). A 1 M-character note costs about 12 ms per save on top of today's citekey scan. The backfill chunk counts files, not bytes |
| **D. Own parsing, in a worker** | Scanner runs off the main thread, in the ZoteroReads worker or a new one | Large notes and the backfill stop touching the renderer's frame budget | Bodies cross by message, or the worker reads files through Node `fs` and bypasses the vault adapter. The worker cannot import `obsidian`, so the scanner has to be split. Supersession by generation, two writers or a renderer-owned store, async reads for views. Shared worker: competes with the SQLite and query budgets of ADR 0073, and fails with them. New worker: about 18 MiB heap (ADR 0072) and another lifecycle |
