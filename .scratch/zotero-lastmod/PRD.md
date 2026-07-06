Status: ready-for-agent

# `zotero-lastmod` — skip-if-unchanged for batch note re-import

## Problem Statement

Batch re-importing Zotero notes (via `import-notes` protocol action, "Import child notes" command, or Zotero context menus) unconditionally overwrites every existing Imported Note file, even when the source Child Note in Zotero hasn't changed since the last import. On large libraries this wastes time, produces unnecessary vault file-change events, and clutters Obsidian Sync / version-control diffs with identical rewrites.

## Solution

Persist the source Child Note's Zotero `dateModified` as a `zotero-lastmod` frontmatter field on every Imported Note. During batch classification, compare this stored timestamp against the live DB value and classify unchanged notes as "up-to-date" — presented in the batch modal as a static informational group so the user sees what was skipped. Up-to-date items are excluded from the run automatically. Single-note explicit re-import is unaffected (always confirms).

## User Stories

1. As a user with a large Zotero library, I want batch re-import to skip notes that haven't changed in Zotero, so that re-importing 50 child notes completes in seconds instead of rewriting all 50 files.
2. As a user, I want to see which notes were skipped as "up to date" in the batch modal, so that I know the system isn't silently ignoring my notes.
3. As a user, I want single-note explicit re-import ("Update imported note from Zotero") to always ask for confirmation, so that I don't accidentally lose local edits.
4. As a user with Imported Notes created before this feature, I want those notes to be treated as stale on the next batch re-import, so that they gain `zotero-lastmod` and participate in future skip-if-unchanged checks.
5. As a user, I want lazy-created Imported Notes (auto-materialized during Literature Note create/update via `noteLink()`) to also carry `zotero-lastmod`, so that a future batch re-import can skip them if unchanged.
6. As a user of the hierarchy batch modal ("Import child notes from parent"), I want the same skip-if-unchanged optimization, so that the behavior is consistent regardless of how I trigger import.

## Implementation Decisions

### Frontmatter field

- **Name**: `zotero-lastmod`. Added to `RESERVED_KEYS` alongside `zotero-key`, `citekey`, `zotero-atchs`, `zotero-note-key`.
- **Constant**: `FIELD_ZOTERO_LASTMOD` in `constants.ts`.
- **Value**: the source Child Note's `dateModified` serialized via `stringifyInstant()` (local datetime, no offset — same format as the existing `date` field). On read-back, an offset-less string is assumed to be in the local timezone.
- **Scope**: Imported Notes only. Literature Notes are out of scope.

### Write path

`writeNote()` in `note-import/service.ts` is the single write point for all Imported Notes (both lazy-created and explicitly imported). The frontmatter object gains `zotero-lastmod`:

```ts
const frontmatter = {
  date: stringifyInstant(note.dateAdded),
  [FIELD_ZOTERO_NOTE_KEY]: note.indexedKey,
  [FIELD_ZOTERO_LASTMOD]: stringifyInstant(note.dateModified),
};
```

### Read path — `lastmodFromFrontmatter()`

A new helper in `note-index/parse.ts` (colocated with `itemKeyFromFrontmatter` / `noteKeyFromFrontmatter`):

- Reads `cache.frontmatter["zotero-lastmod"]`.
- Parses the string as a local datetime → `Temporal.Instant` (assuming local timezone if no offset/Z suffix present).
- Returns `Temporal.Instant | null`.

This helper is **not** integrated into the Note Index (`NoteIndex` gains no new maps or tracked fields). It is read on demand from Obsidian's `metadataCache` during batch classification.

### Classification — `toAction()` gains `"up-to-date"`

`toAction()` in `batch-import.ts` currently takes `(noteIndex, note) → ImportAction` returning `"create" | "overwrite"`. The change:

- `toAction()` gains access to `metadataCache` (or the `App`) — the enclosing `classifyNoteImport` / `classifyChildImport` already have access to the full dependency context.
- When an existing file is found, read its `zotero-lastmod` via `lastmodFromFrontmatter()`.
- Compare at **epoch-seconds granularity** (Zotero only tracks seconds internally): if `vaultLastmod.epochSeconds === note.dateModified.epochSeconds`, classify as `"up-to-date"`.
- Missing `zotero-lastmod` (pre-existing notes without the field) → treat as stale → classify as `"overwrite"`. Self-healing: one re-import cycle backfills the field.

The `ImportAction` discriminated union gains a third variant:

```ts
| { note: ChildNote; label: string; kind: "up-to-date"; file: TFile }
```

### Batch modal UX

Both `openNoteImportModal` and `openChildImportModal` add a third group definition to their `FlatManifest` / `HierarchyManifest`:

```ts
{ kind: "up-to-date", header: m.batch_import_group_up_to_date }
```

This group renders at the bottom as a static informational list (not interactive — items are excluded from the run automatically). The `FlatManifest` / `HierarchyManifest` render it via the `upToDate` / `upToDateHeader` options.

### Unchanged paths

- **Single-note explicit re-import** (`importSingleNote`, `reimportNoteByKey`): no staleness check, always shows the confirmation dialog. The user explicitly chose one note; they probably mean it.
- **Lazy import during Literature Note create/update** (`resolveChildNote` → `flushQueue`): create-only behavior unchanged. `writeNote()` writes `zotero-lastmod` on creation, so the field is present for future batch checks.
- **Note Index**: no structural changes. No new maps, no new tracked fields. `zotero-lastmod` is read from `metadataCache` on demand.

### Paraglide message

One new message key: `batch_import_group_up_to_date` (e.g. "Up to date ({count})").

### CONTEXT.md

The **Imported Note** glossary entry in `apps/obsidian/CONTEXT.md` is updated to mention `zotero-lastmod`.

## Testing Decisions

### Test seam

The single test seam is `toAction()` in `batch-import.ts`. This is the classification function where all the interesting logic converges: existence check, frontmatter read, timestamp comparison, and the three-way discriminated union output.

### What makes a good test here

Tests exercise the external behavior of `toAction()` — given a `ChildNote` with a known `dateModified` and a mock `NoteIndex` + `metadataCache` returning controlled frontmatter, assert the resulting `ImportAction.kind`. Tests should not assert internal details like how the timestamp is parsed or which `Temporal` methods are called.

### Cases to cover

1. **No existing file** → `"create"` (unchanged behavior).
2. **Existing file, no `zotero-lastmod` in frontmatter** → `"overwrite"` (missing = stale).
3. **Existing file, `zotero-lastmod` matches `note.dateModified`** → `"up-to-date"`.
4. **Existing file, `zotero-lastmod` is older than `note.dateModified`** → `"overwrite"`.
5. **Existing file, `zotero-lastmod` is newer than `note.dateModified`** (clock skew / edge case) → `"overwrite"` (only exact match skips).

### Prior art

`batch-import.test.ts` already tests classification through the `driveLastModal()` helper that captures the `FlatManifest` options. The existing test "classifies an existing mirror as an overwrite with its target file" is the direct precedent — the new tests follow the same pattern but vary the mock `metadataCache` return value.

The `makeDeps()` helper will need a small extension to inject a mock `metadataCache` (or `App`) into the dependency set — mirroring how `existing` already controls the `noteIndex.getImportedNoteByNoteKey` stub.

## Out of Scope

- **Literature Note staleness** — `zotero-lastmod` on Literature Notes, and skip-if-unchanged in `runBatchUpdate`, are separate design questions with different update contracts (managed-region partial overwrite vs whole-body).
- **Auto-update** — automatically re-importing stale notes when a Zotero change is detected (e.g. via `LiveUpdateService` `item/update` events). This PRD only adds the staleness stamp and the batch-time comparison.
- **UI for staleness outside batch modals** — e.g. a sidebar indicator or status bar showing "3 imported notes are out of date." Informational uses of `zotero-lastmod` beyond the batch flow are deferred.

## Further Notes

- The test vault fixtures (`tests/zt-vault/zotero_notes/`) already carry `zotero-note-modified` — a legacy/fixture-only field name. Production code uses `zotero-lastmod`. The fixtures should be updated to match.
- `stringifyInstant()` default output is a local datetime without offset (e.g. `2026-05-29T13:18:19`). The `lastmodFromFrontmatter()` parser must handle both offset-less and offset/Z-suffix strings, assuming local timezone for the former.
- Zotero tracks `dateModified` at second granularity internally. The comparison uses `epochSeconds` equality, not sub-second precision.
