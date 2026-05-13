# Stage 2 — NoteIndex implementation

Companion to [`MIGRATION.md`](MIGRATION.md) §4 (stage 2). The KISS rewrite of v1 `services/note-index/`. Scope: alpha-blocker; needed by Stage 5 (NoteFeatures), Stage 7 (citekey-click), Stage 9 (annot view).

## 1. Purpose

Maintain three vault-wide indices over markdown frontmatter and annotation block IDs so other services can answer:

- _Which files reference this Zotero item?_ — by `zotero-key` (per-key, includes group suffix `KEYgGROUPID`).
- _Which files reference this Zotero citekey?_ — by `citekey`.
- _Where are the annotation blocks for this item/file?_ — block-ID matching using v1 syntax (`KEYaPARENT(gGROUP)?(pPAGE)?`, multi-key sections joined by `n`).

All consumers query synchronously. Indices update from `metadataCache` and `vault` events. No DB dependency.

## 2. Public surface

File layout under `apps/obsidian/src/services/note-index/`:

```
service.ts   # NoteIndex class + formatItemKey + isLiteratureNote
parse.ts     # pure parse/diff helpers, internal-only
```

No barrel `index.ts`. Consumers import from `@/services/note-index/service`.

### 2.1 Exports

```ts
// service.ts
export class NoteIndex extends Service<void> {
  /* see §4 */
}

export interface BlockInfo {
  file: string;
  /** Indexed item key, format `KEY[gGROUPID]`. */
  key: string;
  position: Pos; // from `obsidian`
}

/** Canonical indexed key. groupID null/undefined → just `key`. */
export function formatItemKey(key: string, groupID: number | null): string;

/** Frontmatter-only check; does not consult the index. */
export function isLiteratureNote(file: string | TFile, app: App): boolean;
```

### 2.2 NoteIndex methods

```ts
getNotesByItemKey(indexedKey: string): string[];      // file paths
getNotesByCitekey(citekey: string): string[];         // file paths
getBlocksFor(arg: { file?: string; itemKey?: string }): BlockInfo[];

on<K>(event: K, cb): () => void;                      // nanoevents subscription
once<K>(event: K, cb): () => void;
ready: Promise<void>;                                 // resolves once subscribers are wired
```

`getBlocksFor` rules:

- Both `file` and `itemKey` set → intersection (blocks for that item _in_ that file).
- Only `file` → all annot blocks in the file.
- Only `itemKey` → all annot blocks across the vault for that item.
- Neither → throw `TypeError("getBlocksFor: provide file or itemKey")`. (Matches v1.)

No reload command or public `reload()` method. The bulk rescan path is internal, triggered by `metadataCache.on('resolved')` — if Obsidian's metadata cache gets out of sync, the user reloads the plugin (or the app), which fires `resolved` and rebuilds the index.

### 2.3 Events

`changed(file: string)` — fired after the indices were touched for that file (delta-aware: no-op metadata changes don't fire).

`rebuilt()` — fired once after a bulk rescan completes (initial scan + any subsequent `metadataCache.on('resolved')` rescan).

Bulk path does **not** emit per-file `changed` — listeners should treat `rebuilt` as "re-query whatever you cared about". Event names are dash-case per repo convention (well, single words here, so no hyphen needed; the dash-case rule is for multi-word names).

## 3. Frontmatter contract

Read from `CachedMetadata.frontmatter`:

| Field        | Use                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------- |
| `zotero-key` | Indexed key string. Accepts pattern `[23456789A-NP-Z]{8}(gNNN)?`. Invalid string → skip. |
| `citekey`    | Non-empty string. Anything else → skip.                                                  |

`zt-attachments` is **not** indexed. Stage 5's update flow reads it directly via `cache?.frontmatter?.["zt-attachments"]`.

Stage 5 will extend the default literature-note template (`zt-note.eta.md`) so freshly created notes emit `zotero-key` and `zt-attachments`. The current `zt-field.eta.md` already emits `citekey`.

## 4. Architecture

### 4.1 State

```ts
#emitter: Emitter<NoteIndexEvents>;
#notesByItemKey: Map<string, Set<string>>;
#notesByCitekey: Map<string, Set<string>>;
#blocksByItemKey: Map<string, Set<BlockInfo>>;
#blocksByFile:    Map<string, BlockInfo[]>;
#contribByFile:   Map<string, FileContributions>;  // reverse map for O(1) cleanup
```

`FileContributions` (internal type in `parse.ts`):

```ts
interface FileContributions {
  itemKey: string | null;
  citekey: string | null;
  blocks: Map<string, Pos[]>; // key → positions in this file
}
```

The reverse map drives surgical update — no need to scan every Map looking for `file` membership when a single file changes.

### 4.2 Lifecycle (Service<void>)

Constructor: `new NoteIndex({ plugin, app })`. No settings dependency (we dropped v1's dead `literatureNoteFolder` reload trigger; indexing is global).

`#load()`:

1. Subscribe to `vault.on('rename')`, `vault.on('delete')`. `create` is intentionally not handled — `metadataCache.changed` covers it (matches v1).
2. Subscribe to `metadataCache.on('changed')`, `metadataCache.on('deleted')`, `metadataCache.on('resolved')`.
3. If `app.metadataCache.initialized` is true, run an initial bulk scan synchronously before `commit()`.
4. Otherwise the first `resolved` event handler runs the bulk scan.
5. `commit(stack)` — `ready` resolves.

`MetadataCache.initialized` is a private Obsidian API declared in `apps/obsidian/src/typings/obsidian-ex.d.ts`.

Disposal: `AsyncDisposableStack` unsubscribes vault/metadata listeners. Indices and emitter are GC'd with the instance.

### 4.3 Event handlers

```
metadataCache.on("changed", (file, _data, cache)) → #applyFile(file.path, cache)
metadataCache.on("deleted", (file))               → #applyFile(file.path, null)
metadataCache.on("resolved", ())                  → #bulkRescan()
vault.on("rename", (file, oldPath))               → #applyFile(oldPath, null); if md → #applyFile(file.path, getCache(file.path))
vault.on("delete", (file))                        → if was md → #applyFile(file.path, null)
```

`#applyFile(path, cache | null)`:

1. `next = cache ? parse.fileContributions(cache) : EMPTY_CONTRIB`.
2. `prev = #contribByFile.get(path) ?? EMPTY_CONTRIB`.
3. `diff = parse.diffContributions(prev, next)`.
4. If diff is empty → return (no event).
5. Apply diff to the four index Maps.
6. Update `#contribByFile` (set or delete).
7. `#emitter.emit("changed", path)`.

`#bulkRescan()`:

1. Clear all five Maps.
2. For each `TFile` in `vault.getMarkdownFiles()`: parse + insert. Build `#contribByFile` along the way.
3. `#emitter.emit("rebuilt")`.

### 4.4 `parse.ts` (pure)

Pure, no I/O, no Obsidian state. Imports `CachedMetadata`, `Pos`, `SectionCache` types only from Obsidian.

```ts
export function fileContributions(cache: CachedMetadata): FileContributions;

export interface ContribDiff {
  empty: boolean;
  itemKey: { remove: string | null; add: string | null };
  citekey: { remove: string | null; add: string | null };
  blocks: {
    /** keys whose Pos[] needs removing (full removal of this file's entries for the key) */
    remove: string[];
    /** keys whose Pos[] needs adding */
    add: string[];
  };
}
export function diffContributions(
  prev: FileContributions,
  next: FileContributions,
): ContribDiff;
```

Implementation notes:

- `fileContributions` reads `frontmatter['zotero-key']` (validate regex `^[23456789A-NP-Z]{8}(g\d+)?$`), `frontmatter.citekey` (non-empty string).
- For blocks: iterate `cache.sections ?? []`; for each section with `section.id` matching `multipleAnnotKeyPagePattern`, split on `n`, parse each fragment with `annotKeyPagePattern`, derive the indexed key `KEY` or `KEY+gGROUP` (dropping `aPARENT` and `pPAGE`). Push `section.position` into `blocks.get(key)`. Multiple matches in one section can share a key; positions accumulate (matches v1).
- Block-ID regex constants live here (copied from v1 `lib/common/src/block-id.ts`; no shared package extraction). Fragment parsing uses `arkregex` typed named captures instead of manual `RegExpExecArray` indexing.
- `diffContributions` is shallow value comparison. `blocks` diffing: a key changed if its `Pos[]` differs (length OR any element differs by `start`/`end`). On equal sets, no diff entry.

### 4.5 Diff application (in service)

```
remove itemKey from #notesByItemKey: drop file from Set; if set is empty, delete the key.
add itemKey: ensure Set, add file.
(same for citekey + #notesByCitekey)

for each removed block key:
  - find this file's BlockInfo entries with that key in #blocksByFile.get(file), splice them out.
  - find those same BlockInfo objects in #blocksByItemKey.get(key); delete each.
  - if Set becomes empty, delete the key from #blocksByItemKey.
for each added block key:
  - construct BlockInfo[] = next.blocks.get(key)!.map(pos => ({ file, key, position: pos }))
  - append to (or seed) #blocksByFile.get(file)
  - add each to #blocksByItemKey.get(key) Set.
```

`#blocksByFile.get(file)` is set to `[]` and deleted if the file's contribution falls to empty.

## 5. Backward compatibility

- v1 notes with `zotero-key: KEY` or `zotero-key: KEYg123` parse correctly.
- v1 multi-annot block IDs (`KEY1aP1g1p2nKEY2aP1g1p3`) split on `n`; each fragment's key gets indexed; the section's `position` is recorded for every key that appears in it.
- v1 annot block IDs without page suffix (`KEYaPARENT`) and without group (`KEYaPARENTpPAGE`) both parse — the regex makes both optional.
- v1 frontmatter that emits `zt-attachments` is preserved and read by Stage 5 directly; NoteIndex ignores it.

No data migration. v2 reads v1-written notes in place.

## 6. Wiring

`apps/obsidian/src/services/build.ts` registers `noteIndex` after `template` and `db` (no inter-deps; ordering is arbitrary but consistent):

```ts
.use({
  noteIndex: () => new NoteIndex({ plugin, app: plugin.app }),
})
```

Logger: `getLogger("note-index")`. The bulk-rebuild count is logged at `debug`. Invalid frontmatter and non-matching block IDs are user data and are skipped silently.

## 7. Tests (Vitest)

`apps/obsidian/src/services/note-index/parse.test.ts` (pure):

- `fileContributions` extracts itemKey, citekey, blocks across representative `CachedMetadata` fixtures (no zotero-key, valid zotero-key with/without group, multi-annot section, mixed sections).
- `diffContributions` reports empty diff for identical inputs; reports correct add/remove for itemKey/citekey changes; reports correct block key add/remove on position-only changes.

`apps/obsidian/src/services/note-index/service.test.ts` (local Obsidian-shaped mocks):

- Synchronous initial scan when `metadataCache.initialized` is true.
- Deferred initial scan when metadata is explicitly uninitialized, then scan on `resolved`.
- Initial scan on `resolved`: populates indices, emits `rebuilt` exactly once.
- `changed` event flow: edit frontmatter → `getNotesByItemKey` reflects new state and `changed(file)` fires.
- No-op metadata changes do not emit `changed`.
- itemKey rename (A → B): file is no longer under A; appears under B. (Fixes the v1 stale-entry bug.)
- `rename` event: lookup by new path works; old path returns empty.
- `delete` event: all three indices drop the file; subsequent queries return empty.
- `getBlocksFor`: file-only, item-only, intersection (both), and the throw-on-neither path.

## 8. Open items

- None for Stage 2. Follow-up consumers land in Stage 5, Stage 7, and Stage 9.
