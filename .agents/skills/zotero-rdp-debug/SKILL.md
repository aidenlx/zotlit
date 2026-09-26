---
name: zotero-rdp-debug
description: |
  Ground truth from the running Zotero plugin over RDP. Use to inspect Zotero runtime state,
  to diagnose an observer or notifier that misfires, or to verify the plugin's outbound HTTP
  notifications. Also covers "debug the plugin" or "check it in Zotero."
---

# Debug the Zotero plugin over RDP

Source tells you what should happen; the running app tells you what does. Evaluate in
Zotero's parent process with `packages/scripts/scripts/zotero-rdp.ts` (written `zotero-rdp.ts`
below), run from the repo root.

1. **Contract** — run `zotero-rdp.ts --help`. Done when you know how it finds the port, how
   to write a sync and an async expression, and what its exit codes mean.
2. **Paired Run** — reuse a running one: the Fixture database admits one Zotero, so a second
   launch fails. Otherwise start one in the background — it keeps running after readiness
   (prerequisites: `docs/fixture.md`, "Run a Paired Run"):
   `pnpm fixture dev > .scratch/fixture-dev.log 2>&1 &`. Done when `zotero-rdp.ts 'Zotero.version'` prints a version — the
   Fixture's Zotero, which can differ from the source checkout.
3. **Probe** — evaluate until the runtime answers your question. Eval can also drive the app
   (open readers, select tabs, save items) and fires the same notifiers and observers as a
   user action does.
4. **Stop** — once the question is answered, stop a Paired Run you started. Send SIGINT to
   the whole process group of `pnpm fixture dev`, as `Ctrl-C` does:
   `kill -INT -- -<pgid>`. SIGINT to the inner `fixture.ts` process alone leaves the run and
   its Zotero up. Close a Paired Zotero that `pnpm fixture open` started with
   `pnpm fixture stop`. Leave a reused run up. Done when `zotero-rdp.ts 'Zotero.version'` reports
   no live Paired Run.

## Gotchas

- **`Zotero.Prefs.get` prepends `extensions.zotero.`** unless the second argument is `true`.
  `Zotero.Prefs.get("extensions.zotlit.notify")` returns `undefined`; use
  `Zotero.Prefs.get("extensions.zotlit.notify", true)`.
- **Notifier types are validated.** An unknown type string throws. When an observer never
  fires, confirm in the Zotero source that `Zotero.Notifier.trigger` runs for that event and
  type.

## Outbound HTTP

When the question is whether a notification leaves Zotero, follow
[capture-server.md](capture-server.md).
