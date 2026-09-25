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
pnpm --filter @zotlit/obsidian build:dev
```

Editing the Fixture Spec or its committed vault-page assets changes the next
Fixture build, not the open Development Vault. Use the live `open` command
before you look for those changes. Use the live `remove` command when you tear
the vault down.

## Commands

| Command | What it does |
|---|---|
| `obsidian-cli.ts vault=<id> plugin:reload id=zotlit` | Reload the plugin after a build |
| `obsidian-cli.ts vault=<id> commands filter=zotlit` | List available plugin commands |
| `obsidian-cli.ts vault=<id> command id=zotlit:<cmd>` | Run a command |
| `obsidian-cli.ts vault=<id> eval code='<js>'` | Run JS in the app, returns the value |
| `obsidian-cli.ts vault=<id> dev:screenshot path=<abs>` | Capture the window (absolute path required) |
| `obsidian-cli.ts vault=<id> dev:errors` | Captured errors |
| `obsidian-cli.ts vault=<id> dev:console` | Console output |

Read the output text: `=> ` prefixes a result, and command failures come back as `Error: …` or
`Vault not found.`

## Loop

1. **Build** — `pnpm --filter @zotlit/obsidian build:dev` copies the bundle into
   this worktree's Development Vault.
2. **Reload** — `obsidian-cli.ts vault=<id> plugin:reload id=zotlit`.
3. **Open** — `obsidian-cli.ts vault=<id> command id=zotlit:<cmd>`, or `eval` to mount a view in a specific split.
4. **Probe** — `obsidian-cli.ts vault=<id> eval code='…'` with `getComputedStyle(el)` /
   `el.getBoundingClientRect()` to assert what actually rendered. A computed-style assertion is
   worth more than eyeballing a screenshot, and it is the only way to catch a state that expires
   on its own — a flash class is gone by the time the capture lands.
5. **Screenshot** — `obsidian-cli.ts vault=<id> dev:screenshot path=<absolute-path>`. Save inside the workspace.
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

`app.setting.open()` renders into a separate Electron window by default since 1.13.4, and `eval`,
`dev:dom`, and `dev:screenshot` all address the main one — so settings read as never opened. Run
`/obsidian-settings` → "Verifying on screen" for the config that brings the modal back into the
main window, and for reaching the separate window when its own chrome is the thing under test.

### Async work in CLI eval

CLI `eval` code runs in a non-async wrapper — top-level `await` is a syntax error. Return the
promise from an async IIFE; the CLI awaits it and prints the settled value. Hold the leaf from `getLeaf(...)`
and `revealLeaf(it)` in the same call rather than re-querying `getLeavesOfType(...)` after an
async `setViewState` (races, returns `[]`).

### Stale screenshots

A capture taken right after reload or `revealLeaf` may show old DOM while the change is already
live. Cross-check against an `eval` DOM/computed-style query — if they disagree, the DOM query
wins. Re-shoot. A DevTools window open over Obsidian can also steal the capture — close it first.

### Confirm which vault answered

A command without a leading `vault=` goes to the vault that holds the current folder, else to
the focused window — either may belong to another worktree. Pass
`vault=<id>` as the first argument, and confirm with `eval code='app.vault.adapter.basePath'` — it must print the
Development Vault path reported by `obsidian-vault.ts --help` for the worktree you build
from. `data.json` edits target that same path.

### Hidden window

A hidden, minimized, or covered window is throttled: `requestAnimationFrame` never fires, so an
eval that awaits one never answers; scroll events never dispatch; and screenshots lag one frame
behind the DOM. Turn throttling off for the vault's main window and its open popouts before you
probe:

```bash
packages/scripts/scripts/obsidian-cli.ts vault=<id> eval \
  code='(()=>{const r=require("@electron/remote"),m=r.getCurrentWebContents();for(const c of r.webContents.getAllWebContents())if(c===m||(c.opener?.top?.processId===m.mainFrame.processId&&c.opener?.top?.routingId===m.mainFrame.routingId))c.setBackgroundThrottling(false);return "off"})()'
```

Done when it prints `=> off`. Run it again after you open a popout, and once more with `true` in
place of `false` when you are done. The setting lasts until Obsidian restarts.
`document.visibilityState` can still read `hidden` — judge by frames and events.

### Full-scale Fixture data

Build a Stress Build with `pnpm fixture stress`. Read the current Device Override before you
change it:

```bash
packages/scripts/scripts/obsidian-cli.ts vault=<id> eval \
  code='app.plugins.plugins.zotlit.services.zoteroPref.dataDirOverride'
```

Point the live plugin at the absolute `.scratch/acceptance-fixture/zotero-data` path:

```bash
packages/scripts/scripts/obsidian-cli.ts vault=<id> eval \
  code='app.plugins.plugins.zotlit.services.zoteroPref.setDataDir("<absolute path>")'
```

Afterwards, call `setDataDir` again with the previous value, or `null` when it was empty. This
restores the vault-scoped Device Override and reconnects the database service.
