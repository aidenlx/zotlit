# What Obsidian throws

This reference catalogues what the Obsidian methods ZotLit wraps throw or reject with, and when, so a capability tag can decide an expected outcome before it calls Obsidian instead of matching the error afterwards. Read the method in `app.js` again (`/obsidian-asar-extract`) before a member wraps a new method or handles its failure.

- **Obsidian version read:** 1.15.0 (`~/Library/Application Support/obsidian/obsidian-1.15.0.asar`, the auto-updated runtime that is installed). Extracted to `node_modules/.ob-rev-1.15.0/`. Line numbers below are in `node_modules/.ob-rev-1.15.0/app.js` unless the file is named (`main.js` is the Electron main process in the same folder).
- The plugin compiles against `obsidian` 1.14.4 (the version the app bundle at `/Applications/Obsidian.app` ships). Verified on both: line numbers cite 1.15.0 (the running build); the load-bearing literals and structures were re-checked in `node_modules/.ob-rev-1.14.4/app.js` (down-leveled to generators, so different lines): the three "exists" messages (74591, 74610, 74629, 30571), the timeout (31200), `Request failed, status ` (65382), the three `Fk` messages (69770–69779), `readJson` `ENOENT` → `null` else log → `undefined` (74416–74420), `writeJson` swallowing (74425–74443), `rmdir` `recursive: t` (30246–30257), the `renameFile` early return (93159–93165), `processFrontMatter` md-only + scalar → `{}` (93982–93999, 94088–94091), `H2` `throw r.errors[0]` (41186). Minified names below belong to 1.15.0 only. Node behavior (`ERR_FS_EISDIR` from `fs.rm` on a folder, `ENOENT` from `writeFile` into a missing folder, `code` dropped by structured clone) was confirmed with a local `node -e` probe.
- Spec: aidenlx/zotlit#1723; the cache decision: aidenlx/zotlit#1735.

## How ZotLit decides an expected outcome

ZotLit does not classify what Obsidian throws (policies/events.md, Capability tags → Expected outcomes; lint rule `zotlit-errors/no-message-match`). A capability tag decides an expected outcome from Obsidian's state before the call, as Obsidian does itself where it must not collide (`getAvailablePath`, 65166; `getOrCreateFolder`), and fails with a tagged error. The message check inside `Vault.create` (65022) is only Obsidian's last guard.

| Outcome | Tag member | Decision | Callers |
|---|---|---|---|
| `FileExists` | `Vault.create` | `getAbstractFileByPath(path) !== null`: a file or a folder in the vault cache. Case-sensitive, so a name that differs only in case is not found; on a case-insensitive disk Obsidian then throws `"File already exists."` (see `create` under [Vault](#vault-dn)), and that is a `VaultError`. | note import (skip), Partial unpack (keep the reader's file), Profile save (refuse), Profile create (second name), Profile import ("import changed"), Default eject (open the existing file), Literature Note create (resolves a free path in the cache; a note that took it since fails) |
| `FileExists` | `FileManager.renameFile` | `getAbstractFileByPath(normalizePath(newPath))` holds a file or folder other than the moved file. As `Vault.rename` (65081–65086, 27586–27595): a move to the file's own path is no move, and a case-only change of the file's own name is not found by the case-sensitive lookup, so it is no collision either. | Profile delete with a folder move, and a Profile switch with a folder move (and its rollback): the move fails, as before, now with `"File already exists."` in place of Obsidian's `"Destination file already exists!"` |

Every other rejection is a `VaultError` with Obsidian's `message` and the original `cause`, unclassified. A new outcome adds one tagged error and one cache decision in the tag, and only when a caller handles it. No fallback covers a cache that lags the disk.

Not used, so not decided: `createFolder` on a taken path (`"Folder already exists."`), a folder at a `create` path as its own outcome (`IsFolder`), and the errno cases (`ENOENT`, `EISDIR`, …). `template-workbench/inspect.ts` still reads `ENOENT` from `vault.adapter.read`: it compares the disk to the cache, so the cache cannot decide it.

## Name map (export block, app.js 119341–119474)

| Public | Minified | Defined at |
|---|---|---|
| `Vault` | `Dn` | 64764 |
| `FileSystemAdapter` (desktop) | `fi` | 27379 (built at 162450 with `original-fs`) |
| mobile Capacitor adapter (not exported) | `Rk` (low-level fs) + adapter class | 63828, ~63990–64320 |
| `FileManager` | `dv` | 80345 |
| `Plugin` | `FE` | 125958 |
| `parseYaml` / `stringifyYaml` | `en` / `va` | 73331 / 73334 |
| `requestUrl` | `Ya` | 60676 |
| `normalizePath` | `xe` | — |

## Shared mechanics

1. **Every `FileSystemAdapter` call runs through `queue`** (27871). A call can lose a race to a 60 s watchdog: `thingsHappening` is a 60 s debounce of `kill` (27381), and `kill` rejects the in-flight call with `new Error("File system operation timed out.")` (27868). The underlying fs work is not cancelled. This applies to every vault method below.
2. **Desktop fs errors are raw Node errors** from `original-fs` `promises` (162441, 27385): `code` (`ENOENT`, `EEXIST`, `EISDIR`, `ENOTDIR`, `EACCES`, `EPERM`, `EBUSY`, `ENOTEMPTY`, `EXDEV`, …), `errno`, `syscall`, `path` (absolute OS path), and a message such as `ENOENT: no such file or directory, open '/abs/path/Note.md'`. The message contains the absolute path, so it is never a stable match key; `code` is.
3. **Mobile normalizes one case only**: `oo()` (63817–63825) sets `code = "ENOENT"` on a Capacitor rejection whose message contains `"does not exist"`. Other Capacitor rejections have no Node `code`. Mobile `mkdir` swallows `message === "Directory exists"` (64023, 64046).
4. **Path validation `Fk`** (63798–63806, called as `Vault.checkPath`, 64955) throws plain `Error`s:
   - `"File names cannot end with a dot or a space."` (Windows only, `rp`)
   - `"File name is forbidden: " + name` (Windows only, reserved names `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`, 63790)
   - `"File name cannot contain any of the following characters: " + Cp` (any OS, any path segment matching `pc`)
5. **No vault error is localized.** Every `throw new Error(...)` in Vault, the adapters and `Fk` is a literal English string; none goes through the i18n proxy `y.*`. They are developer-facing, not shown by Obsidian. The only localized text on these paths is UI that Obsidian shows itself: the link-update modal and notice inside `renameFile` (80483–80515, `y.dialogue.*`). (`y.dialogue.msgHeadingNotFound` at 80884 is localized and thrown, but from `insertIntoFile`, which ZotLit does not wrap.)
6. All thrown errors are plain `Error` (prototype `Error`, `name === "Error"`), except Node fs errors, YAML errors (`name: "YAMLParseError"`), and `requestUrl`'s status error (a private `Error` subclass).

## Vault (`Dn`)

| Method | Throw / reject | Class, message | Condition | Line |
|---|---|---|---|---|
| `read(file)` | fs read error | Node errno: `ENOENT` (file gone from disk), `EISDIR`, `EACCES`/`EPERM` | `fsPromises.readFile(path, "utf8")` | 65043, 27472–27481 |
| | timeout | `Error("File system operation timed out.")` | watchdog | 27868 |
| `cachedRead(file)` | same as `read` | | cache miss falls through to `read`; a hit never rejects | 65047 |
| `process(file, fn)` | fs read error | Node errno (`ENOENT`, …) | `readFile` before `fn` runs | 27538 |
| | **whatever `fn` throws** | raw, unwrapped | `fn` runs inside the adapter queue; file untouched | 27539 |
| | fs write error | Node errno | `writeFile` / `utimes` after `fn` | 27542 |
| | (no write when `fn` returns the input unchanged) | | | 27540 |
| `create(path, data)` | path invalid | `Error` from `Fk` (above) | | 65021, 63798 |
| | **already exists** | `Error("File already exists.")` | `adapter.exists(path)` with no case-sensitive flag → bare `fs.access`; on a case-insensitive filesystem (the default on macOS/Windows) a **different-case** name also counts | 65021–65022, 27650–27661 |
| | parent folder missing | Node `ENOENT` | `create` does **not** make parents (`writeFile` only) | 65023, 27497 |
| | parent is a file | Node `ENOTDIR` | | 27497 |
| | other | Node `EACCES`/`EPERM`/`ENOSPC`… | | 27497 |
| | **resolves `null`, no error** | the write succeeded but `getAbstractFileByPath` finds nothing: the path is one Obsidian ignores (`om(path)`, e.g. a dot-prefixed segment or the config dir), so `reconcileFile` routes it to deletion; `obsidian.d.ts` says `Promise<TFile>` | 65024–65025, 27753 |
| `createFolder(path)` | path invalid | `Error` from `Fk` | | 65037 |
| | **already exists** | `Error("Folder already exists.")` | `adapter.exists`; also fires when a **file** sits at that path | 65037–65038 |
| | fs error | Node errno (`ENOTDIR` when an ancestor is a file, `EACCES`) | `mkdir(…, {recursive: true})`, so missing parents are made | 27440–27444 |
| | **resolves `null`, no error** | same ignored-path case as `create` | 65040–65041 |
| `trash(file, system)` | system trash failure is **silent** | — | main process `shell.trashItem` failure returns `false` (main.js 6336–6342), then Vault falls back to local trash | 65074–65078, 27446–27451 |
| | local trash: fs error | Node errno: `ENOENT` (source gone), `EACCES`, `EXDEV` | `mkdir .trash` + `fs.rename` into `.trash` (name suffixed ` 2`, ` 3`, … on collision) | 27452–27464 |
| | root / null | silent no-op | | 65075 |
| `delete(file, force)` | file: fs error | Node errno (`ENOENT`, `EACCES`, `EPERM`, `EBUSY`) | `fs.unlink` | 65070, 27575–27580 |
| | **folder with `force` false** | Node `ERR_FS_EISDIR` (SystemError, "Path is a directory: rm returned EISDIR …") | `fs.rm(dir, {recursive: false})` refuses any directory, empty or not | 65071, 27465–27471 |
| | mobile folder | always recursive, `force` ignored | | 63908, ~64055 |
| `rename(file, newPath)` | path invalid | `Error` from `Fk` | only when the path changes | 65086 |
| | **destination exists** | `Error("Destination file already exists!")` — a **different** message from `create` | `_exists(dest, false)`, except a case-only rename on a case-insensitive disk | 27591–27595 (mobile 64191) |
| | fs error | Node `ENOENT` (source gone, or destination parent missing: no parents made), `EXDEV`, `EACCES`, `ENOTEMPTY` | `fs.rename` | 27598 |
| | external file (`wi`) | delegated to `externalFileManager.rename` | | 65081–65083 |
| `modify(file, data)` | fs error | Node errno, rethrown after clearing the cache | `writeFile`; a deleted file is **recreated**, not an error (`ENOENT` only if its parent folder is gone) | 65088–65097, 27493–27502 |
| `getFileByPath(path)` | **never throws** | returns `TFile`, an external-file stand-in when `canOpenExternalFiles`, or `null`; no `normalizePath` applied | | 64912–64919 |

## FileManager (`dv`)

| Method | Throw / reject | Condition | Line |
|---|---|---|---|
| `processFrontMatter(file, fn)` | **non-`.md` file: silent no-op**, `fn` never runs | `t.extension === "md" &&` | 80942–80944 |
| | everything `Vault.process` rejects with (above) | wraps `vault.process(file, text => X4(text, fn))` | 80943 |
| | **YAML parse failure** | `YAMLParseError` from `parseYaml` (below) thrown inside the `process` callback; file untouched | 80978 |
| | **`fn` throws** | rethrown raw (runs inside `process`'s callback); file untouched | 80979 |
| | frontmatter that parses to a scalar or null | **no error**: silently replaced with `{}`, so `fn` sees an empty object and the original scalar is overwritten | 80979 |
| | stringify failure | `TypeError("Cannot stringify circular structure without alias nodes")` (and other `yaml` stringify errors) if `fn` leaves a cycle | 80981, 33470 |
| `renameFile(file, newPath)` | everything `Vault.rename` rejects with | after waiting for `metadataCache.onCleanCache` | 80435–80437, 80445 |
| | **nested call resolves early** | if another `renameFile` is mid-flight (`inProgressUpdates` set), this call is pushed and **returns `undefined` at once**; its rename runs later and its error rejects the *outer* call's `Promise.all` | 80440–80443, 80466 |
| | link-update errors | `metadataCache.updateInternalLinks`; the confirm modal rejects only on a DOM error building it; closing it resolves | 80474–80520 |
| | queue | `So.queue` is `then(t, t)` — a failed earlier rename does not block later ones | 62939–62947 |
| `trashFile(file)` | per `trashOption` config: `system` → `vault.trash(f, true)`; `local` → `vault.trash(f, false)`; `none` → `vault.delete(f, true)` (recursive, so no `ERR_FS_EISDIR`) | | 80655–80663 |
| `generateMarkdownLink(file, sourcePath, subpath, alias)` | **never throws** (pure string build) | | 80800–80813 |

## Plugin `loadData` / `saveData` (`FE`)

- `loadData()` → `vault.readPluginData(dir)` → `readJson` (126088–126096, 64872–64875, 64893–64901):
  - `data.json` missing (`ENOENT`) → resolves **`null`**.
  - **any other failure** (invalid JSON `SyntaxError`, `EACCES`, timeout) → `console.error("failed to read JSON", …)` and resolves **`undefined`**. It never rejects.
  - `getModifiedTime` swallows its own errors (126116–126123).
- `saveData(data)` → `vault.writePluginData` → `writeJson` (126097–126103, 64876–64879, 64902–64907): **`catch {}` swallows every write error**. It never rejects. (A `JSON.stringify` throw on a cyclic or `BigInt` value is also inside that `try`, so it is swallowed too.)
- So `PluginDataError` as written (`lib/plugin-data.ts`) is unreachable from Obsidian. The real failure signals: `load` resolving `undefined` (corrupt or unreadable file) vs `null` (no file yet); a failed save is invisible.

## `parseYaml` (`en` = `yaml` v2 `parse(src, null, {})`)

`H2` (37637–37646) parses one document and throws the **first** error (`r.errors[0]`); warnings only log.

| Kind | Class / `name` | `code` | Message shape | Line |
|---|---|---|---|---|
| Syntax / structure | `YAMLParseError` (`name === "YAMLParseError"`, extends private `I2 extends Error`), fields `code`, `pos: [start, end]`, `linePos` | one of `ALIAS_PROPS`, `BAD_ALIAS`, `BAD_COLLECTION_TYPE`, `BAD_DIRECTIVE`, `BAD_DQ_ESCAPE`, `BAD_INDENT`, `BAD_PROP_ORDER`, `BAD_SCALAR_START`, `BLOCK_AS_IMPLICIT_KEY`, `BLOCK_IN_FLOW`, `DUPLICATE_KEY`, `IMPOSSIBLE`, `MISSING_CHAR`, `MULTILINE_IMPLICIT_KEY`, `MULTIPLE_ANCHORS`, `MULTIPLE_DOCS`, `MULTIPLE_TAGS`, `NON_STRING_KEY`, `TAB_AS_INDENT`, `TAG_RESOLVE_FAILED`, `UNEXPECTED_TOKEN` | parser text + `" at line L, column C"` + a caret excerpt of the source | 34921–34935, 34936–34965, 37620–37630 |
| Alias at conversion | `ReferenceError` | none | `"Unresolved alias (the anchor must be set before the alias): x"`, `"Excessive alias count indicates a resource exhaustion attack"` (limit 100) | 32768–32790, 32739 |
| Merge key | `Error` | none | `"Merge sources must be maps or map aliases"` | 33636 |

Empty input resolves `null` (no throw). Messages are English from the `yaml` library and quote the source, so match on `name`/`code`, never on text.

## `requestUrl` (`Ya` → `CT`)

- **HTTP status** (all transports): `zR` (60626–60640) throws when `throw !== false` and `status >= 400`: a private `Error` subclass `pp` (60621–60625) with message **`"Request failed, status " + status`**, `.status: number`, `.headers: Record<string,string>`. `name` is `"Error"`; the response body is **not** on the error (no `text`/`json`/`arrayBuffer`). English, not localized.
- **Connection failure, desktop**: the renderer `bie` (41173–41185) sends `request-url` over IPC; the main process (main.js 6288–6318) replies `{error}` from Electron `net.request`'s `error` event or a thrown setup error, and the renderer rejects with `s.error`. That `Error` crossed IPC structured clone: `message` (Chromium text such as `net::ERR_NAME_NOT_RESOLVED`, `net::ERR_INTERNET_DISCONNECTED`, `net::ERR_CONNECTION_REFUSED` — not checked at runtime here) survives; any custom fields do not. No timeout of its own.
- **Connection failure, mobile**: Capacitor `ei.requestUrl` rejection, shape owned by the native plugin (60645–60654).
- **Fallback (no Electron, no Capacitor)**: browser `fetch`, `TypeError("Failed to fetch")` (60660).
- `Ya` returns a promise with `arrayBuffer`/`json`/`text` getters that are themselves promises (60667–60678). `.json` throws `SyntaxError` on a non-JSON body (60631).

## Surprises

1. `loadData` and `saveData` never reject: a corrupt `data.json` loads as `undefined`, and every save error is swallowed (64893–64907).
2. `renameFile` called while another `renameFile` is in flight resolves immediately, before its own rename happens; its error surfaces on the other call (80440–80443).
3. `processFrontMatter` on a file whose frontmatter is a scalar (e.g. `--- \nfoo\n---`) calls `fn` with `{}` and overwrites the scalar, no error (80979). On a non-`.md` file it silently does nothing.
4. `create` collisions follow the disk's case rule (bare `fs.access`), so on a case-insensitive filesystem a different-case name collides; `create`/`createFolder` resolve `null` (not a `TFile`) for an ignored path such as a dot folder, and `create` never makes parent folders (`ENOENT`), while `createFolder` does.
5. Three different "exists" messages: `"File already exists."`, `"Folder already exists."`, `"Destination file already exists!"`.
6. `trash(file, true)` falls back to the vault's `.trash` folder without a signal when the system trash fails (65077, main.js 6336–6342).
7. `delete(folder)` without `force` fails on every folder, empty or not (`ERR_FS_EISDIR`), on desktop; on mobile it always deletes recursively.
8. `modify` on a file deleted from disk recreates it rather than failing.
9. Any adapter call can reject with `"File system operation timed out."` after 60 s while the real operation keeps going.
