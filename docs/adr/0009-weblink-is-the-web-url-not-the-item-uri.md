# `zt.weblink` is the web library URL, null for unsynced personal items

For issue #205 ("template helper for Zotero online url") we expose a Zotero online link to templates as `zt.weblink`. Zotero has three confusable link shapes for an item, and this decision records which one we picked and why.

## Considered Options

Which link shape `zt.weblink` exposes:

- **Web library URL** — `https://www.zotero.org/.../items/{key}`. The clickable zotero.org page. **Chosen.**
- **Desktop deep link** — `zotero://select/...`. Already shipped as `zt.backlink`; not what "online" means.
- **Persistent Item URI** — `http://zotero.org/users/{userID}|groups/{groupID}/items/{key}`. A stable identifier, but not a browsable page; ZotLit only parses this form inbound.

Which path the personal-library web URL uses:

- **Username slug** — `https://www.zotero.org/{slugify(username)}/items/{key}`. The form zotero.org serves (`/{username}` → 200) and the Zotero dataserver emits (`getUserURI($www=true)`). **Chosen.**
- **Numeric userID path** — `https://www.zotero.org/users/{userID}/items/{key}`. Rejected: zotero.org has no `users/{userID}` web route, so it returns 404 (checked against `users/1` and the signed-in id).

`zt.weblink` is the web library URL. It is a plain derived string field mirroring `backlink` (note main item + related items; skipped on annotations, which have no web page), not a helper.

## Consequences

- **Personal-library items resolve to `https://www.zotero.org/{slugify(username)}/items/{key}`.** The username lives in the `settings` table (`setting='account', key='username'`), written on sync, so the new `@zotlit/db` query reads `username`. `slugify` (dataserver `model/Utilities.inc.php`) trims, lowercases, strips chars outside `[a-z0-9 ._-]`, and maps spaces to underscores; ZotLit mirrors it. This is the form `toWebURL` / the API's `links.alternate` produce.
- **Group-library items resolve to `https://www.zotero.org/groups/{groupID}/items/{key}`.** zotero.org 302-redirects the numeric id to the `groups/{id}/{slug}/...` form (verified against public group 30 `digital_humanities`), so the numeric `groupID` alone suffices — no name/slug lookup.
- **`zt.weblink` is `null` for a personal-library item on a never-synced account.** A synced account carries a username; an unsynced one has only a local key (`.../users/local/{localUserKey}/...`) whose page does not exist, so the query reads `username` alone and yields `null` — matching Zotero, which surfaces its web link only when logged in.
