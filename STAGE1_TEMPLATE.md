# Stage 1 — Template service (spec)

Companion to [`MIGRATION.md`](./MIGRATION.md) §4 Stage 1. This document is the
implementation contract for `apps/obsidian/src/services/template/` — the Eta
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

### 1.2 Out of scope (deferred to consuming stages)

- Feature renderers (`renderNote`, `renderAnnot`, `renderCitations`,
  `renderFilename`) — they need DB-shape data that arrives in stages 3/4/5/9.
- Helper objects (`DocItemHelper`, `AnnotHelper`, `toHelper`) — same reason.
- Frontmatter logic (`extractFrontmatter`, `toFrontmatterRecord`,
  `setFrontmatterTo`) — belongs in Stage 5 (NoteFeatures).
- `template.update-annot-block` and `template.update-overwrite` settings —
  Stage 5/6 own them.
- Eject-defaults command — Stage 6 setting tab.

### 1.3 Dropped from v1

- `@ophidian/core` (`Service`, `use`, `@calc`, `@effect`) — replaced by
  v2's `ServiceContainer` + settings subscriber.
- `vault.trigger("zotero:template-updated", type)` global event — no consumers
  exist in Stage 1, and render-time mtime+size check makes a "template
  changed" event load-bearing for nothing.
- `eta-prf` fork — Eta v4 `Eta` class (from `eta/internal`) covers it.
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
       │    │    templatesSync.remove(path).
       │    ├─ if templatesSync.get(path) → return cached fn
       │    └─ else readFile(path) → compile → store fn + stamp snapshot
       └─ call compiled fn with data → string
```

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
import { Eta } from "eta/internal";

class ObsidianEta extends Eta {
  // assigned in constructor; closure captures the host service
  resolvePath = resolveTemplatePath;
  readFile = readTemplateContent;
}
```

`Eta` from `eta/internal` has no Node `fs` dep; safe for renderer bundle.

Config:

```ts
{
  cache: true,                         // our pre-step invalidates per-file
  autoEscape: false,                   // markdown output, not HTML
  autoFilter: true,
  filterFunction: filterUndefinedNull, // null/undefined → ""; Date → ISO
  get autoTrim() { ... },              // reads current settings tuple
  get views() { ... },                 // reads current template.folder
}
```

Getters on `autoTrim` and `views` keep Eta seeing the latest values without
re-instantiating. (They affect `compileToString`, so cache reset on change
is what actually re-applies them.)

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
  stamp captured at compile time.

### 5.2 Pre-step on every render

Before Eta's `handleCache` runs, the service wraps `render` / `renderString`
to do:

```ts
const file = vault.getFileByPath(resolvedPath);
if (file) {
  const snap = compileSnapshots.get(resolvedPath);
  if (!snap || snap.mtime !== file.stat.mtime || snap.size !== file.stat.size) {
    eta.templatesSync.remove(resolvedPath);
    // snapshot is restamped after the compile below
  }
}
```

If the file is missing (embedded fallback path), no snapshot tracking — the
embedded default never changes within a session, so the first compile is
cached forever.

### 5.3 Stamping on compile

We don't get a compile callback from Eta. Two ways to know we compiled:

- (A) Monkey-patch `compile` on the subclass to capture `(filepath, mtime,
size)` after the upstream call. Simple, contained.
- (B) Hold the cache entry ourselves: pre-check, and on miss read the file
  stat, then call `eta.render` (Eta will compile + store), then stamp the
  snapshot.

We pick **(B)**: the pre-step already knows it's about to (re)compile when it
calls `remove()`, so it stamps `{ mtime, size }` from the same `TFile.stat`
into `compileSnapshots` _before_ delegating to Eta. No monkey-patch needed.
If the compile then throws, the snapshot is overwritten but the cache is
empty — next render restamps on the next compile attempt.

### 5.4 Why both mtime AND size

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

Each handler filters: only files where `path.startsWith(folder + "/")` and
`path.endsWith(".eta.md")`. Folder is read from settings at event time
(not closed over), so it tracks setting changes.

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

Note: the render-time mtime+size check is the _correctness_ mechanism.
The debounced flush is _only_ to keep the sync-readable content map fresh.
If a vault event is missed, the next render still detects the stat drift —
but it would read stale content from the map. So the flush is best-effort
freshness, mtime+size is the safety net.

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

Port `editor/bracket.ts` from v1 verbatim. CodeMirror extension that adds
`<`, `%` to `closeBrackets` config when the editor's active file passes
`isEtaFile(file)` (i.e. `name.endsWith(".eta.md")`). Respects
`autoPairBrackets` / `autoPairMarkdown` from Obsidian's own settings.

Registration follows v1's pattern: a mutable `Extension[]` is registered
once via `plugin.registerEditorExtension(arr)`; the settings subscriber
toggles its content (length=0 or push) and calls
`workspace.updateOptions()`. This avoids the "registerEditorExtension can
only be called from onload" footgun.

### 8.2 EtaSuggest

Port `editor/suggester.ts` from v1 verbatim. Two hints, fires on `<%`, inserts
`<%= it. %>` or `<%  %>`. Always on; not gated by setting.

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
  template: ({ settings }) => new TemplateService({ plugin, app, settings }),
})
```

Position: after `settings` and `log`, before `db` (templates do not depend
on db; the order is arbitrary but service tear-down is LIFO).

### 10.2 `#load()`

```ts
async #load(): Promise<void> {
  await using stack = new AsyncDisposableStack();

  // Wait for settings to land; subsequent re-bootstraps are settings-driven.
  const snapshot = await this.#settings.loaded;
  await this.#bootstrapFolder(snapshot["template.folder"]);

  // Vault events
  stack.defer(this.#registerVaultEvents());
  // Editor extensions
  stack.defer(this.#registerAutoPair());
  stack.defer(this.#registerEtaSuggest());
  // Settings reactivity
  stack.defer(this.#settings.subscribe((s) => {
    if (s === null) return;
    this.#onSettingsChanged(s);
  }));
  // Pending-flush timer cleanup
  stack.defer(() => this.#cancelFlush());

  this.commit(stack.move());
}
```

`#bootstrapFolder(folder)`: recurse, `vault.cachedRead` each `.eta.md`, fill
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

Test plan:

- `render("note", data)` returns the embedded default when no file exists.
- `render("note", data)` reads the vault file when it exists.
- Editing a file (mtime+size changes after a vault `modify` event) causes
  the next render to recompile.
- Two renders without any change reuse the compiled function (assert via
  spy on `eta.compile`).
- `include("annotation", ...)` inside `zt-annots.eta.md` resolves to
  `zt-annot.eta.md` (v1 backward-compat regression test).
- `renderString("<%= it.x %>", { x: 1 })` returns `"1"`.
- Folder change rebuilds the content map and resets the compile cache.
- autoTrim setting change resets the compile cache.
- Bursts of vault events collapse into a single flush (assert with fake
  timers + spy on `vault.cachedRead`).
- Auto-pair extension list toggles when the setting toggles.
- Disposal cancels the pending-flush timer and unsubscribes events.
