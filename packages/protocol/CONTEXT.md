# ZotLit Protocol

The wire format for ZotLit ↔ Zotero communication. Two transports carry the same actions under two different compatibility policies.

## Language

**Public URI Link**:
An `obsidian://zotlit/<action>?…` link built by the Zotero companion for `Zotero.launchURL`. A permanent, embeddable artifact — it may be pasted into a note, a webpage, or a bookmark and opened long after it was created. Never version-gated: the Obsidian receiver honors any structurally valid link regardless of the plugin version that opens it. Evolves additive-only.
_Avoid_: protocol URL (ambiguous with the HTTP endpoints), deep link, ephemeral link

**Ephemeral HTTP Request**:
An HTTP request between the running Zotero companion and the Obsidian listener: `POST /notify` event pushes and `PUT` batch commands the companion sends, plus the `GET /literature-notes` note-status query it fetches — the protocol's first query-style action, where the Obsidian plugin serves and the companion consumes the response (`noteStatusResponseSchema`). Generated live and in lockstep with the companion, so every request carries the `X-Zotlit-Protocol-Version` header and is strictly version-matched — a mismatch is rejected with `426`. The opposite of a Public URI Link in permanence and in gating.
_Avoid_: notify call, live link

**Protocol Version**:
The single integer (`PROTOCOL_VERSION`) that versions the **HTTP** wire shapes only. Bumped when an HTTP body or header schema changes; a Public-URI-only change never bumps it. The URL transport carries no version.
_Avoid_: wire version (too broad — it does not govern URLs), API version

**Action**:
A verb in the `zotlit/*` namespace (`open`, `update`, `update-many`, `update-all`, `import-note`, `import-notes`, `import-all-notes`, `explore`). An action id plus its required query fields is a frozen contract on the URL transport; a breaking change is expressed as a **new** action id, never by mutating an existing one.
_Avoid_: command, route, endpoint

**Indexed Key**:
The wire vocabulary for item identity across libraries: an 8-char base-32 Zotero item key, optionally suffixed `g<groupID>` for group-library items (`ABCD2345`, `ABCD2345g17`). The key space of Literature Note frontmatter and the Obsidian Note Index; the note-status response carries a set of them, validated against this pattern. The Zotero side formats one per row from the item key plus the library's group id; parsing back to a library lives in `@zotlit/db`, not here.
_Avoid_: item key (drops the library disambiguation), frontmatter key

**Source Id**:
The 8-char hex install fingerprint carried by every action (`source-id` query param on URLs, `X-Zotlit-Source-Id` header on HTTP). The sole targeting gate — an action is discarded when it does not match the configured install. Independent of versioning.
_Avoid_: install id, client id
