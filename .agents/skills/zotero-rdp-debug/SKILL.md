---
name: zotero-rdp-debug
description: |
  Ground truth from the running Zotero plugin over RDP. Use when inspecting
  runtime state in Zotero, diagnosing why an observer or notifier misfires,
  or verifying the plugin's outbound HTTP notifications. Also covers "debug
  the plugin" or "check it in Zotero."
---

# Debug the Zotero plugin over RDP

Source tells you what should happen. Ground truth from the running app tells you what does
happen. `apps/zotero/scripts/debug/rdp-eval.ts` evaluates JavaScript in Zotero's parent
(chrome) process over the Firefox Remote Debugging Protocol — the same scope where `Zotero`,
`Services`, and the plugin run.

## 1. Start or reuse a Paired Run

Launch Zotero on the Fixture profile via `pnpm fixture dev` — see the Fixture guide
(`docs/fixture.md`, "Run a Paired Run") for prerequisites and options. The session enables
RDP and hot-reloads the companion on source changes.

If a session is already running, reuse its log and port — a second launch fails because the
Fixture database cannot be opened by two Zotero processes.

```bash
pnpm fixture dev > tmp/fixture-dev.log 2>&1 &
until rg -q "RDP connected on port" tmp/fixture-dev.log; do sleep 2; done
PORT=$(rg -o 'RDP connected on port (\d+)' -r '$1' tmp/fixture-dev.log | tail -1)
```

## 2. Evaluate JavaScript

```bash
node apps/zotero/scripts/debug/rdp-eval.ts "$PORT" '<expression>'
```

Return JSON-serializable values; non-serializable objects (DOM nodes, class instances) come
back as grip previews — reduce to plain data inside the expression.

**Sync:**

```bash
node apps/zotero/scripts/debug/rdp-eval.ts "$PORT" \
  'JSON.stringify({ version: Zotero.version, readers: Zotero.Reader._readers.length })'
```

**Async** — prefix with `await `. The harness wraps the expression in an async function:

```bash
node apps/zotero/scripts/debug/rdp-eval.ts "$PORT" \
  'await Zotero.Items.getAll(1)'
```

For multi-step async, wrap in an IIFE: `'await (async () => { ...; return result; })()'`.

Eval can also drive the app — open readers, select tabs, save items — firing the same
notifiers and observers as real user actions.

Exceptions are reported on stderr with the stack.

## Gotchas

- **Parent-process scope.** `Zotero` and `Services` are global. Reach reader iframe contents
  through `Zotero.Reader` and `_iframeWindow`.
- **`Zotero.Prefs.get` prepends `extensions.zotero.`** unless the second arg is `true`.
  `Zotero.Prefs.get("extensions.zotlit.notify")` silently returns `undefined`; use
  `Zotero.Prefs.get("extensions.zotlit.notify", true)`.
- **Notifier types are validated.** Unknown type strings throw. If an observer never fires,
  confirm `Zotero.Notifier.trigger` is called for that event/type in the Zotero source.
- **Check the installed version.** `rdp-eval.ts "$PORT" 'Zotero.version'` — the Fixture's
  Zotero may differ from the source checkout.

## Outbound HTTP verification

When debugging whether outbound notifications leave Zotero, see
[capture-server.md](capture-server.md).
