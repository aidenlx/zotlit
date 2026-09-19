# Continuous annotation acceptance

Tested on 2026-09-20 at `cbc144ea`, the #1157 integration build with the
#1166 acceptance changes applied. The paired run used Zotero 10.0, Build ID
`20260817111755`.

The real paired run passed all 26 tests. It covered Local API reads and write
authorization, native concurrent PATCH and DELETE behavior, create and edit in
the PDF marks and annotation cards, a pop-out card's native shortcut scope,
external Zotero changes, refresh without the Companion, an acknowledged write
whose response and reread were lost, pane closure during a write, Local API
loss and recovery, and the final PDF byte hash. The log is
`tmp/spec-1157/1166-paired-final.log`.

The paired cleanup restores the exact original `localAPIKeys.json` bytes and
Obsidian SecretStorage value. Zotero caches cleared keys for the life of its
process, so the suite restarts only Fixture Zotero and verifies that the fresh
process loaded the restored remembered-key count without exposing key data.
It leaves that restored Fixture process running; the acceptance orchestration
stops it before standalone tests and during final cleanup. The test removes
its annotations, closes its pop-out, restores the workspace, and leaves the
PDF byte-identical.

The full Zotero-closed standalone run executed 18 tests: 5 passed, 8 failed,
and 5 Local Bridge tests skipped. Its log is
`tmp/spec-1157/1166-standalone-final.log`. A clean focused rerun passed after
the PDF reader service began announcing sessions created after the Annotation
View's active-leaf event. It confirmed the `zotero-db` source and exact eight
Fixture annotation keys, all eight cards, and page-aware marks across both PDF
pages. Its log is `tmp/spec-1157/1166-standalone-annotation.log`. The full run
also exposed note-count, Profile-editor, and Live Update failures that are not
yet attributed. These failures remain visible and were not hidden by changing
unrelated note workflows.

Zotero 10.0 still accepts a stale native PATCH and DELETE after a concurrent
Reader change. The paired evidence records the PATCH overwriting the Reader
comment and DELETE returning 204 before the item reads as 404. This upstream
native concurrency race remains the release blocker.

The final repository test run passed all 28 tasks, including 4,474 Obsidian
tests. Test TypeScript, repository lint, and repository format checks passed.
