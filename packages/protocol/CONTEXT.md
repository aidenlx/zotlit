# ZotLit Protocol

The wire format for ZotLit ↔ Zotero communication. Two transports carry the same actions under two different compatibility policies.

## Language

**Public URI Link**:
An `obsidian://zotlit/<action>?…` link built by the Zotero companion for `Zotero.launchURL`. A permanent, embeddable artifact — it may be pasted into a note, a webpage, or a bookmark and opened long after it was created. Never version-gated: the Obsidian receiver honors any structurally valid link regardless of the plugin version that opens it. Evolves additive-only.
_Avoid_: protocol URL (ambiguous with the HTTP endpoints), deep link, ephemeral link

**Ephemeral HTTP Request**:
A `POST /notify` or `PUT` request the running Zotero companion sends to the Obsidian listener. Generated live and in lockstep with the companion, so it carries the `X-Zotlit-Protocol-Version` header and is strictly version-matched — a mismatch is rejected with `426`. The opposite of a Public URI Link in permanence and in gating.
_Avoid_: notify call, live link

**Protocol Version**:
The single integer (`PROTOCOL_VERSION`) that versions the **HTTP** wire shapes only. Bumped when an HTTP body or header schema changes; a Public-URI-only change never bumps it. The URL transport carries no version.
_Avoid_: wire version (too broad — it does not govern URLs), API version

**Action**:
A verb in the `zotlit/*` namespace (`open`, `update`, `update-many`, `import-note`, `import-notes`, `explore`). An action id plus its required query fields is a frozen contract on the URL transport; a breaking change is expressed as a **new** action id, never by mutating an existing one.
_Avoid_: command, route, endpoint

**Source Id**:
The 8-char hex install fingerprint carried by every action (`source-id` query param on URLs, `X-Zotlit-Source-Id` header on HTTP). The sole targeting gate — an action is discarded when it does not match the configured install. Independent of versioning.
_Avoid_: install id, client id
