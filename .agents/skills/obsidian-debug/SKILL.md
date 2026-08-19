---
name: obsidian-debug
description: |
  Drive the running Obsidian instance to verify plugin changes — build, reload, eval, screenshot.
  Use after editing plugin UI or behavior to confirm the change works in the real app, when
  debugging why something looks wrong at runtime, or when another skill says "verify in Obsidian."
  Also use when the user asks to test, check, run, or screenshot the plugin.
---

# Debug Loop

Drive the running Obsidian app through `obsidian-cli` to verify plugin changes against real
rendered state. The DOM is the source of truth.

## Vault setup, once per worktree

CLI Contract: `obsidian-vault 1`.

1. Run `packages/scripts/scripts/obsidian-vault.ts --help`.
2. Compare its `contractVersion` with the pin above. When they differ, follow
   the live help for this run.
3. Before you use a vault command, read its `<command> --help` output.
4. Build the plugin, then use the live `create` command to seed and register
   this worktree's dev vault:

```bash
pnpm --filter @zotlit/obsidian build:dev
```

Editing the Fixture Spec or its committed vault-page assets changes the next
Fixture build, not the open dev vault. Use the live `sync` command before you
look for those changes. Use the live `remove` command when you tear the vault
down.

## Commands

| Command | What it does |
|---|---|
| `obsidian-cli vault=<id> plugin:reload id=zotlit` | Reload the plugin after a build |
| `obsidian-cli vault=<id> commands filter=zotlit` | List available plugin commands |
| `obsidian-cli vault=<id> command id=zotlit:<cmd>` | Run a command |
| `obsidian-cli vault=<id> eval code='<js>'` | Run JS in the app, returns the value |
| `obsidian-cli vault=<id> dev:screenshot path=<abs>` | Capture the window (absolute path required) |
| `obsidian-cli vault=<id> dev:errors` | Captured errors |
| `obsidian-cli vault=<id> dev:console` | Console output |

The CLI always exits 0. Read the output text: `=> ` prefixes a result, and failures come back as
`Error: …` or `Vault not found.`

## Loop

1. **Build** — `pnpm --filter @zotlit/obsidian build:dev` copies the bundle into
   this worktree's dev vault.
2. **Reload** — `obsidian-cli vault=<id> plugin:reload id=zotlit`.
3. **Open** — `obsidian-cli command id=zotlit:<cmd>`, or `eval` to mount a view in a specific split.
4. **Probe** — `obsidian-cli eval code='…'` with `getComputedStyle(el)` /
   `el.getBoundingClientRect()` to assert what actually rendered. A computed-style assertion is
   worth more than eyeballing a screenshot, and it is the only way to catch a state that expires
   on its own — a flash class is gone by the time the capture lands.
5. **Screenshot** — `obsidian-cli dev:screenshot path=<absolute-path>`. Save inside the workspace.
6. **Errors** — `obsidian-cli dev:errors` / `obsidian-cli dev:console`.

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

### No `await` in eval

Code runs in a non-async wrapper — top-level `await` is a syntax error. Fire the promise and
verify in a follow-up `eval`, or grab references synchronously. Hold the leaf from `getLeaf(...)`
and `revealLeaf(it)` in the same call rather than re-querying `getLeavesOfType(...)` after an
async `setViewState` (races, returns `[]`).

### Stale screenshots

A capture taken right after reload or `revealLeaf` may show old DOM while the change is already
live. Cross-check against an `eval` DOM/computed-style query — if they disagree, the DOM query
wins. Re-shoot. A DevTools window open over Obsidian can also steal the capture — close it first.

### Confirm which vault answered

An untargeted command goes to the focused window, which may belong to another worktree. Pass
`vault=<id>`, and confirm with `eval code='app.vault.adapter.basePath'` — it must print the
dev-vault path reported by `obsidian-vault.ts --help` for the worktree you build
from. `data.json` edits target that same path.

### Occluded window

When `document.visibilityState === "hidden"`, scroll events don't dispatch and the compositor
stops repainting — scroll-driven UI (e.g. TanStack Virtual) looks frozen and screenshots return
stale frames. Drive scrolling with `el.scrollTop = x; el.dispatchEvent(new Event("scroll"))` and
assert via DOM queries.

### Live-data escape hatch

Plugin setting `zotero.data-dir` points the live plugin at any data directory. Symlinking the
canonical 24k sqlite as `zotero.sqlite` in a scratch dir gives a full-scale live test. Restore
`data.json` + `plugin:reload` afterwards.
