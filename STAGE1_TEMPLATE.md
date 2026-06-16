# Stage 1 — Template service (implemented)

Companion to [`MIGRATION.md`](./MIGRATION.md) §4 Stage 1. This document is the
implementation record for `apps/obsidian/src/services/template/` — the Eta
engine wiring, vault-folder integration, and editor helpers.

v1 source: `/Users/aidenlx/repo/zotlit-repo/zotlit-v1/app/obsidian/src/services/template/`.

## 1. Scope

### 1.1 In scope (Stage 1)

- Eta v4 instance subclassed for vault-backed template loading.
- Folder watcher: preload `.eta.md` files under `template.folder` into an
  in-memory map; keep map in sync via vault events.
- mtime+size cache invalidation, evaluated at render time.
- Embedded default fallback for the 7 canonical templates.
- Editor helpers: auto-pair (CodeMirror) + EtaSuggest (`EditorSuggest`).
- Public API: `render(name, data)` and `renderString(source, data)`.
- Stage 1 keeps the renderer inside `apps/obsidian`; a separate
  `packages/templates` extraction was deferred until there is a real
  cross-package consumer.

### 1.2 Out of scope (deferred to consuming stages)

- Feature renderers (`renderNote`, `renderAnnot`, `renderCitations`,
  `renderFilename`) — they need DB-shape data that arrives in stages 3/4/5/9.
- Helper objects (`DocItemHelper`, `AnnotHelper`, `toHelper`) — same reason.
- Frontmatter logic (`extractFrontmatter`, `toFrontmatterRecord`,
  `setFrontmatterTo`) — belongs in Stage 5 (NoteFeatures).
- Eject-defaults command — Stage 6 setting tab.

### 1.3 Dropped from v1

- `updateAnnotBlock` / `updateOverwrite` (v1) — block-ID/overwrite-gating
  infra removed in Stage 5; no v2 schema keys.
- `@ophidian/core` (`Service`, `use`, `@calc`, `@effect`) — replaced by
  v2's `ServiceContainer` + settings subscriber.
- `vault.trigger("zotero:template-updated", type)` global event — no consumers
  exist in Stage 1, and render-time mtime+size check makes a "template
  changed" event load-bearing for nothing.
- `eta-prf` fork — Eta v4 `Eta` class (from `eta/core`) covers it.
- `tplFileCache: WeakMap<TFile, string>` — replaced by `Map<path, string>`
  keyed by path. Rename events update the key directly; no GC hazard.
- The fork's `mtime` field on `TemplateFunction` — we track `(mtime, size)`
  parallel to `templatesSync` in a `Map`.
- `patchCompile` post-processor for `annotation` / `filename` templates —
  those callout-wrap and filenamify steps move into Stage 5/feature code,
  where the responsibility lives.

## 2. Architecture

```
SettingsService  ─┐
                  │  template.folder
                  │  template.filename     ┌──────────────────────────┐
                  │  template.auto-pair-eta│  TemplateService         │
                  │  template.auto-trim-*  │                          │
                  └──→ subscribe ─────────→│  - Eta subclass          │
                                           │  - content Map<path,str> │
  Vault events ──→ debounced flush ──────→│  - snapshot Map<path,    │
  (create/modify/                         │     {mtime,size}>        │
   rename/delete                           │  - autoPair extension    │
   on *.eta.md                             │  - EtaSuggest            │
   under folder)                           │                          │
                                           │  render(name, data)      │
                                           │  renderString(src, data) │
                                           └──────────────────────────┘
```

### 2.1 Render path

```
render(name, data)
  → eta.render(name, data)
       ├─ resolvePath(name)              # name → absolute vault path
       ├─ handleCache(template, opts)
       │    ├─ pre-step (our wrapper):
       │    │    look up TFile by path; compare (mtime,size) against
       │    │    snapshot Map. If mismatch (or absent),
       │    │    templatesSync.remove(path) and stamp the snapshot.
       │    ├─ if templatesSync.get(path) → return cached fn
       │    └─ else readFile(path) → compile → store fn
       └─ call compiled fn with data → string
```

`renderString(source, data)` calls Eta's literal-string path directly. It
does not resolve a file, read from the vault, or participate in the
file-backed compile cache.

Sync end-to-end. No `renderAsync` — Stage 1 has no async consumers, and
async would force every consumer to await.

## 3. Settings consumed

| Key                           | Effect                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `template.folder`             | Eta `views` base dir; folder watched for `.eta.md`. On change: full rebuild. |
| `template.filename`           | Raw string; rendered by `renderString` on demand. Not file-backed.           |
| `template.auto-pair-eta`      | Enables CodeMirror auto-pair extension for `<` / `%` on `.eta.md`.           |
| `template.auto-trim-leading`  | First element of Eta `config.autoTrim` tuple. On change: cache reset.        |
| `template.auto-trim-trailing` | Second element of Eta `config.autoTrim` tuple. On change: cache reset.       |

Defaults already exist in `services/settings/schema.ts`; no schema changes.

## 4. Eta engine

### 4.1 Subclass

```ts
// services/template/eta.ts
import { Eta } from "eta/core";

class ObsidianEta extends Eta {
  // assigned in constructor; closure captures the host service.
  resolvePath = resolveTemplatePath;
  readFile = readTemplateContent;
}
```

`Eta` from `eta/core` has no Node `fs` dep; safe for renderer bundle.

Config:

```ts
{
  cache: true,                         // our pre-step invalidates per-file
  autoEscape: false,                   // markdown output, not HTML
  autoFilter: true,
  filterFunction: filterUndefinedNull, // null/undefined → ""; Date → ISO
  plugins: [directIncludeDataPlugin],  // preserve v1 include(data) behavior
  get autoTrim() { ... },              // reads current settings tuple
  get views() { ... },                 // reads current template.folder
}
```

Getters on `autoTrim` and `views` keep Eta seeing the latest values without
re-instantiating. (They affect `compileToString`, so cache reset on change
is what actually re-applies them.)

`directIncludeDataPlugin` patches Eta's generated helper so
`include("template", array)` passes the array through directly. Eta 4's
default helper spreads include data into the parent object, which turns arrays
into objects and breaks v1's `zt-annots.eta.md` default.

### 4.2 `resolvePath`

Mirrors v1's `completePath` + `resolvePath` logic, simplified:

1. If the name maps to a canonical template (`note`, `field`, `annots`,
   `annotation`, `cite`, `cite2`, `colored`), expand via `toFilename`:
   - `annotation` → `zt-annot.eta.md` (v1 wart preserved for backward compat
     with users who ejected v1 defaults; see §6.2).
   - All others → `zt-${name}.eta.md`.
2. Else append `.eta.md` (or change `.eta` → `.eta.md`).
3. Join with parent template's directory (when included) or `views` root.
4. Reject paths that escape `views` with `EtaError("not in views directory")`.

### 4.3 `readFile`

```
readFile(absPath):
  if contentMap.has(absPath): return contentMap.get(absPath)
  if absPath maps to a canonical template (reverse of toFilename):
    return EMBEDDED_DEFAULTS[name]
  throw EtaError(`File '${absPath}' not found`)
```

`contentMap` is `Map<path, string>` populated by the folder watcher.

## 5. Cache invalidation: mtime + size

Mirrors `DatabaseService`'s freshness pattern (see
`services/database/service.ts:141`).

### 5.1 What we track

- `templatesSync: Cacher<TemplateFunction>` — Eta's own per-path compile cache.
- `compileSnapshots: Map<path, { mtime: number; size: number }>` — our parallel
  stamp captured before a file-backed render attempt.

### 5.2 Pre-step on every render

Before Eta's `handleCache` runs, `ObsidianEta.render` resolves the path and
asks the service to prepare file-backed templates:

```ts
const file = vault.getFileByPath(resolvedPath);
if (file) {
  const snap = compileSnapshots.get(resolvedPath);
  if (!snap || snap.mtime !== file.stat.mtime || snap.size !== file.stat.size) {
    eta.templatesSync.remove(resolvedPath);
    compileSnapshots.set(resolvedPath, {
      mtime: file.stat.mtime,
      size: file.stat.size,
    });
  }
}
```

If the file is missing (embedded fallback path), no snapshot tracking — the
embedded default never changes within a session, so the first compile is
cached forever.

`renderString(source, data)` bypasses this path because it has no filepath and
does not use the template-file cache.

### 5.3 Stamping behavior

The implementation deliberately avoids monkey-patching Eta's `compile`. When a
file-backed render sees a missing or changed stamp, it removes the compiled
function and stores the current `{mtime, size}` before delegating to Eta. Eta
then recompiles on cache miss using `readFile(path)`.

If compile throws, the snapshot may already hold the latest stat while the Eta
cache remains empty. The next render still retries compilation because there is
no cached function to return.

### 5.4 Why both mtime and size

- mtime resolution on some filesystems is 1s; rapid edits within the same
  second can collide.
- size catches truncations or appends that happen to land on the same mtime.
- Cheap: both come from `TFile.stat` which Obsidian already maintains.

## 6. Folder watcher

### 6.1 Subscribe shape

`#load()` registers vault event handlers on:

- `vault.on("create", onChange)`
- `vault.on("modify", onChange)`
- `vault.on("rename", onRename)` — needs old-path arg
- `vault.on("delete", onDelete)`

Each handler filters with `isEtaTemplatePath(path)` and
`isPathInFolder(path, folder)`. Folder is read from settings at event time
(not closed over), so it tracks setting changes; an empty folder watches all
vault `.eta.md` files.

### 6.2 Debounced flush

To absorb bursts (folder import, mass rename, git checkout) the watcher
maintains a `pending: Set<path>` and a `setTimeout` (~500ms, matching
`DatabaseService.DEBOUNCE_MS`).

```
onChange(file):
  pending.add(file.path)
  scheduleFlush()

scheduleFlush():
  if timer set: return
  timer = setTimeout(() => {
    timer = null
    flush()
  }, 500)

flush():
  paths = drain(pending)
  await Promise.all(paths.map(p => readAndStore(p)))
  for path in paths: eta.templatesSync.remove(path)
```

`readAndStore(path)` calls `vault.cachedRead(file)` and writes to
`contentMap`. On delete, removes from `contentMap`. Removing from
`templatesSync` after the read ensures the next render finds either the
fresh content or (if the file is gone) falls back to the embedded default.

The debounced flush keeps the sync-readable `contentMap` fresh. The render-time
mtime+size check protects Eta's compiled-function cache after that content map
has been refreshed; it is not a replacement for the vault read because Eta's
sync `readFile` hook must return from memory.

### 6.3 Folder setting change

When `template.folder` changes via settings subscription:

1. Clear `contentMap`, `compileSnapshots`, `eta.templatesSync.reset()`.
2. Cancel pending flush timer; drop `pending` set.
3. Rescan new folder (recurse, read each `.eta.md`, populate `contentMap`).
   No need to repopulate `compileSnapshots` — next render's pre-step will
   compile + stamp.

### 6.4 autoTrim setting change

`eta.templatesSync.reset()`. Compiled functions have autoTrim baked in.

## 7. Embedded defaults

### 7.1 Storage

```
src/services/template/defaults/
  zt-note.eta.md
  zt-field.eta.md
  zt-annot.eta.md           # canonical name: "annotation"
  zt-annots.eta.md
  zt-cite.eta.md
  zt-cite2.eta.md
  zt-colored.eta.md
```

Content imported verbatim from v1 (no rewrites — including the
`include("annotation", ...)` line in `zt-annots.eta.md`, which is what makes
the canonical-name wart load-bearing).

### 7.2 Loaded as raw strings

```ts
import zNote from "./defaults/zt-note.eta.md?raw";
import zField from "./defaults/zt-field.eta.md?raw";
// ...

export const EMBEDDED_DEFAULTS: Record<TemplateName, string> = {
  note: zNote,
  field: zField,
  annotation: zAnnot, // file is zt-annot.eta.md but canonical key is "annotation"
  annots: zAnnots,
  cite: zCite,
  cite2: zCite2,
  colored: zColored,
};
```

Vite's `?raw` import suffix handles it; no plugin required.

### 7.3 Canonical names registry

```ts
const CANONICAL_NAMES = [
  "note",
  "field",
  "annotation",
  "annots",
  "cite",
  "cite2",
  "colored",
] as const;

function toFilename(name: string): string | null {
  if (name === "annotation") return "zt-annot.eta.md"; // v1 wart
  if (CANONICAL_NAMES.includes(name as TemplateName))
    return `zt-${name}.eta.md`;
  return null;
}

function fromFilename(filepath: string, folder: string): TemplateName | null {
  // reverse of toFilename, used by readFile to find the embedded fallback
  // when the file is absent.
}
```

## 8. Editor helpers

### 8.1 Auto-pair

Port `editor/bracket.ts` from v1's behavior. CodeMirror extension that adds
`<`, `%` to `closeBrackets` config when the editor's active file passes
`isEtaTemplatePath(file.path)`. Respects
`autoPairBrackets` / `autoPairMarkdown` from Obsidian's own settings.

Registration follows v1's pattern: a mutable `Extension[]` is registered
once via `plugin.registerEditorExtension(arr)`; the settings subscriber
toggles its content (length=0 or push) and calls
`workspace.updateOptions()`. This avoids the "registerEditorExtension can
only be called from onload" footgun.

### 8.2 EtaSuggest

Port `editor/suggester.ts` from v1's behavior. Two hints, fires on `<%`,
inserts the interpolation or evaluation prefix inside the Eta tag, and leaves
the cursor before the closing `%>` when auto-pairing supplied it. Always on;
not gated by setting.

Registered with `plugin.registerEditorSuggest(new EtaSuggest(app))`.

## 9. Service API

```ts
// services/template/service.ts
export interface TemplateServiceOptions {
  plugin: Plugin;
  app: App;
  settings: SettingsService;
}

export class TemplateService extends Service<void> {
  constructor(options: TemplateServiceOptions);

  /**
   * Render a named template. Looks up the file at
   * `${folder}/${toFilename(name)}`; if absent and name is canonical,
   * falls back to the embedded default. Synchronous.
   *
   * @throws EtaError when the template can't be resolved, compiled, or
   *   when rendering throws. Callers wrap in toast.promise / try/catch.
   */
  render<T>(name: string, data: T): string;

  /**
   * Render a literal template string (no file lookup, no cache).
   * Used by callers for the `template.filename` setting value.
   *
   * @throws EtaError on compile or runtime errors.
   */
  renderString<T>(source: string, data: T): string;
}
```

No event emitter on the service (no consumer in Stage 1). Adding one is
trivial later if Stage 9 (annot view) needs to re-render on template edits.

## 10. Lifecycle (DI + disposal)

### 10.1 Registration

Added in `services/build.ts`:

```ts
.use({
  template: ({ settings }) =>
    new TemplateService({ plugin, app: plugin.app, settings }),
})
```

Position: after `settings` and `log`, before `db` (templates do not depend
on db; the order is arbitrary but service tear-down is LIFO).

### 10.2 `#load()`

```ts
async #load(): Promise<void> {
  const snapshot = await this.#settings.loaded;
  this.#lastTemplateFolder = normalizeVaultPath(snapshot["template.folder"]);
  this.#lastAutoTrim = [
    snapshot["template.auto-trim-leading"],
    snapshot["template.auto-trim-trailing"],
  ];
  this.#lastAutoPairEta = snapshot["template.auto-pair-eta"];

  await using stack = new AsyncDisposableStack();
  await this.#rebuildFolder(this.#lastTemplateFolder);

  stack.defer(this.#registerVaultEvents());
  stack.defer(this.#registerAutoPair());
  stack.defer(this.#registerEtaSuggest());
  stack.defer(this.#settings.subscribe((s) => {
    if (s === null) return;
    this.#onSettingsChanged(s);
  }));
  stack.defer(() => this.#cancelFlush());

  this.#loaded = true;
  this.commit(stack.move());
}
```

`#rebuildFolder(folder)`: recurse, `vault.cachedRead` each `.eta.md`, fill
`contentMap`. Empty folder is fine (embedded defaults still serve renders).

### 10.3 `#onSettingsChanged(s)`

Diff against last-snapshot fields:

| Setting changed          | Action                                         |
| ------------------------ | ---------------------------------------------- |
| `template.folder`        | Full rebuild (§6.3).                           |
| `template.auto-trim-*`   | `eta.templatesSync.reset()`.                   |
| `template.auto-pair-eta` | Toggle CodeMirror extension array (§8.1).      |
| `template.filename`      | No-op (rendered on demand via `renderString`). |

Other settings: ignored.

### 10.4 Disposal

`AsyncDisposableStack` runs deferred handlers in LIFO. The pending-flush
timer cancel runs first; vault event unsubs and editor unregisters follow.
After dispose, `contentMap` and `compileSnapshots` are GC'd with the
service instance.

## 11. Error handling

No wrapping, no retries. Methods throw and the caller decides:

- `render(name, data)` throws when:
  - `resolvePath` rejects (path outside `views`, or name doesn't normalize).
  - `readFile` can't find content or embedded default.
  - Compile fails (Eta syntax error in user-edited template).
  - Render fails (runtime error in template body).
- `renderString(source, data)` throws on compile or runtime error.

Consumers wrap in `try/catch` for inline use or pass the promise to
`toast.promise` for async-driven UX (Stage 5/3).

Logging: the service uses `getLogger("template")` for debug breadcrumbs
(folder rebuild, flush events, file-not-found embedded fallback) but does
not log render errors — the consumer's catch block is the right place to
attach the user-facing context.

## 12. Tests

Vitest with the local `__mocks__/obsidian.ts`. Extensions to the mock:

- `Vault.recurseChildren` (mirror Obsidian's recursive walk over `TFolder`).
- `vault.cachedRead(file)` returning the test fixture content.
- `TFile.stat` with `mtime` and `size`.
- Event firing helpers for `create`/`modify`/`rename`/`delete`.

Implemented coverage in `services/template/service.test.ts`:

- `render("note", data)` returns the embedded default when no file exists.
- Embedded `zt-annots.eta.md` includes resolve the canonical
  `"annotation"` template name to `zt-annot.eta.md`.
- `render("note", data)` reads the vault file when it exists.
- Editing a file (mtime+size changes after a vault `modify` event) causes
  the next render after the debounced flush to recompile.
- `renderString("<%= it.x %>", { x: 1 })` returns `"1"`.
- Folder change rebuilds the content map and resets the compile cache.
- Auto-pair extension list toggles when the setting toggles.
- Disposal unsubscribes vault events.

Worth adding if this service changes again:

- Two renders without any change reuse the compiled function.
- autoTrim setting changes reset the compile cache.
- Bursts of vault events collapse into a single flush.
- Rename/delete events update `contentMap` and fall back to embedded defaults.
