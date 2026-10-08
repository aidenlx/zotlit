---
name: obsidian-debug
description: |
  Drive the running Obsidian instance to verify plugin changes — build, reload, eval, screenshot.
  Use after editing plugin UI or behavior to confirm the change works in the real app, when
  debugging why something looks wrong at runtime, or when another skill says "verify in Obsidian."
  Also use when the user asks to test, check, run, or screenshot the plugin, or to inspect
  Obsidian with DevTools (CDP) — windows or the main process.
---

# Debug Loop

Drive the running Obsidian app to verify plugin changes against real rendered state. The DOM
is the source of truth.

Make every CLI call through `packages/scripts/scripts/obsidian-cli.ts` (written
`obsidian-cli.ts` below), run from the repo root. It takes the `obsidian` binary's arguments
and prints its output, and it always sees the end of a reply — the binary can miss it on macOS
and wait until killed.

**DevTools** — when the CLI cannot show it (DOM and CSS internals, network, profiles,
breakpoints, popout or settings windows, the main process), follow [devtools.md](devtools.md).

## Vault setup, once per worktree

1. Run `packages/scripts/scripts/obsidian-cli.ts version`. It must print Obsidian's version.
   Read `obsidian-cli.ts --help` for its arguments, timeout, and exit codes.
2. Run `packages/scripts/scripts/obsidian-vault.ts --help`.
3. Before you use a vault command, read its `<command> --help` output.
4. Run `packages/scripts/scripts/obsidian-vault.ts check`. Vault setup is
   complete when the command succeeds. Follow its recovery instructions when
   it fails.
5. Build the plugin, then use the live `open` command to prepare this
   worktree's Development Vault:

```bash
pnpm exec turbo run build --filter='@zotlit/obsidian^...'
pnpm --filter @zotlit/obsidian build:dev
```

The first command rebuilds the workspace packages the plugin bundles from
their `dist`, such as `@zotlit/workbench`. The second builds the plugin and
copies it into the vault.

Editing the Fixture Spec or its committed vault-page assets changes the next
Fixture build, not the open Development Vault. Use the live `open` command
before you look for those changes.

## Teardown

When the check is done, close what the check opened, in this order:

1. `pnpm fixture stop` — closes a Paired Zotero that `pnpm fixture open` left running.
2. `packages/scripts/scripts/obsidian-vault.ts remove --purge` — removes the Development Vault.

## Commands

| Command | What it does |
|---|---|
| `obsidian-cli.ts vault=<id> plugin:reload id=zotlit` | Reload the plugin after a build |
| `obsidian-cli.ts vault=<id> commands filter=zotlit` | List available plugin commands |
| `obsidian-cli.ts vault=<id> command id=zotlit:<cmd>` | Run a command |
| `obsidian-cli.ts --code '<js>' vault=<id>` | Run JS in the app, returns the value |
| `obsidian-cli.ts --js <file.js> vault=<id>` | Run a JS file in the app; use it for multi-line probes |
| `obsidian-cli.ts --shot <file> --selector <css> vault=<id>` | Capture one element; `--sample x,y` reads a pixel's colour |
| `obsidian-cli.ts vault=<id> dev:screenshot path=<abs>` | Capture the window (absolute path required) |
| `obsidian-cli.ts vault=<id> dev:errors` | Captured errors |
| `obsidian-cli.ts vault=<id> dev:console` | Console output |

Read the output text: `=> ` prefixes a result, and command failures come back as `Error: …` or
`Vault not found.`

Write each call as one plain command with literal values: `<id>` is the vault ID
`obsidian-vault.ts status` prints, typed out, and JS goes through `--code` or `--js`.

## Loop

1. **Build** — the two build commands from Vault setup step 5. The second copies the
   bundle into this worktree's Development Vault; prefix it with `ZT_VAULT_CASE=<case>`
   to copy into a Vault Case vault, such as the `upgrader` vault.
2. **Reload** — `obsidian-cli.ts vault=<id> plugin:reload id=zotlit`.
3. **Open** — `obsidian-cli.ts vault=<id> command id=zotlit:<cmd>`, or `--code` to mount a view in a specific split.
4. **Probe** — `obsidian-cli.ts --code '…' vault=<id>` with `getComputedStyle(el)` /
   `el.getBoundingClientRect()` to assert what actually rendered. A computed-style assertion is
   worth more than eyeballing a screenshot, and it is the only way to catch a state that expires
   on its own — a flash class is gone by the time the capture lands.
5. **Screenshot** — `obsidian-cli.ts --shot <file> --selector <css> vault=<id>` for the surface under test;
   `dev:screenshot` when the whole window matters. Save inside the workspace. A colour question —
   a fade, a blend, a border — is answered by `--sample`, not by eye. `obsidian-cli.ts --help` has the
   options.
6. **Errors** — `obsidian-cli.ts vault=<id> dev:errors` / `dev:console`.

## Driving state

Values change through code, and DOM ops check how the UI looks and behaves.

| Target | Expression |
|---|---|
| Obsidian app config | `app.vault.setConfig(key, value)` |
| ZotLit setting | `app.plugins.plugins.zotlit.settingTab.setControlValue("citation.at-trigger", false)` |

`setControlValue` runs the same `SettingsService` path the rendered control does and persists to
the plugin's `data.json`; `getControlValue` reads the effective value back. Read the value first
and put it back when you are done.

## Gotchas

### Settings land in their own window

`app.setting.open()` renders into a separate Electron window by default since 1.13.4, and `--code`,
`dev:dom`, and `dev:screenshot` all address the main one — so settings read as never opened. Run
`/obsidian-settings` → "Verifying on screen" for the config that brings the modal back into the
main window, and for reaching the separate window when its own chrome is the thing under test.

### Async work in `--code`

Code run through `--code` or `--js` runs in a non-async wrapper — top-level `await` is a syntax error. Return the
promise from an async IIFE; the CLI awaits it and prints the settled value. Hold the leaf from `getLeaf(...)`
and `revealLeaf(it)` in the same call rather than re-querying `getLeavesOfType(...)` after an
async `setViewState` (races, returns `[]`).

### CodeMirror editors

Reach an editor's `EditorView` from its content element: `el.querySelector('.cm-content').cmTile.root.view`.
Drive it with `view.dispatch({changes, userEvent: 'input.type'})` and read `view.state.doc.toString()`.
A pane mounts its editor after the click that opens it, and a row that holds fixed text has no editor —
poll until the editor exists before you drive it, as `annotationEditor` in
`packages/e2e/src/end-to-end.e2e.ts` does.

### Stale screenshots

A capture taken right after reload or `revealLeaf` may show old DOM while the change is already
live. Cross-check against a `--code` DOM/computed-style query — if they disagree, the DOM query
wins. Re-shoot. A DevTools window open over Obsidian can also steal the capture — close it first.

### Confirm which vault answered

A command without a leading `vault=` goes to the vault that holds the current folder, else to
the focused window — either may belong to another worktree. Pass
`vault=<id>` as the first argument, and confirm with `--code 'app.vault.adapter.basePath'` — it must print the
Development Vault path reported by `obsidian-vault.ts --help` for the worktree you build
from. `data.json` edits target that same path.

### Hidden window

A hidden, minimized, or covered window is throttled: `requestAnimationFrame` never fires, so a
probe that awaits one never answers; scroll events never dispatch; and screenshots lag one frame
behind the DOM. Pass `--no-throttle` to every call that probes, scrolls, or captures: it lifts
throttling from the main window and its popouts for that call and puts it back after.
`document.visibilityState` can still read `hidden` — judge by frames and events.

### Full-scale Fixture data

Build a Stress Build with `pnpm fixture stress`. Read the current Device Override before you
change it:

```bash
packages/scripts/scripts/obsidian-cli.ts \
  --code 'app.plugins.plugins.zotlit.services.zoteroPref.dataDirOverride' vault=<id>
```

Point the live plugin at the absolute `.scratch/acceptance-fixture/zotero-data` path:

```bash
packages/scripts/scripts/obsidian-cli.ts \
  --code 'app.plugins.plugins.zotlit.services.zoteroPref.setDataDir("<absolute path>")' vault=<id>
```

Afterwards, call `setDataDir` again with the previous value, or `null` when it was empty. This
restores the vault-scoped Device Override and reconnects the database service.
