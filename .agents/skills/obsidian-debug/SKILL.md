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

Each worktree debugs against its own vault at `tests/zt-vault-<worktree>`, seeded from the tracked
`tests/zt-vault` template and gitignored. `build:dev` copies the bundle into the vault of the
worktree you build from. Build once, then register:

```bash
pnpm --filter @zotlit/obsidian build:dev
packages/scripts/scripts/obsidian-vault.ts create
```

`create` needs the bundle already in the vault, seeds the fixture notes around
it, turns Restricted Mode off, and confirms the plugin actually loaded. It
prints the 16-hex vault id. Obsidian names a vault after its folder, so the distinct folder
name also makes `vault=zt-vault-<worktree>` resolve unambiguously — `vault=<name>` picks the first
basename match, which is why every worktree needs its own name. Tear down with
`packages/scripts/scripts/obsidian-vault.ts remove --purge`; `wt`'s `pre-remove`
hook already runs that when the worktree goes.

Editing a fixture under `tests/zt-vault/` changes the template, not the vault the app has
open. Copy the edit across before you go looking for it in Obsidian:

```bash
packages/scripts/scripts/obsidian-vault.ts sync
```

`sync` overwrites changed files in place, so the vault keeps its id and its built bundle. It
errors when the vault does not exist yet — run `create` first. `--purge` deletes the folder
before copying, so fixtures renamed or removed from the template drop out too; that clears
the bundle as well, so rebuild after it.

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

1. **Build** — `pnpm --filter @zotlit/obsidian build:dev` (copies the bundle into this worktree's
   `tests/zt-vault-<worktree>/.obsidian/plugins/zotlit`).
2. **Reload** — `obsidian-cli vault=<id> plugin:reload id=zotlit`.
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

### Confirm which vault answered

An untargeted command goes to the focused window, which may belong to another worktree. Pass
`vault=<id>`, and confirm with `eval code='app.vault.adapter.basePath'` — it must print the
`tests/zt-vault-<worktree>` of the worktree you build from. `data.json` edits target that same
path, not the `tests/zt-vault` template.

### Occluded window

When `document.visibilityState === "hidden"`, scroll events don't dispatch and the compositor
stops repainting — scroll-driven UI (e.g. TanStack Virtual) looks frozen and screenshots return
stale frames. Drive scrolling with `el.scrollTop = x; el.dispatchEvent(new Event("scroll"))` and
assert via DOM queries.

### Live-data escape hatch

Plugin setting `zotero.data-dir` points the live plugin at any data directory. Symlinking the
canonical 24k sqlite as `zotero.sqlite` in a scratch dir gives a full-scale live test. Restore
`data.json` + `plugin:reload` afterwards.
