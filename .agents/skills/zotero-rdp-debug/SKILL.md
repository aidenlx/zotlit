---
name: zotero-rdp-debug
description: |
  Debug the running ZotLit Zotero plugin (`apps/zotero`) live by evaluating JavaScript in
  Zotero's parent (chrome) process over the Firefox Remote Debugging Protocol that the dev
  server already exposes. Reach for this whenever you need to inspect real runtime state in
  Zotero — why a notifier/observer isn't firing, what `Zotero.Reader`/`Zotero_Tabs`/`Zotero.Items`
  actually return, whether a pref reads the value you expect, or whether the plugin is
  dispatching the HTTP notifications it should. Use it for any "why isn't this working in
  Zotero at runtime", "what does this Zotero API return live", or "is the plugin actually
  sending/observing X" question, even when the user just says "debug the plugin" or "check it
  in Zotero" without mentioning RDP. Far more reliable than reasoning from source alone, because
  it reads ground truth from the live app.
---

# Debug the ZotLit Zotero plugin live over RDP

Static reading of `apps/zotero/src` and the Zotero source tells you what *should* happen.
When behaviour disagrees with the code, you need ground truth from the running app. The dev
server launches Zotero with the Firefox Remote Debugging Protocol (RDP) enabled, so you can
open a second connection and evaluate arbitrary JavaScript in Zotero's parent process — the
same scope where `Zotero`, `Services`, and the plugin run. That turns "I think the observer
fires" into "I watched it fire (or not)".

The whole loop is: **launch → eval to inspect/reproduce → confirm outward effects → tear
down**. Two small scripts (kept with the app, in `apps/zotero/scripts/debug/`) do the heavy
lifting:

- `rdp-eval.ts` — evaluate an expression in the parent process and print the result as JSON.
- `capture-server.ts` — a stand-in HTTP listener that logs what the plugin POSTs, so you can
  prove outbound notifications actually leave Zotero.

Run everything from the repo root.

## 1. Launch the dev server and capture the RDP port

The dev server picks a **random** free RDP port on every launch and logs it, so always read
the port back from the log rather than assuming one. Redirect output to a file you can grep:

```bash
pnpm --filter @zotlit/zotero dev > apps/zotero/.zotero-dev/devlog.txt 2>&1 &
# Wait for Zotero to boot, install the addon, and announce the port:
until rg -q "RDP connected on port" apps/zotero/.zotero-dev/devlog.txt; do sleep 2; done
PORT=$(rg -o 'RDP connected on port (\d+)' -r '$1' apps/zotero/.zotero-dev/devlog.txt | tail -1)
echo "RDP port: $PORT"
```

The dev server installs the plugin as a **temporary addon and hot-reloads it** whenever you
edit `apps/zotero/src` — so the edit-test loop is: change source, wait for `Reloaded` in the
log, re-run your eval. No manual reinstall.

The dev profile and library live under `apps/zotero/.zotero-dev/` (gitignored, and persisted
across runs). Treat it as a scratch library: it's safe to create items, open readers, and
mutate data there to reproduce a bug.

If the dev server is already running from a previous step, reuse its log and port instead of
launching a second instance.

## 2. Evaluate JavaScript to inspect and reproduce

```bash
node apps/zotero/scripts/debug/rdp-eval.ts "$PORT" "<expression>"
```

The expression runs in the parent-process console scope. `Zotero`, `Services`, `Components`,
etc. are all in scope. Return a **JSON-serializable** value to read it back; objects that
can't be serialized (DOM nodes, class instances, Promises) come back as a debugger "grip"
preview, not their contents — so reduce to plain data inside the expression.

**Synchronous inspection** — wrap multi-step logic so it returns one value:

```bash
node apps/zotero/scripts/debug/rdp-eval.ts "$PORT" \
  'JSON.stringify({ version: Zotero.version, selectedID: Zotero.getMainWindows()[0]?.Zotero_Tabs?.selectedID, readers: Zotero.Reader._readers.length })'
```

**Async** — prefix the expression with `await `. Many Zotero APIs are async (`Zotero.Items.getAll`,
`item.saveTx()`, `Zotero.Reader.open`). The webconsole actor here does **not** transform a
top-level `await`, so the harness handles it for you: when the expression starts with `await `,
it runs the body inside an async function, stashes the resolved result on a global, and polls
that global. Just write natural async code:

```bash
node apps/zotero/scripts/debug/rdp-eval.ts "$PORT" \
  'await (async () => { const r = await Zotero.Reader.open(1); await new Promise(s=>setTimeout(s,1500)); const w = Zotero.getMainWindows()[0]; return { opened: !!r, selectedID: w.Zotero_Tabs.selectedID, itemID: Zotero.Reader.getByTabID(w.Zotero_Tabs.selectedID)?.itemID }; })()'
```

You can also use eval to **drive the app** and reproduce a scenario — open a reader, select a
tab, modify or save an item — and then observe the result (the next section) or query state
again. Driving the UI this way fires the same notifiers and observers as real user actions, so
it exercises the plugin's real code paths.

Exceptions are reported on stderr with the stack, so a thrown error inside the expression
won't be silently swallowed.

## 3. Confirm outward effects (HTTP notifications)

When the plugin's job is to *send* something (the notify feature POSTs events to Obsidian),
inspecting internal state isn't enough — prove the bytes leave Zotero. Run the capture server
on the port the plugin targets (`extensions.zotlit.notify-url`, default `9091`):

```bash
node apps/zotero/scripts/debug/capture-server.ts 9091 > apps/zotero/.zotero-dev/capture.log 2>&1 &
until rg -q "listening" apps/zotero/.zotero-dev/capture.log; do sleep 1; done
```

Then trigger the behaviour (via eval, per section 2) and read `capture.log`. Each received
`POST /notify` body is logged with a timestamp, so a line appearing there is end-to-end proof
the plugin dispatched; an empty log after you triggered the action means it didn't (look at
the gating: prefs, enablement flags, the observer registration).

This pattern generalizes: any time the plugin is supposed to make an outbound call, a tiny
logging listener on the far end is the cleanest confirmation.

## 4. Tear down

Stop the capture server and the dev server (which owns the Zotero process). Targeting the
debugger-server port reliably kills the right Zotero instance even when several are around:

```bash
pkill -f "scripts/debug/capture-server.ts"
pkill -f "start-debugger-server=$PORT"      # the Zotero instance for this session
pkill -f "vite.serve.config.ts"             # the dev server's vite watcher
pkill -f "filter @zotlit/zotero dev"        # the pnpm wrapper
```

Leaving the dev server running is fine if you'll keep iterating — just reuse the port. Clean
up the scratch `devlog.txt` / `capture.log` when you're done; the rest of `.zotero-dev/` is
gitignored and meant to persist.

## Why a second RDP client instead of the dev server's

The dev server already speaks RDP (via `apps/zotero/scripts/dev-server/rdp-client.ts`), but it
uses it only to install and reload the addon, and it treats any `evaluationResult` packet as a
fatal error. Console eval relies on exactly those packets: `evaluateJSAsync` replies with a
`resultID`, then the real value arrives later in a separate `evaluationResult` from the same
actor. So `rdp-eval.ts` ships its own minimal client tuned for eval (connect → `getProcess
{id:0}` → `getTarget` on the process descriptor → `consoleActor` → `evaluateJSAsync`, matching
the reply by `resultID`). RDP allows multiple simultaneous client connections, so your eval
client coexists with the dev server's reload client on the same port.

## Gotchas worth knowing

- **The port changes every launch.** Always read it from the log; never hardcode.
- **Parent-process scope, not a tab.** You're in the chrome/browser process, so `Zotero` and
  `Services` are global. To reach a reader's iframe contents, go through `Zotero.Reader` and
  its `_iframeWindow`, not a separate target.
- **`Zotero.Prefs.get(key)` prepends `extensions.zotero.`** unless you pass `true` as the
  second arg. Reading a fully-qualified `extensions.zotlit.*` key without it returns
  `undefined` — a real source of "the pref is set but the plugin sees nothing" bugs. Compare
  `Zotero.Prefs.get("extensions.zotlit.notify")` (wrong branch) vs
  `Zotero.Prefs.get("extensions.zotlit.notify", true)` when a pref looks empty.
- **Notifier types are validated.** `Zotero.Notifier.registerObserver(ref, types, id)` throws
  on an unknown type string; the observer callback is `(event, type, ids, extraData)`. If an
  observer never fires, confirm the trigger source actually calls `Zotero.Notifier.trigger`
  for that `event`/`type` in the Zotero source.
- **Verify APIs against the installed version.** The dev Zotero may be a different patch
  release than the source checkout. `rdp-eval.ts "$PORT" 'Zotero.version'` tells you which one
  you're actually testing.

## Related

- `reference_zotero_reader_internals` memory — what to inspect for reader/annotation work.
- `feedback_zotero_prefer_official_api` memory — prefer notifier/event APIs over patching.
- `apps/zotero/AGENTS.md` — plugin conventions (prefs wrapper, logging, l10n).
