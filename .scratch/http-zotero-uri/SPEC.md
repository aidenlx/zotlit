# Spec: `zt.weblink` — Zotero web library URL for templates

Status: ready-for-agent
Issue: #205 (template helper for Zotero online url)
ADR: docs/adr/0009-weblink-is-the-web-url-not-the-item-uri.md

## Problem Statement

When writing a literature note, I want a link that opens the item's page **on zotero.org in a browser** — so I can reach it from any device, or share it with a collaborator who does not have the Zotero desktop app. Today ZotLit only gives me `zt.backlink`, which is a `zotero://` desktop deep link: it only works on a machine with Zotero installed, and it does nothing in a browser or on mobile. There is no template field for the online (web) address of an item.

## Solution

Expose a new template field, **`zt.weblink`**: the Zotero **web library URL** for the item — the browsable `https://www.zotero.org/…/items/{key}` page. It sits alongside `zt.backlink` on the same surface (the note's main Item and its related Items), so a template author can offer both a "open in app" link and an "open online" link.

- Group-library items always resolve to `https://www.zotero.org/groups/{groupID}/items/{key}` (zotero.org redirects the numeric id to the `groups/{id}/{slug}` form).
- Personal-library items resolve to `https://www.zotero.org/{slugify(username)}/items/{key}` — the account **username slug** that zotero.org serves.
- When the account has never synced (no username exists), `zt.weblink` is `null` — because the only address Zotero could form in that case (`…/users/local/{localUserKey}/…`) has no working web page. A template author checks for `null` and omits the link.

## User Stories

1. As a note author, I want a `zt.weblink` field on my note template, so that my literature note contains a clickable link to the item's page on zotero.org.
2. As a note author on a synced personal library, I want `zt.weblink` to produce `https://www.zotero.org/{slugify(username)}/items/{key}`, so that the link opens my item in the Zotero web library.
3. As a note author working in a group library, I want `zt.weblink` to produce `https://www.zotero.org/groups/{groupID}/items/{key}`, so that the link opens the shared item online for anyone with group access.
4. As a note author whose Zotero has never been signed in / synced, I want `zt.weblink` to be `null` rather than a dead `users/local/...` link, so that my template can skip rendering a link that would 404.
5. As a template author, I want to write `<% if (zt.weblink) { %>[Online](<%= zt.weblink %>)<% } %>`, so that the online link appears only when it actually resolves.
6. As a template author, I want `zt.weblink` available on `zt.relatedItems[]` too, so that related-item lists can link out to zotero.org just like the main item.
7. As a note author, I want `zt.weblink` and `zt.backlink` to coexist, so that I can offer both an "open in Zotero app" and an "open online" affordance in the same note.
8. As a note author, I do NOT want `zt.weblink` on annotations, because the Zotero web library has no per-annotation page and such a link would mislead.
9. As a note author, I want `zt.weblink` to keep working after I switch or sign into a different Zotero account within the same session, so that the URL reflects the currently signed-in account (username) rather than a stale one.
10. As a note author, I want `zt.weblink` to be distinct from `zt.url`, so that I can link to the zotero.org page (`weblink`) and the resource's own page such as the DOI landing page (`url`) independently.
11. As a template author reading the docs, I want the templates data reference to list `zt.weblink` with its type and null semantics, so that I know when it resolves and when it does not.
12. As a maintainer, I want the persistent `http://zotero.org/...` item URI form to stay out of the template surface, so that the template contract exposes only the browsable web URL and not a look-alike identifier.
13. As a note author regenerating a batch of notes, I want the signed-in username resolved once for the whole batch, so that a large batch does not issue a redundant account lookup per item.
14. As a note author, I want `zt.weblink` to use my account username slug (read from Zotero's synced account settings), so that the personal-library link opens at the address zotero.org serves for my library.

## Implementation Decisions

### New template field: `zt.weblink`

- A plain derived **string-or-null** field on the item template surface, mirroring how `backlink` is built and placed — **not** a helper function. It is a pure function of the item's `key`, its `groupID`, and the account `username`.
- Placement mirrors `backlink` **minus annotations**: present on the note's main Item and on each `relatedItems[]` entry. Not on annotations (no web page exists for an annotation), and not on cited items (they carry no `key`/`groupID`, so a web URL cannot be formed there).
- Type is `string | null`. `null` encodes exactly one case: a personal-library item on an account with no username (never synced).

### URL construction (pure builder)

- Add a pure builder alongside `itemSelectUri` in the db package's Zotero-URI module (`zt-uri.ts`), taking the item `key`, the `groupID` (`null` for the personal library), and the account `username` (`null` when unknown).
- Group library (`groupID != null`): `https://www.zotero.org/groups/${groupID}/items/${key}` (numeric id; zotero.org 302-redirects to the `groups/{id}/{slug}` form).
- Personal library (`groupID == null`): `username == null ? null : https://www.zotero.org/${slugify(username)}/items/${key}`.
- The personal form uses the **username slug** — the form zotero.org serves and the Zotero **dataserver** emits (`model/URI.inc.php` `getUserURI($www=true)` → `WWW_BASE_URI + slugify(username)`, the source `toWebURL`/`links.alternate` mirror). `slugify` (`model/Utilities.inc.php`) trims, lowercases, strips chars outside `[a-z0-9 ._-]`, and maps spaces to underscores. (Rationale for the username slug over the numeric userID path: see ADR 0009.)

### Reading the account username

- Add a db query (`getCurrentUsername`) that reads the signed-in username from Zotero's `settings` table, row `(setting='account', key='username')`, returning `string | null`. The `settings` value column is loosely typed, so the query returns `null` when absent, empty, or not a string.
- Follow the existing `defineQuery` pattern (as `groupsQuery` does) so the prepared statement is cached per database connection.
- The query reads `username` **only** — the single value the personal-library web URL is built from. A never-synced account has no username, which is what yields `null`.

### Resolving and threading the username (see ADR 0009 and the groupID-memo precedent)

- The signed-in username is a **single account-wide scalar**, not a per-library value. It is therefore threaded as a plain `string | null`, **not** as a keyed memo like `GroupIDMemo` (a map would only ever hold one entry).
- It shares the groupID/tag memos' **lifetime discipline**: resolved **once per batch** and passed down, never cached permanently per-connection. The username can change mid-session (sign in/out, switch account) without reconnecting the database, so a permanent value cache would go stale. Per-batch resolution is the correct staleness boundary.
- The app-layer note-feature batch driver that already constructs the per-batch memos (`groupIdMemo`, `collectionCache`, `tagMemo`) resolves the username once via `getCurrentUsername` and passes the scalar into the note-context builder.
- The db-facing `fetchNoteContext` gains a `username: string | null` option and forwards it into the pure `buildNoteContext`; `NoteContextInput` gains a `username: string | null` field. `buildNoteContext` and `buildRelatedItem` compute `weblink` from `item.key`, `item.groupID`, and the threaded `username` — exactly where and how they already compute `backlink`.

### Docs

- Add a `zt.weblink` row to the templates data reference (`data.mdx`) with type `string | null` and a one-line note on the `null` (never-synced personal library) case, adjacent to the existing `zt.backlink` row.

### Glossary (already recorded)

- `packages/db/CONTEXT.md` now defines **Weblink** (this field), **Backlink** (the existing `zotero://` desktop deep link), **URL** (the item's own resource URL, `zt.url`), and **Item URI** (the persistent `http://zotero.org/...` identifier, parsed inbound only). Use these terms in code and docs.

## Testing Decisions

Good tests here assert **observable template output** — the value of `zt.weblink` under each library/account condition — not internal wiring. Three seams, matching existing prior art:

### Seam A — behavior and null semantics (primary, highest)

- Module: the note-context builder (`buildNoteContext` / `fetchNoteContext`), tested in `zt-template-note.test.ts`.
- Prior art: the existing `backlink` assertions in the same file (personal item, group item, related items).
- Cases: with a `username` supplied, a personal-library item's `zt.weblink` is the `https://www.zotero.org/{slugify(username)}/items/{key}` form; a group-library item's is the `groups/{groupID}` form; with `username` `null`, a personal-library item's `zt.weblink` is `null` while a group-library item's still resolves. Assert on the main item and on a `relatedItems[]` entry. Confirm annotations expose no `weblink`.

### Seam B — the settings read (only reachable at the query)

- Module: `getCurrentUsername`, tested in a new `queries/*.test.ts`.
- Prior art: `libraries.test.ts` — in-memory SQLite via `createFixtureSchema`, seeded with an SQL `SEED` string, driven through the Drizzle client.
- Cases: seed `settings` with `(setting='account', key='username', value='<name>')` and assert the username is returned; omit the row and assert `null`; seed an empty string and assert `null`.

### Seam C — the pure URL builder (idiomatic unit)

- Module: `itemWebUrl`, tested in the existing `zt-uri.test.ts` beside `itemSelectUri`.
- Cases: group id present → `groups/{id}` URL; personal (`groupID = null`) with a username → `{slugify(username)}` URL; personal with `username = null` → `null`; a slugify case (uppercase/space → lowercase/underscore).

## Out of Scope

- Exposing the persistent `http://zotero.org/...` item URI as a template field. Only the browsable web URL is exposed.
- A `zt.weblink` on annotations, attachments, or cited items.
- Changing the default note template to render the online link. The field is exposed and documented; adopting it is the template author's choice.
- Any `bibliography` / citation-style feature. The issue thread drifted into `{{bibliography}}`; that is a separate concern and not addressed here.
- Reading or exposing `localUserKey`, or any local-fallback URI form.
- Verifying that a group is public / that the target page is actually reachable. The field forms a well-structured URL; reachability depends on the library's sharing settings, which ZotLit does not inspect.

## Further Notes

- The `obsidian-zotero-integration` plugin referenced in the issue screenshots does **not** actually expose a web-URL template variable — its only Zotero-link field (`desktopURI`) is a `zotero://` desktop link, which ZotLit already ships as `zt.backlink`. `zt.weblink` is strictly additive: the browsable web form the branch name (`feat/http-zotero-uri`) asks for. Existing users who only wanted the desktop link are already served by `zt.backlink`.
- Zotero's own source carries a TODO that its `toWebURL` domain-swap does not always yield a functional URL (e.g. the local-fallback form has no web equivalent). The `null`-when-unsynced decision (ADR 0009) sidesteps the one case Zotero itself flags.
