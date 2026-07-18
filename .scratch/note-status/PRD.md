# Note Status Column

Status: ready-for-human

Implemented on `feat/note-status` (single feature commit spanning protocol + obsidian + zotero). Remaining human step: live verification against a running Zotero via the RDP debug loop (column renders, marker appears after note creation + focus, manual refresh reports success count / failure).

Upstream inspiration: v1 community PR aidenlx/zotlit#464 ("feat: add custom column showing Obsidian note status in Zotero"). This spec re-designs that feature for the v2 architecture; it is not a port of its code.

## Problem Statement

While triaging or reading in Zotero, users cannot tell which items they have already processed into literature notes in their Obsidian vault. They must switch to Obsidian and search per item, or maintain the mapping in their head. This makes it hard to answer the everyday question "which of these items still need a note?" without leaving Zotero.

## Solution

The ZotLit companion adds an "Obsidian Note" column to Zotero's item list. A marker in the column means the item has at least one Literature Note in the connected vault; a blank cell means it has none (or the status is unknown, e.g. Obsidian is not running). The companion pulls the set of noted items from the Obsidian plugin over the existing ephemeral HTTP channel — once at startup, again whenever the Zotero window regains focus, and on demand via a manual refresh action — so the column stays current with the user's actual workflow of bouncing between the two apps.

## User Stories

1. As a Zotero user with ZotLit, I want a column in the item list marking items that have a Literature Note, so that I can see at a glance which items I have already processed.
2. As a Zotero user, I want to sort by the note-status column, so that I can group all un-noted items together and work through them as a to-do list.
3. As a Zotero user, I want the column to appear in Zotero's native column picker, so that I can show or hide it like any built-in column without touching plugin settings.
4. As a Zotero user, I want the column label to say what the marker means ("Obsidian Note"), so that I understand it when scanning the column picker among Zotero's own field names.
5. As a user who just created a literature note from Zotero, I want the marker to appear when I switch back to the Zotero window, so that the column reflects what I just did without restarting anything.
6. As a Zotero user, I want a manual "Refresh note status" action in the Tools menu, so that I can force a re-fetch when I suspect the column is stale.
7. As a user who triggered a manual refresh, I want a brief notice reporting the outcome — the noted-item count on success, an error while Obsidian is closed — so that I know whether the refresh happened and can use the action as a connectivity probe.
8. As a user working with Obsidian closed, I want background refresh attempts to fail silently, so that a cosmetic column never nags me with connection errors.
9. As a user working with Obsidian closed, I want previously fetched markers to stay visible, so that recent status is not blanked out just because the vault is offline right now.
10. As a user who restarts Zotero before Obsidian is running, I want the column blank rather than showing stale claims, so that every rendered marker is one the running vault actually confirmed this session.
11. As a user with both a personal library and group libraries, I want status resolved per library, so that a personal item and a group item sharing the same 8-char key never inherit each other's status.
12. As a user with multiple literature notes for one item, I want a single marker, so that the column stays a clean binary indicator.
13. As a user who has imported Zotero child notes (Imported Notes) but written no literature note for an item, I want that item unmarked, so that the marker answers "did I process this item" and nothing else.
14. As a user with a large vault, I want the Obsidian side to answer from its live Note Index, so that a status fetch never triggers a vault-wide file scan.
15. As a user with a large Zotero library, I want per-row rendering to be a constant-time lookup, so that the column never slows down item-list scrolling.
16. As a user who rapidly alt-tabs between apps, I want focus-triggered refreshes throttled, so that window switching does not spam the vault's HTTP server.
17. As a user of the wider ZotLit protocol, I want the status endpoint gated by the same protocol version and source-id checks as every other ephemeral request, so that mismatched plugin versions or the wrong vault fail loudly instead of showing wrong data.
18. As a user who disables or reloads the companion, I want the column and menu entry cleanly unregistered, so that no dead UI or listeners linger.
19. As a non-English user, I want the column label and Tools-menu entry localized through the companion's existing Fluent setup, so that the feature matches the rest of the UI.
20. As a user who has not enabled the Obsidian-side HTTP server, I want the column to simply stay blank, so that the feature degrades to a no-op rather than an error state.

## Implementation Decisions

- **Status model is binary existence of a Literature Note.** Imported Notes do not count. No staleness, no note counts.
- **Data flow is pull-only, preserving the protocol direction**: the Obsidian plugin serves, the Zotero companion fetches. No Obsidian→Zotero push (no use of Zotero's own local HTTP server).
- **New Protocol Action: `GET /literature-notes`** on the version-gated Ephemeral HTTP Request channel — the protocol's first query-style action (all prior actions are commands/pushes). Symmetric with the existing `PUT /literature-notes` batch update. Gated by `X-Zotlit-Protocol-Version` and the source-id header like its siblings. `PROTOCOL_VERSION` is bumped (4 → 5) per the protocol package's ephemeral-transport policy: any HTTP schema change bumps, so a version mismatch on the new query fails with the explicit "update required" notice rather than a misleading 404.
- **Response shape** is minimal: an object with a `keys` array — the set of Indexed Keys that have at least one Literature Note. Absence of a key means "no note". No mtimes, paths, or counts.
- **Indexed Key becomes wire vocabulary.** The response schema (valibot, defined in the protocol package) validates the indexed-key pattern: 8-char base-32 item key, optionally suffixed `g<groupID>` for group-library items. The Obsidian side already speaks this key space (frontmatter / Note Index); the Zotero side formats it per row from the item key plus the library's group id with a one-line expression — no new package dependency.
- **Obsidian side**: the handler answers straight from the live Note Index's by-item-key map, awaiting the index's first-scan readiness before responding. No vault scanning, no DB access.
- **Zotero side**: first use of `Zotero.ItemTreeManager.registerColumn()`. Registered unconditionally at startup, unregistered at shutdown. Visibility is the user's choice via Zotero's native column picker — no enable/disable preference.
- **Column header is the Obsidian logo icon** (`iconPath`, fixed 32px width — the built-in attachment column's compact footprint); the Fluent-localized "Obsidian Note" label still names the column in the column picker. The logo SVG (the obsidian.md favicon mark, brand purple fill) ships as a source asset inlined to a data URI by Vite (`?inline` import). Icon headers show no sort-direction arrow (Zotero behavior, same as the attachment column); sorting itself works.
- **Cell rendering: marker when noted, blank otherwise.** Underlying cell data is a sortable two-value string. Blank honestly covers both "no note" and "status unknown". The marker is a dot rendered by the column's custom cell renderer in Obsidian brand purple (`#9974F8` light / `#A88BFA` dark per obsidian.md/brand, resolved per render via `prefers-color-scheme`).
- **Freshness**: full-map fetch at companion startup, plus a throttled re-fetch (on the order of a few seconds minimum between fetches) when the Zotero main window regains focus, plus a manual refresh.
- **Manual refresh** is a flat, localized entry in Zotero's Tools menu ("ZotLit: Refresh note status") — no one-child submenu. It always reports its outcome on a progress window: "Refreshing…" immediately, settling to the noted-item count on success or an error hint on failure (a distinct "update required" message on a 426 protocol mismatch). It bypasses the background throttle and in-flight skip so an explicit request always fetches and always settles.
- **Failure behavior**: background fetch failures are silent (debug-level log) and keep the last known map. Only the manual refresh surfaces notices.
- **Cache is in-memory only** (a Set of indexed keys). No persistence across Zotero restarts; the column is blank until the first successful fetch of a session. The item tree is redrawn after each cache update.
- **Configuration reuse**: the fetch targets the same base URL preference the notify sender uses, with the same source-id header. No new preferences.

## Testing Decisions

- Good tests exercise external behavior at a boundary — an HTTP request in, a response out; a payload in, a validated object out — never private state or call sequences.
- **Protocol package**: round-trip schema tests for the new response type, following the existing wire-format test suite (valid payloads parse; malformed keys and shapes are rejected).
- **Obsidian server (the one new seam)**: extract the server's Hono app construction into a factory so tests drive it with Hono's in-process `app.request()` — no port binding. Cover: successful GET returning the index's key set; the protocol-version gate (426 on mismatch); the source-id gate; readiness (response reflects the index after its initial scan). The note index is stubbed the way the existing note-index service tests fake vault/metadata. This seam incidentally puts the previously untested version/source gates of the existing routes under test.
- **Zotero side**: no unit seam — the column, cache, and menu code is Zotero-API glue around a Set lookup. Verified live against a running Zotero via the RDP debug loop (column renders, marker appears after note creation + focus, manual refresh works and reports failure with Obsidian closed).

## Out of Scope

- Staleness/outdated indication for literature notes (no lastmod tracking for them exists; separate feature if ever).
- Note counts or any per-item metadata (mtime, path) on the wire.
- Obsidian→Zotero push (registering endpoints on Zotero's local server) — a possible future upgrade; nothing in this design blocks it.
- Persisting the status cache across Zotero restarts.
- Click-to-open-note interaction on the column cell.
- A distinct "missing"/red marker or a three-state display.
- A preference to enable/disable the column (the column picker already covers visibility).

## Further Notes

- This introduces the protocol's first query-style action; the protocol and Obsidian-plugin context glossaries are updated accordingly (Ephemeral HTTP Request now covers queries, Indexed Key is a protocol glossary entry, Note Index and Protocol Action mention the served query). Not ADR-worthy: version-gated ephemeral endpoints are cheap to evolve.
