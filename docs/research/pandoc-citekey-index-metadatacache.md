# Pandoc citekey index and MetadataCache

How hard is it for an Obsidian plugin to keep a vault-wide index of Pandoc citekeys
(`[@key]`, `@key`) that stays correct across restarts, external edits, renames, and
deletions? This document answers that from Obsidian's own `MetadataCache`, which solves
the same problem for links, tags, headings, and frontmatter.

**Verdict: moderate.** Obsidian gives away the two expensive halves for free — change
detection and file content. The `changed` event carries the decoded file body, so a
plugin never has to read the vault on the incremental path. What remains is a citekey
scanner with code and math exclusion, a persisted `path -> citekeys` store with
mtime/size invalidation, a chunked first-run backfill, and rename handling. There is no
extension point in `MetadataCache` for custom cache data, so the store is entirely
plugin-owned.

## Sources

| Source | Location |
| --- | --- |
| Obsidian runtime, 1.13.4 | `/Users/aidenlx/worktrees/zotlit-v2/feat-pandoc-ref/node_modules/.ob-rev-1.13.4/app.js` |
| Metadata parser worker, 1.13.4 | `/Users/aidenlx/worktrees/zotlit-v2/feat-pandoc-ref/node_modules/.ob-rev-1.13.4/worker.js` |
| Public typings | `/Users/aidenlx/worktrees/zotlit-v2/feat-pandoc-ref/packages/obsidian-api/obsidian.d.ts` |

All `app.js` line numbers below are for 1.13.4. Minified identifiers change between
releases. Re-derive them from the webpack export table before reuse.

### Name mapping

Public names come from the main export block in `app.js` (`n.d(d, { App: () => Rie, ... })`,
`app.js:14968` onward).

| Minified | Public name | Definition |
| --- | --- | --- |
| `GF` | `MetadataCache` | `app.js:90255`, export at `app.js:15012` |
| `KD` | `Vault` | `app.js:71968`, export at `app.js:15053` |
| `UD` | `TFile` | export at `app.js:15043` |
| `ID` | `Events` | `app.js:71804`, export at `app.js:14988` |
| `yZ` | `TextFileView` | `app.js:127177`, export at `app.js:15048` |
| `e5` | `MarkdownView` | export at `app.js:15008` |
| `xw` | `Notice` | export at `app.js:15016` |
| `gD` | `parseLinktext` | `app.js:71606`, export at `app.js:15103` |
| `kD` | `getAllTags` | `app.js:71626`, export at `app.js:15081` |
| `KT` | `parseFrontMatterEntry` | export at `app.js:15100` |

Internal helpers with no public name:

| Minified | Role | Definition |
| --- | --- | --- |
| `Dw` | Serial promise queue. Every task chains onto the previous one. | `app.js:59347` |
| `Lw` | Deferred work queue with a start/stop runnable. | `app.js:59442` |
| `Iw` | Runnable with `onStart` / `onStop` / `onCancel`. | `app.js:59413` |
| `xA` | Generator wrapper. Yields to idle after a batch. | `app.js:73536` |
| `Mv` | `requestIdleCallback` with a timeout fallback. | `app.js:38772` |
| `kl` | Debounce. Third argument re-arms the timer. | `app.js:30003` |
| `Cl` | `queueMicrotask`. | `app.js:30048` |
| `Cd` | `ArrayBuffer` to string through `TextDecoder`. | `app.js:37653` |
| `PC` / `IC` | SHA-256 digest, returned as hex. | `app.js:62807` / `app.js:62820` |
| `Kk` | `idb` `openDB`. | `app.js:60919` |
| `YF` | Batched IndexedDB `getAll`, 300 records per batch. | `app.js:91202` |
| `jF` | Per-file block cache for block references. | `app.js:90072` |
| `jD` | `WeakMap<TFile, string>` behind `Vault.cachedRead`. | `app.js:71903` |
| `cD` / `hD` | `Pos` to and from a six-number array for storage. | `app.js:71540` / `app.js:71549` |
| `fD` / `dD` | Stored-record migration and rehydration. | `app.js:71566` / `app.js:71559` |

## How MetadataCache works

### Two maps, content-addressed

`MetadataCache` holds two plain objects (`app.js:90262`):

- `fileCache: Record<path, { mtime, size, hash }>` — one entry per vault file.
- `metadataCache: Record<hash, CachedMetadata>` — one entry per distinct content hash.

`getCache(path)` reads `fileCache[path].hash` and returns `metadataCache[hash]`
(`app.js:90425`). `getFileCache(file)` delegates to `getCache(file.path)`
(`app.js:90422`). Non-Markdown files return `{}`, not `null`.

`hash` is the SHA-256 of the raw file bytes (`app.js:90927`, `PC` at `app.js:62807`).
The indirection means two identical notes share one parse result, and a file that is
edited and then reverted hits the existing entry with no parse. `cleanupDeletedCache`
removes orphan hashes every 10 minutes and once 60 seconds after start
(`app.js:91077`, scheduled at `app.js:90668` and `app.js:90697`).

### Persistence

`_preload()` opens IndexedDB database `<appId>-cache` at version 19 with object stores
`file` and `metadata` (`app.js:90566`). The upgrade handler **deletes and recreates both
stores** (`app.js:90568`). A version bump therefore discards the whole cache and forces a
full re-index.

Reads: all `file` keys and values in one transaction, then the `metadata` store in
batches of 300 through `YF` (`app.js:90609` to `app.js:90633`). Each stored metadata
record passes through `fD` for schema migration and `dD` to expand the packed six-number
`pos` arrays back into `Pos` objects (`app.js:90627`, `app.js:90631`).

Writes go through `transactionSave` (`app.js:90580`). It keeps one `readwrite`
transaction with `durability: "relaxed"` alive for the current microtask and reuses it
for every write in that tick (`app.js:90588`, `Cl` is `queueMicrotask`). Positions are
packed to arrays before write (`saveMetaCache`, `app.js:91025`).

### Cold start

Boot order in `App.load` (`app.js:199040` onward):

| Step | Line |
| --- | --- |
| `new Vault(adapter)` | `app.js:199040` |
| `new MetadataCache(app, vault)`; the worker starts here | `app.js:199068`, `app.js:90285` |
| `await plugins.initialize()` — **community plugin `onload` runs here** | `app.js:199362` |
| `metadataCache.preload()` — started, not awaited | `app.js:199370` |
| `await vault.load()` — full disk walk, `create` per file | `app.js:199371` |
| `await metadataCache.initialize()` | `app.js:199387` |
| `await workspace.loadLayout()` — `layout-ready` fires at the end | `app.js:199394`, `app.js:148682` |
| `metadataCache.showIndexingNotice()` | `app.js:199436` |

`vault.load()` calls `adapter.watch(...)`, which starts an `fs.watch` on `/` and then
walks the whole tree with `listAll()` (`app.js:72193`, `app.js:30891`). Every file found
is `lstat`ed and emitted as `file-created`, which `Vault.onChange` turns into a `create`
event with a fresh `TFile` (`app.js:31122`, `app.js:72253`). This walk runs on every
launch, warm cache or cold.

`initialize()` then reconciles the persisted `fileCache` against the loaded file list
(`app.js:90678` to `app.js:90691`):

| Condition | Action |
| --- | --- |
| Path in `fileCache`, file gone from disk | `deletePath(path)` |
| Hash missing from `metadataCache` | `computeFileMetadataAsync` (re-parse) |
| `stat.mtime !== cached.mtime` or `stat.size !== cached.size` | `computeFileMetadataAsync` (re-parse) |
| Otherwise | `queueFileForLinkResolution(file)` only — **no read, no parse, no `changed` event** |
| File on disk, path absent from `fileCache` | `computeFileMetadataAsync` |

Invalidation is `mtime` **and** `size`, taken from `TFile.stat`. The hash is only
computed after a read, so it confirms rather than triggers.

`initialize()` does **not** await the queued work. It sets `initialized = true`, starts
the vault watchers, and fires the internal `finished` event immediately
(`app.js:90692`). When `onLayoutReady` runs, `MetadataCache` may still have thousands of
files queued.

### Parse pipeline

`computeFileMetadataAsync` (`app.js:90892`) is the single entry point for all indexing.

1. Skip unless the extension is exactly `md`. Other extensions only get an mtime/size
   record with an empty hash (`app.js:90984`).
2. Compare `mtime`, `size`, and hash presence. If all match, only queue link resolution
   and return (`app.js:90902` to `app.js:90906`).
3. Otherwise increment `inProgressTaskCount` and append to `workQueue`, a **serial**
   promise chain (`Dw`, `app.js:59347`). One file is indexed at a time.
4. `await vault.readBinary(file)` reads the whole file.
5. `Cd(buffer)` decodes it to a string; `PC(buffer)` computes the SHA-256
   (`app.js:90927`).
6. Write the updated `{mtime, size, hash}` to `fileCache` and IndexedDB.
7. If `metadataCache[hash]` already exists, queue link resolution, fire `changed`, and
   stop. **No parse** (`app.js:90935` to `app.js:90941`).
8. Otherwise `work(buffer)` posts the buffer to the worker with a transfer list
   (`app.js:91044`). A 10-second timer shows a "Indexing taking a long time" notice
   (`app.js:90942`). Only one worker message may be in flight; a second call throws
   (`app.js:91042`).
9. On reply, `saveMetaCache(hash, result)`, queue link resolution, fire `changed`
   (`app.js:90957`).

There is no file-size limit anywhere in this path.

The worker parses the full Markdown document and returns `CachedMetadata`
(`worker.js:13957` to `worker.js:14102`). It walks only these node types:
`heading`, `ilink`, `iembed`, `tag`, `listItem`, `fnRef`, `footnoteDefinition`,
`definition` (`worker.js:13999`). Root-level children become `sections` with a `type`
(`worker.js:13986`). Nothing in the output describes inline code, math, or comments.

### Link resolution

A second queue holds files waiting for link resolution (`Lw` at `app.js:59442`, created
in `linkResolver()` at `app.js:90769`). Its generator is wrapped by `xA`
(`app.js:73536`), which processes 10 items, and if that took more than 5 ms, yields
through `requestIdleCallback` with a 100 ms timeout (`Mv`, `app.js:38772`).

Per item: `resolveLinks(path)` rebuilds `resolvedLinks[path]` and `unresolvedLinks[path]`
by iterating the file's links and embeds and calling `getFirstLinkpathDest`
(`app.js:90821`). Then `resolve` fires with the `TFile` (`app.js:90792`).

When the queue empties, the runnable stops and `resolved` fires (`app.js:90774`). The
queue can empty and refill many times during startup, so **`resolved` fires repeatedly**,
not once.

`updateRelatedLinks` re-queues every file whose resolved or unresolved links mention a
changed name (`app.js:90860`). This is what makes a new file fix other files' broken
links.

### Incremental updates

`watchVaultChanges()` wires four vault events (`app.js:90539`):

| Vault event | Handler | Effect |
| --- | --- | --- |
| `create` | `onCreate` (`app.js:90888`) | Index the file, then re-queue files that referenced its name. |
| `modify` | `computeFileMetadataAsync` | Re-index if mtime or size changed. |
| `delete` | `onDelete` (`app.js:90987`) | Fire `deleted` with the previous cache, then `deletePath`. |
| `rename` | `onRename` (`app.js:91002`) | Move the `fileCache`, `resolvedLinks`, and `unresolvedLinks` entries to the new path. **No re-parse, no `changed` event.** |

The `obsidian.d.ts` `changed` documentation states this rename behaviour explicitly
(`obsidian.d.ts:4449`): "This is not called when a file is renamed for performance
reasons. You must hook the vault rename event for those."

External modifications reach this path through the filesystem watcher.
`FileSystemAdapter.onFileChange` debounces to the next task and queues `reconcileFile`
(`app.js:31007`). `reconcileFileCreation` compares `mtime` and `size` against the known
`TFile`; only a real difference emits `modified` (`app.js:31129`). Files changed while
Obsidian was closed are caught by the `initialize()` reconciliation described above, not
by the watcher.

`Vault.onChange('modified')` also clears the read cache for that file unless a save is in
progress (`app.js:72261`).

### Events

Only four `MetadataCache` events are public (`obsidian.d.ts:4453` to `obsidian.d.ts:4471`):

| Event | Payload | Fired at |
| --- | --- | --- |
| `changed` | `(file: TFile, data: string, cache: CachedMetadata)` | `app.js:90939`, `app.js:90959` |
| `deleted` | `(file: TFile, prevCache: CachedMetadata \| null)` | `app.js:90991` |
| `resolve` | `(file: TFile)` | `app.js:90792` |
| `resolved` | `()` | `app.js:90774` |

`finished` (`app.js:90268`, `app.js:90696`) is internal and undocumented.

`Events.trigger` is synchronous, ignores handler return values, and rethrows handler
exceptions asynchronously through `setTimeout` (`app.js:71833`, `app.js:71841`). A
`changed` handler therefore runs **inside** the indexing task, before
`inProgressTaskCount--`. Slow synchronous work in a handler stalls the whole index. An
`async` handler detaches immediately and is not awaited.

## The `changed` event carries the file content

This is the single most important finding for a citekey index.

```js
// app.js:90925-90959, condensed
const buffer = await this.vault.readBinary(file);   // ArrayBuffer
const data   = Cd(buffer);                          // TextDecoder().decode(...)
const hash   = await PC(buffer);                    // SHA-256 hex
// ... hit or parse ...
this.trigger("changed", file, data, cache);
```

`Cd` is `new TextDecoder().decode(new Uint8Array(e))` (`app.js:37653`). The decode
happens **before** the buffer is transferred to the worker, so the string is always
valid. The public signature matches: `(file: TFile, data: string, cache: CachedMetadata)`
(`obsidian.d.ts:4453`).

Consequences for a plugin:

- On the incremental path, a plugin needs **zero vault reads**. Scan `data` directly.
- On startup, every file whose mtime or size changed while Obsidian was closed produces a
  `changed` event with its content. A plugin registered in `onload` catches all of them,
  because `plugins.initialize()` completes before `vault.load()` and
  `metadataCache.initialize()`.
- Files that did not change produce **no** `changed` event. Those must come from the
  plugin's own persisted store.
- `changed` fires even when only the mtime moved and the content is byte-identical (the
  hash-hit branch at `app.js:90935`). Handlers must be idempotent.

`Vault.readBinary` also caches the decoded string on the `TFile` for Markdown files up to
`vault.cacheLimit`, default 65536 bytes (`app.js:72413`, `app.js:71976`). `cachedRead`
reads that `WeakMap` (`app.js:72396`). `setFileCacheLimit` exists but is never called in
1.13.4. So `cachedRead` is free right after indexing for files under 64 KB, and a real
disk read otherwise.

## Public surface versus internals

Public on `MetadataCache` (`obsidian.d.ts:4404`): `getFirstLinkpathDest`, `getFileCache`,
`getCache`, `fileToLinktext`, `resolvedLinks`, `unresolvedLinks`, and the four events.
Nothing else.

Everything below is real but undocumented. It may change without notice.

| Internal member | Line | Use |
| --- | --- | --- |
| `initialized: boolean` | `app.js:90273` | True once reconciliation is queued, **not** once indexing is done. |
| `inProgressTaskCount: number` | `app.js:90260` | Files still queued for parse. |
| `fileCache[path].hash` | `app.js:90262` | The SHA-256 a plugin would otherwise recompute. |
| `getCachedFiles()` | `app.js:90434` | All indexed paths. |
| `getFileInfo(path)` | `app.js:90431` | `{mtime, size, hash}` for one path. |
| `isCacheClean()` | `app.js:90853` | The true "indexing finished" predicate. |
| `onCleanCache(cb)` | `app.js:90840` | Fires the callback once the cache is clean. |
| `getBacklinksForFile(file)` | `app.js:90508` | Backlink map. |
| `getTags()`, `getAllPropertyInfos()` | `app.js:90327`, `app.js:91127` | Vault-wide aggregation examples. |
| `linkUpdaters[extension]` | `app.js:90274` | Registry for non-Markdown link owners. The Canvas plugin registers one at `app.js:173574`. |
| `blockCache` | `app.js:90287`, class at `app.js:90072` | Per-file, mtime-keyed, in-memory only. Not a vault index. |

There is **no** extension point for custom cache data. `CachedMetadata` is built entirely
inside the worker from a fixed node-type list (`worker.js:13999`), and `linkUpdaters` only
covers link rewriting during renames. A citekey index must be a separate, plugin-owned
structure.

Note on excluded files: `userIgnoreFilters` (the "Excluded files" setting) is applied only
in `getTags`, `getAllPropertyInfos`, and `getFrontmatterPropertyValuesForKey`
(`app.js:90338`, `app.js:91140`, `app.js:91175`). Excluded files are still indexed and
still fire `changed`. A plugin that wants to honour the setting must filter itself.

## Parsing help available to a plugin

`CachedMetadata` gives partial help with exclusion zones:

- `frontmatterPosition: Pos` (`obsidian.d.ts:1452`) marks the YAML block. Skip it, or
  scan it under different rules.
- `sections: SectionCache[]` (`obsidian.d.ts:1438`) gives root-level blocks with a `type`
  from `blockquote | callout | code | element | footnoteDefinition | heading | html |
  list | paragraph | table | text | thematicBreak | yaml` and more
  (`obsidian.d.ts:5679`).

The limits matter:

- **Sections are root level only.** The worker pushes one section per direct child of the
  document root (`worker.js:13986`). A fenced code block inside a list item or a
  blockquote is not its own section; the enclosing `list` or `blockquote` section covers
  it. Filtering on `type === 'code'` misses nested code.
- **Inline code is absent.** The worker never visits `inlineCode` nodes. A backtick span
  containing `@key` is indistinguishable from prose in `CachedMetadata`.
- **Math and `%%` comments are absent** for the same reason.

`parseFrontMatterEntry` (`KT`, export at `app.js:15100`) and `parseLinktext` (`gD`,
`app.js:71606`) are exported helpers, but neither helps with citekeys. There is no
exported Markdown tokenizer. `MarkdownRenderer.render` produces DOM, not positions, and
runs the whole render pipeline — far too heavy per file.

Conclusion: a plugin must write its own scanner. Using `sections` as a coarse pre-filter
is possible but does not remove the need for inline handling.

## Editor-side live parsing

The persistent cache updates only on save. `TextFileView.requestSave` is a 2000 ms
trailing debounce over `save` (`app.js:127186`). The third argument of `kl` is omitted,
so the timer does **not** re-arm on every keystroke: the save lands about 2 seconds after
the first edit of a burst (`app.js:30003`). Every save calls `Vault.modify`, which emits
`modify`, which reaches `computeFileMetadataAsync`.

For a highlight-while-typing feature, the editor path is separate and CodeMirror 6 based.
`registerEditorExtension` plus `syntaxTree(view.state)` and `tokenClassNodeProp` gives
per-token classes, and the class string can be tested for `code` and `math` to skip
regions. This is how `obsidian-pandoc-reference-list` does it
(`src/editorExtension.ts:30`, `ignoreListRegEx = /code|math|templater|hashtag/`, applied
at `src/editorExtension.ts:257`).

A vault index does not need this. Keep the two concerns separate: the CM6 extension
decorates the open document, the index tracks saved files.

## Difficulty assessment

### Free from Obsidian

| Capability | Mechanism |
| --- | --- |
| Change notification for saved and externally modified files | `metadataCache.on('changed')` |
| File content on every change | The `data` argument of `changed`, decoded once at `app.js:90927` |
| Startup detection of files edited while closed | `initialize()` mtime/size reconciliation (`app.js:90684`), surfaced as `changed` |
| Delete notification | `metadataCache.on('deleted')` or `vault.on('delete')` |
| Rename notification | `vault.on('rename')` with `oldPath` (`obsidian.d.ts:7576`) |
| Per-file enumeration at startup | `vault.on('create')` registered in `onload` fires for every file during `vault.load()` (`obsidian.d.ts:7554`, `app.js:31152`) |
| Per-file mtime and size | `TFile.stat` (`obsidian.d.ts:2974`) |
| Cheap re-read of recently indexed files | `vault.cachedRead`, backed by the 64 KB `WeakMap` (`app.js:72396`) |
| Coarse block types and frontmatter range | `CachedMetadata.sections`, `frontmatterPosition` |
| Per-vault key/value storage | `app.loadLocalStorage` / `app.saveLocalStorage` (`obsidian.d.ts:472`) |
| Plugin-scoped JSON storage | `Plugin.loadData` / `Plugin.saveData` (`obsidian.d.ts:5056`) |

### Must be built

| Work item | Size | Notes |
| --- | --- | --- |
| Citekey scanner | Largest item | Must handle fenced code with variable fence length, indented code, inline code with variable backtick runs, math, `%%` comments, and the `@` prefix rules. |
| Forward and inverse index | Small | `path -> Set<citekey>` and `citekey -> Set<path>`. |
| Persistence with invalidation | Small | Mirror Obsidian: `path -> {mtime, size, citekeys}`. Compare against `TFile.stat` on start. |
| First-run backfill | Medium | The one case that needs real vault reads. Must be chunked. |
| Rename handling | Small | Move the key. `MetadataCache` does not re-parse, so there is nothing else to do. |
| Readiness signal | Small | No public "index warm" event exists. |

### Suggested shape

```
onload()
  register metadataCache.on('changed', (file, data) => upsert(file.path, scan(data)))
  register metadataCache.on('deleted', (file) => drop(file.path))
  register vault.on('rename', (file, oldPath) => move(oldPath, file.path))
  // do not touch the vault here: vault.load() has not run yet

workspace.onLayoutReady()
  load persisted { path -> {mtime, size, citekeys} }
  for each markdown file:
     entry = store[path]
     if entry and entry.mtime === file.stat.mtime and entry.size === file.stat.size:
        adopt entry            // no read
     else:
        mark for backfill      // changed may already have covered it
  drop store entries with no file
  run the backfill in idle chunks with vault.cachedRead
  persist
```

Ordering detail that makes this work: `Plugin.onload` runs at `app.js:199362`, before
`vault.load()` at `app.js:199371` and before `metadataCache.initialize()` at
`app.js:199387`. Handlers registered in `onload` therefore see every startup `changed`
event. The backfill list shrinks to the files Obsidian did not need to re-read, and those
are exactly the files the plugin's own store should already cover. On a warm second run
the backfill is empty and startup costs nothing beyond loading the store.

Persistence choice: `Plugin.saveData` rewrites the whole JSON file on every call and must
be debounced hard. An own IndexedDB database avoids that and matches what `MetadataCache`
does, at the cost of more code. For a citekey index the payload is small — a set of short
strings per file — so a debounced `saveData` is defensible up to roughly tens of
thousands of notes. Measure before choosing.

## Pitfalls

1. **`resolved` is not a "ready" signal.** It fires whenever the link-resolver queue
   momentarily empties (`app.js:90774`), which happens many times during startup. Waiting
   for the first `resolved` gives a partially built index. The reliable predicate is the
   internal `isCacheClean()` (`app.js:90853`) or `onCleanCache` (`app.js:90840`). A
   plugin that will not touch internals should own its readiness flag and set it after
   its own backfill finishes.
2. **`metadataCache.initialized` means "reconciliation queued", not "indexing done".**
   `initialize()` sets it and returns without awaiting the parse queue (`app.js:90692`).
3. **`onLayoutReady` does not imply a warm cache.** It runs after `loadLayout()`
   (`app.js:199394`), which is after `initialize()` returns, not after the queue drains.
4. **`changed` handlers run synchronously inside the indexing task.** `trigger` is a
   plain synchronous loop (`app.js:71833`). Keep the scanner fast, or hand the content to
   a queue and return.
5. **`changed` fires for content-identical touches.** The hash-hit branch at
   `app.js:90935` still triggers the event. Make upserts idempotent.
6. **Rename produces no `changed` event.** Documented at `obsidian.d.ts:4449` and visible
   at `app.js:91002`. Hook `vault.on('rename')` or the index silently keeps stale paths.
7. **Rename side effects arrive as separate `changed` events.** When Obsidian rewrites
   links in other notes after a rename, those notes are modified and re-indexed normally.
   That is correct but can be a burst of hundreds of events.
8. **First-run backfill is the real cost.** It is one full vault read. Obsidian's own
   cold index is serial by design (`Dw` at `app.js:59347`) and yields to idle between
   batches (`xA` at `app.js:73536`). Copy that shape. Do not `Promise.all` over
   `getMarkdownFiles()`.
9. **`vault.getMarkdownFiles()` returns an empty array in `onload`.** `vault.load()` has
   not run. Do the scan in `onLayoutReady`.
10. **Excluded files are still indexed.** `userIgnoreFilters` does not gate
    `computeFileMetadataAsync`. Filter in the plugin if the setting should apply.
11. **Only `.md` is indexed by `MetadataCache`.** The extension check is exact
    (`"md" === e.extension` at `app.js:90899`). A `.qmd` or `.markdown` file gets no
    `changed` event at all. Such files need a `vault.on('modify')` fallback
    with a plugin-side read.
12. **A cache-schema bump wipes everything.** `MetadataCache` deletes both object stores
    on any IndexedDB upgrade (`app.js:90568`). If the plugin keys its own store on
    Obsidian's internal hash, an Obsidian upgrade invalidates the plugin store too. Key
    on mtime and size instead, which come from `TFile.stat` and are public.
13. **Mobile runs the same code.** The worker is created unconditionally
    (`app.js:90285`) and IndexedDB is used the same way. The constraint is memory and CPU,
    not API availability. A backfill that holds every file body in memory will fail on
    phones; stream it.
14. **`cachedRead` is only free under 64 KB and only shortly after indexing**
    (`app.js:72413`, limit at `app.js:71976`). Treat it as a plain read for cost
    purposes.

## Existing art

**`mgmeyers/obsidian-pandoc-reference-list`** — closest prior art, and it deliberately
does **not** build a vault index.

- Scope is the active file only. `processReferences` reads
  `workspace.getActiveViewOfType(MarkdownView).file` through `vault.cachedRead`
  (`src/main.ts:338`).
- It uses `metadataCache.on('changed')` purely as a "this file was saved" trigger,
  debounced 100 ms, and **discards the `data` argument**, re-reading the file instead
  (`src/main.ts:112`).
- Results live in an in-memory `LRUCache<TFile, FileCache>` with no persistence
  (`src/bib/bibManager.ts:137`).
- The parser is a hand-written character state machine, 719 lines, covering the full
  Pandoc citation grammar: prefixes, suffixes, locators, `-@` author suppression,
  composite citations, and `@{explicit key}` (`src/parser/parser.ts`). Key character
  rules: `preKey = /[ \t\v[\-\r\n;]/` gates what may precede `@`
  (`src/parser/parser.ts:64`, `isValidPreKey` at `src/parser/parser.ts:72`), which is what
  keeps `user@example.com` from parsing as a citation.
- Code exclusion happens only in the editor extension, through CodeMirror token classes
  (`src/editorExtension.ts:30` and `:257`), not in the parser. The parser itself has no
  code-block awareness.

Takeaway: a citekey **index** needs far less grammar than reference-list's parser. It
needs the key only, not locators or affixes. But it needs code and math exclusion that
reference-list gets for free from CodeMirror and therefore never wrote.

## Alternatives assessed

| Alternative | Why not |
| --- | --- |
| Register a custom parser with `MetadataCache` | No extension point exists. `CachedMetadata` is produced by a fixed worker (`worker.js:13999`). |
| Read `metadataCache.fileCache[path].hash` and key the plugin store by content hash | Works today and gives free deduplication, but it is internal, and any IndexedDB version bump in Obsidian discards the source data (`app.js:90568`). `TFile.stat` gives the same invalidation from public API. |
| Derive citekeys from `CachedMetadata.sections` alone | Sections are root-level only (`worker.js:13986`) and carry no inline structure. Nested and inline code would leak into the index. |
| Ignore persistence and rescan the vault on each start | One full vault read per launch, on top of Obsidian's own walk and index. Unacceptable on mobile and on large vaults. |
| Wait for `metadataCache.on('resolved')` as the ready signal | Fires repeatedly during startup (`app.js:90774`). Gives a partial index. |
| Use `vault.on('modify')` instead of `metadataCache.on('changed')` | Correct but strictly worse: `modify` carries no content, so every event costs a read. |
| Run the scanner in a Web Worker | Defensible for the backfill. Adds a build target and a transfer cost per file. Start single-threaded with idle chunking and measure. |

## Implementation consequences

1. Write a citekey scanner that returns keys with offsets, and mask fenced code, indented
   code, inline code, math, and `%%` comments before matching. Reuse the `preKey`
   character rule from reference-list to reject email addresses.
2. Register `metadataCache.on('changed')`, `metadataCache.on('deleted')`, and
   `vault.on('rename')` in `onload`, before `vault.load()` runs, and scan the `data`
   argument directly.
3. Persist `path -> {mtime, size, citekeys}` and rebuild the inverse index in memory on
   load. Invalidate on `TFile.stat` mtime and size, matching `app.js:90684`.
4. Run the first-run backfill from `onLayoutReady`, chunked through
   `requestIdleCallback`, over only the files the persisted store does not already cover.
5. Own the readiness flag. Do not depend on `resolved`, `initialized`, or `onLayoutReady`
   to mean the index is complete.
6. Keep the CodeMirror decoration extension, if any, separate from the index. It reads
   the open document and the syntax tree; the index reads saved content.
7. Add a manual "rebuild index" command. It is the only recovery path when the store and
   the vault disagree for a reason mtime and size cannot see.
