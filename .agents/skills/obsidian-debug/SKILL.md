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

## Commands

| Command | What it does |
|---|---|
| `obsidian-cli plugin:reload id=zotlit` | Reload the plugin after a build |
| `obsidian-cli commands filter=zotlit` | List available plugin commands |
| `obsidian-cli command id=zotlit:<cmd>` | Run a command |
| `obsidian-cli eval code='<js>'` | Run JS in the app, returns the value |
| `obsidian-cli dev:screenshot path=<abs>` | Capture the window (absolute path required) |
| `obsidian-cli dev:errors` | Captured errors |
| `obsidian-cli dev:console` | Console output |

## Loop

1. **Build** — `pnpm --filter @zotlit/obsidian build:dev` (copies bundle into the test vault's
   `.obsidian/plugins/zotlit`).
2. **Reload** — `obsidian-cli plugin:reload id=zotlit`.
3. **Open** — `obsidian-cli command id=zotlit:<cmd>`, or `eval` to mount a view in a specific split.
4. **Probe** — `obsidian-cli eval code='…'` with `getComputedStyle(el)` /
   `el.getBoundingClientRect()` to assert what actually rendered. A computed-style assertion is
   worth more than eyeballing a screenshot.
5. **Screenshot** — `obsidian-cli dev:screenshot path=<absolute-path>`. Save inside the workspace.
6. **Errors** — `obsidian-cli dev:errors` / `obsidian-cli dev:console`.

## Gotchas

### No `await` in eval

Code runs in a non-async wrapper — top-level `await` is a syntax error. Fire the promise and
verify in a follow-up `eval`, or grab references synchronously. Hold the leaf from `getLeaf(...)`
and `revealLeaf(it)` in the same call rather than re-querying `getLeavesOfType(...)` after an
async `setViewState` (races, returns `[]`).

### Stale screenshots

A capture taken right after reload or `revealLeaf` may show old DOM while the change is already
live. Cross-check against an `eval` DOM/computed-style query — if they disagree, the DOM query
wins. Re-shoot. A DevTools window open over Obsidian can also steal the capture — close it first.

### Vault is the main checkout

The running app's vault is `~/repo/zotlit-repo/zotlit-v2/tests/zt-vault` even when working from
a worktree. `build:dev` from any worktree copies there, and `data.json` edits must target that
vault, not the worktree's own `tests/zt-vault`. Confirm with
`eval code='app.vault.adapter.basePath'`.

### Occluded window

When `document.visibilityState === "hidden"`, scroll events don't dispatch and the compositor
stops repainting — scroll-driven UI (e.g. TanStack Virtual) looks frozen and screenshots return
stale frames. Drive scrolling with `el.scrollTop = x; el.dispatchEvent(new Event("scroll"))` and
assert via DOM queries.

### Live-data escape hatch

Plugin setting `zotero.data-dir` points the live plugin at any data directory. Symlinking the
canonical 24k sqlite as `zotero.sqlite` in a scratch dir gives a full-scale live test. Restore
`data.json` + `plugin:reload` afterwards.
