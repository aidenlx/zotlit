# Continuous annotation acceptance

Tested on 2026-09-20 in PR #1167, the #1157 integration build with the #1166
acceptance changes applied. The paired run used Zotero 10.0, Build ID
`20260817111755`.

The final real paired run passed all 28 tests. It covered Local API reads and write
authorization, native concurrent PATCH and DELETE behavior, create and edit in
the PDF marks and annotation cards, a pop-out card's native shortcut scope,
external Zotero changes, refresh without the Companion, an acknowledged write
whose response and reread were lost, pane closure during a write, Local API
loss and recovery, and the final PDF byte hash. The log is
`.scratch/spec-1157/1166-paired-final.log`.

The paired cleanup restores the exact original `localAPIKeys.json` bytes and
Obsidian SecretStorage value. Zotero caches cleared keys for the life of its
process, so the suite restarts only Fixture Zotero and verifies that the fresh
process loaded the restored remembered-key count without exposing key data.
It leaves that restored Fixture process running; the acceptance orchestration
stops it before standalone tests and during final cleanup. The test removes
its annotations, closes its pop-out, restores the workspace, and leaves the
PDF byte-identical.

The full Zotero-closed standalone run executed 18 tests: 13 passed and 5 Local
Bridge tests skipped because Web Workbench was disabled. It confirmed the
`zotero-db` source and exact eight Fixture annotation keys, all eight cards,
page-aware marks across both PDF pages, first-note customization, Profile
matching and deletion, mixed-Library batch behavior, Live Update settings,
Follow Mode, Scope Cases, and the fresh destination flow. The final command
was `pnpm --filter @zotlit/e2e exec vitest run src/end-to-end.e2e.ts`.

The failing standalone assertions used stale Fixture counts and queried only
the main renderer document after Obsidian moved settings, prompts, notices,
and the Template Workbench into pop-out documents. The corrected tests use
the current Fixture data and the active or owning document. Each Obsidian CLI
call now has a 15-second process timeout, so a lost reply cannot consume an
entire test timeout.

Obsidian 1.14.2 could also throw `Cannot read properties of undefined
(reading 'origin')` while a temporary vault window closed. Its main-process
handler reads `details.frame.origin` during an `app://` request even when
`details.frame` is absent during window destruction. Test cleanup now disables
ZotLit, waits for two renderer frames, and closes the root workspace window.
The final standalone run produced no uncaught main-process exception.

Zotero 10.0 still accepts a stale native PATCH and DELETE after a concurrent
Reader change. The paired evidence records the PATCH overwriting the Reader
comment and DELETE returning 204 before the item reads as 404. On 2026-09-20,
the maintainer accepted these known Zotero defects as release risks in
[#1157](https://github.com/aidenlx/zotlit/issues/1157). This supersedes the
earlier native concurrency release gate; the defects remain unresolved and
their natural occurrence rate is unmeasured. The
[PDF editing guide](../../apps/docs/content/docs/how-to/edit-pdf-annotations.mdx)
explains the risk and recommends editing in one application at a time, with
changes saved before switching. Upstream repair remains separate follow-up
work.

The final repository test run passed all 28 tasks, including 4,474 Obsidian
tests. Test TypeScript, repository lint, and repository format checks passed.

## Pending-work reload follow-up

The final review added two paired cases that unload and enable the real
plugin while a comment has unsent save timers, and while a committed color
write still waits for its response. The cases observe repository disposal
through the plugin lifecycle. They then require a fresh repository read of
Zotero's saved values, an empty draft, and idle mutation state. They release
the old response after the new read and check the saved version and comment
again to detect replay.

On 2026-09-20, the final Paired Run passed all 28 tests in 22.54 seconds on
Obsidian 1.14.2 and Zotero 10.0. Both pending-work reload cases passed. The
e2e TypeScript check, focused Oxlint, and formatting also passed. Obsidian's
main-process log contained no `frame.origin` exception, and its captured
renderer errors contained only `ResizeObserver` delivery warnings.
